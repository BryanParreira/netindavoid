"""
Uptime monitor — pings known devices and tracks 90-minute heartbeat history.
Data is stored in Redis (no extra DB table needed).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import asyncio, json, time, uuid as _uuid
from datetime import datetime, timezone
from typing import Optional

from core.deps import get_current_user, get_db
from core.redis import get_redis
from models.user import User
from models.device import Device

router = APIRouter(prefix="/uptime", tags=["uptime"])

REDIS_KEY_PREFIX = "uptime:beats:"
MAX_BEATS = 90


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _ping(ip: str) -> tuple[bool, Optional[float]]:
    try:
        start = time.monotonic()
        proc = await asyncio.create_subprocess_exec(
            "ping", "-c", "1", "-W", "2000", ip,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=3.5)
        ms = (time.monotonic() - start) * 1000
        return proc.returncode == 0, round(ms, 1) if proc.returncode == 0 else None
    except Exception:
        return False, None


async def _record_beat(device_id: str, up: bool, ms: Optional[float]):
    redis = get_redis()
    key = f"{REDIS_KEY_PREFIX}{device_id}"
    beat = json.dumps({"ts": datetime.now(timezone.utc).isoformat(), "up": up, "ms": ms})
    async with redis.pipeline(transaction=False) as pipe:
        pipe.rpush(key, beat)
        pipe.ltrim(key, -MAX_BEATS, -1)
        pipe.expire(key, 86400)
        await pipe.execute()


async def _get_beats(device_id: str) -> list:
    redis = get_redis()
    key = f"{REDIS_KEY_PREFIX}{device_id}"
    raw = await redis.lrange(key, 0, -1)
    return [json.loads(b) for b in raw]


def _calc_uptime(beats: list) -> float:
    if not beats:
        return 0.0
    up = sum(1 for b in beats if b["up"])
    return round(up / len(beats) * 100, 2)


# ── Background ping task ──────────────────────────────────────────────────────

async def ping_all_devices_task(tenant_id: str):
    """Ping devices in the current network and store heartbeat in Redis."""
    try:
        tid = _uuid.UUID(tenant_id)
    except Exception:
        return

    from services.active_network import get_active_network_id
    network_id = await get_active_network_id()

    from core.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        q = select(Device).where(Device.tenant_id == tid, Device.ip_address.isnot(None))
        if network_id:
            q = q.where(Device.network_id == network_id)
        result = await db.execute(q.limit(200))
        devices = result.scalars().all()

    tasks = [(str(dev.id), dev.ip_address) for dev in devices if dev.ip_address]

    async def probe(device_id: str, ip: str):
        up, ms = await _ping(ip)
        await _record_beat(device_id, up, ms)

    await asyncio.gather(*[probe(did, ip) for did, ip in tasks], return_exceptions=True)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/monitors")
async def list_monitors(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Device).where(
            Device.tenant_id == user.tenant_id,
            Device.ip_address.isnot(None),
        ).order_by(Device.display_name).limit(100)
    )
    devices = result.scalars().all()

    monitors = []
    for dev in devices:
        beats = await _get_beats(str(dev.id))
        last_beat = beats[-1] if beats else None
        monitors.append({
            "id":         str(dev.id),
            "name":       dev.display_name or dev.hostname or dev.ip_address,
            "ip":         dev.ip_address,
            "mac":        dev.mac_address,
            "category":   dev.device_type or "computer",
            "status":     ("up" if last_beat and last_beat["up"] else "down") if last_beat else "unknown",
            "latency_ms": last_beat["ms"] if last_beat else None,
            "uptime_pct": _calc_uptime(beats),
            "beats":      beats[-90:],
            "checked_at": last_beat["ts"] if last_beat else None,
        })

    return monitors


@router.post("/ping-all")
async def ping_all(
    user: User = Depends(get_current_user),
):
    await ping_all_devices_task(str(user.tenant_id))
    return {"status": "done"}


@router.post("/ping/{device_id}")
async def ping_device(
    device_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Device).where(Device.id == _uuid.UUID(device_id), Device.tenant_id == user.tenant_id)
    )
    dev = result.scalar_one_or_none()
    if not dev or not dev.ip_address:
        return {"up": False, "ms": None}

    up, ms = await _ping(dev.ip_address)
    await _record_beat(device_id, up, ms)
    return {"up": up, "ms": ms}
