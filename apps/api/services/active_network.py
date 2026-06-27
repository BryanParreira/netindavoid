"""
Resolve and cache the active Network row.

The active network is determined at startup and whenever the background
collector detects a gateway MAC change. It is stored in Redis under
"vex:active_network_id" so all routers and tasks read the same value
without hitting the DB on every request.
"""
import uuid
from datetime import datetime, timezone

import structlog

from core.redis import get_redis

logger = structlog.get_logger()

REDIS_KEY = "vex:active_network_id"


async def get_active_network_id() -> uuid.UUID | None:
    """Return the UUID of the currently active network, or None."""
    r = get_redis()
    val = await r.get(REDIS_KEY)
    if val:
        try:
            return uuid.UUID(val)
        except ValueError:
            pass
    return None


async def set_active_network_id(network_id: uuid.UUID) -> None:
    r = get_redis()
    await r.set(REDIS_KEY, str(network_id))


async def resolve_active_network() -> uuid.UUID | None:
    """
    Detect the current physical network by gateway MAC.
    Upsert a row in the networks table.
    Cache the network_id in Redis.
    Returns the network_id, or None if detection fails.

    Safe to call repeatedly — returns early from Redis if gateway MAC unchanged.
    """
    from services.network import get_gateway_mac, get_gateway, get_subnet_cidr, get_ssid
    from core.database import AsyncSessionLocal
    from models.network import Network
    from sqlalchemy import select

    gw_mac = get_gateway_mac()
    if not gw_mac:
        logger.warning("network detection: could not determine gateway MAC")
        return None

    # Check if we already have this MAC active (fast path)
    r = get_redis()
    cached_mac = await r.get("vex:active_gateway_mac")
    if cached_mac == gw_mac:
        return await get_active_network_id()

    # MAC changed (or first run) — resolve from DB
    gw_ip = get_gateway()
    cidr  = get_subnet_cidr()
    ssid  = get_ssid()
    now   = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Network).where(Network.gateway_mac == gw_mac)
        )
        network = result.scalar_one_or_none()

        if network is None:
            network = Network(
                gateway_mac   = gw_mac,
                gateway_ip    = gw_ip,
                subnet_cidr   = cidr,
                ssid          = ssid,
                first_seen_at = now,
                last_seen_at  = now,
            )
            db.add(network)
            logger.info("new network registered",
                        gateway_mac=gw_mac, cidr=cidr, ssid=ssid)
        else:
            network.gateway_ip   = gw_ip
            network.subnet_cidr  = cidr
            if ssid:
                network.ssid     = ssid
            network.last_seen_at = now

        await db.commit()
        await db.refresh(network)
        nid = network.id

    await set_active_network_id(nid)
    await r.set("vex:active_gateway_mac", gw_mac)
    logger.info("active network set", network_id=str(nid),
                gateway_mac=gw_mac, cidr=cidr)
    return nid
