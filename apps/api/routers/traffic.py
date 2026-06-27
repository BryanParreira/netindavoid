from fastapi import APIRouter, Depends, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from datetime import datetime, timezone, timedelta
import uuid, asyncio, re, json

from core.deps import get_current_user, get_db
from core.config import settings
from models.user import User
from models.traffic import TrafficSample
from models.device import Device
from schemas.traffic import TrafficOverviewResponse, BandwidthSummary, TopTalker, TrafficPoint

router = APIRouter(prefix="/traffic", tags=["traffic"])


async def _collect_netstat_sample(tenant_id: str):
    """Read macOS netstat -ibn and insert a traffic sample for the primary interface."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "netstat", "-ibn",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        lines = stdout.decode().splitlines()
    except Exception:
        return

    # Pick the main interface (en0 or the one with the most traffic)
    best = None
    best_total = 0
    for line in lines[1:]:
        parts = line.split()
        if len(parts) < 10:
            continue
        iface = parts[0]
        if iface.startswith(("lo", "utun", "awdl", "llw", "bridge")):
            continue
        try:
            ibytes = int(parts[6])
            obytes = int(parts[9])
            total = ibytes + obytes
            if total > best_total:
                best_total = total
                best = (iface, ibytes, obytes)
        except (ValueError, IndexError):
            continue

    if not best or best_total == 0:
        return

    iface, ibytes, obytes = best

    # Store in Redis as last-seen to compute delta on next call
    from core.redis import get_redis
    from services.network import get_subnet_cidr
    redis = get_redis()

    current_cidr = get_subnet_cidr()
    prev_key = f"traffic:prev:{tenant_id}"
    prev_raw = await redis.get(prev_key)
    now = datetime.now(timezone.utc)

    if prev_raw:
        prev = json.loads(prev_raw)
        # If subnet changed since last sample, reset cursor (different network)
        if prev.get("cidr") and prev["cidr"] != current_cidr:
            await redis.delete(prev_key)
        else:
            delta_in  = max(ibytes - prev["ibytes"], 0)
            delta_out = max(obytes - prev["obytes"], 0)

            if delta_in > 0 or delta_out > 0:
                from core.database import AsyncSessionLocal
                from services.active_network import get_active_network_id
                network_id = await get_active_network_id()
                async with AsyncSessionLocal() as db:
                    sample = TrafficSample(
                        tenant_id=uuid.UUID(tenant_id),
                        network_id=network_id,
                        bytes_in=delta_in,
                        bytes_out=delta_out,
                        sampled_at=now,
                        interface=current_cidr,
                    )
                    db.add(sample)
                    await db.commit()

    await redis.setex(prev_key, 300, json.dumps({
        "ts": now.timestamp(), "ibytes": ibytes, "obytes": obytes, "cidr": current_cidr,
    }))


@router.get("/overview", response_model=TrafficOverviewResponse)
async def traffic_overview(
    hours: int = Query(24, ge=1, le=168),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from services.active_network import get_active_network_id
    network_id = await get_active_network_id()
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    network_filter = "AND (network_id = :network_id OR network_id IS NULL)" if network_id else ""
    params_base = {"tenant_id": str(user.tenant_id), "since": since}
    if network_id:
        params_base["network_id"] = str(network_id)

    # Aggregate totals
    agg = await db.execute(text(f"""
        SELECT
            COALESCE(SUM(bytes_in), 0) as total_in,
            COALESCE(SUM(bytes_out), 0) as total_out,
            COALESCE(MAX(bytes_in / 60.0 * 8 / 1e6), 0) as peak_mbps_in,
            COALESCE(MAX(bytes_out / 60.0 * 8 / 1e6), 0) as peak_mbps_out
        FROM traffic_samples
        WHERE tenant_id = :tenant_id AND sampled_at >= :since {network_filter}
    """), params_base)
    row = agg.fetchone()

    # Current (last 5 min)
    last_5 = datetime.now(timezone.utc) - timedelta(minutes=5)
    params_5m = {**params_base, "since": last_5}
    cur = await db.execute(text(f"""
        SELECT
            COALESCE(SUM(bytes_in) / 300.0 * 8 / 1e6, 0) as cur_in,
            COALESCE(SUM(bytes_out) / 300.0 * 8 / 1e6, 0) as cur_out
        FROM traffic_samples
        WHERE tenant_id = :tenant_id AND sampled_at >= :since {network_filter}
    """), params_5m)
    cur_row = cur.fetchone()

    summary = BandwidthSummary(
        total_bytes_in=int(row[0]),
        total_bytes_out=int(row[1]),
        peak_mbps_in=float(row[2]),
        peak_mbps_out=float(row[3]),
        current_mbps_in=float(cur_row[0]),
        current_mbps_out=float(cur_row[1]),
    )

    # Top talkers
    talker_network_filter = "AND (ts.network_id = :network_id OR ts.network_id IS NULL)" if network_id else ""
    talkers_result = await db.execute(text(f"""
        SELECT
            ts.device_id,
            d.display_name,
            d.hostname,
            d.mac_address,
            SUM(ts.bytes_in) as bytes_in,
            SUM(ts.bytes_out) as bytes_out,
            SUM(ts.bytes_in + ts.bytes_out) as total
        FROM traffic_samples ts
        LEFT JOIN devices d ON ts.device_id = d.id
        WHERE ts.tenant_id = :tenant_id AND ts.sampled_at >= :since
          AND ts.device_id IS NOT NULL
          {talker_network_filter}
        GROUP BY ts.device_id, d.display_name, d.hostname, d.mac_address
        ORDER BY total DESC
        LIMIT 10
    """), params_base)

    total_traffic = int(row[0]) + int(row[1]) or 1
    talkers = []
    for r in talkers_result.fetchall():
        name = r[1] or r[2] or r[3] or str(r[0])
        talkers.append(TopTalker(
            device_id=str(r[0]) if r[0] else "",
            device_name=name,
            bytes_in=int(r[4]),
            bytes_out=int(r[5]),
            total_bytes=int(r[6]),
            percentage=round(int(r[6]) / total_traffic * 100, 1),
        ))

    # Timeseries — plain PG bucketing (no TimescaleDB needed)
    secs = 300 if hours <= 24 else 3600
    ts_result = await db.execute(text(f"""
        SELECT
            to_timestamp(floor(extract(epoch from sampled_at) / {secs}) * {secs}) AT TIME ZONE 'UTC' AS bucket,
            SUM(bytes_in) as bytes_in,
            SUM(bytes_out) as bytes_out
        FROM traffic_samples
        WHERE tenant_id = :tenant_id AND sampled_at >= :since {network_filter}
        GROUP BY bucket
        ORDER BY bucket ASC
    """), params_base)

    timeseries = [TrafficPoint(ts=r[0], bytes_in=int(r[1]), bytes_out=int(r[2])) for r in ts_result.fetchall()]

    return TrafficOverviewResponse(summary=summary, top_talkers=talkers, timeseries=timeseries)


@router.get("/device/{device_id}")
async def device_traffic(
    device_id: uuid.UUID,
    hours: int = Query(24, ge=1, le=168),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    result = await db.execute(text("""
        SELECT
            to_timestamp(floor(extract(epoch from sampled_at) / 300) * 300) AT TIME ZONE 'UTC' AS bucket,
            SUM(bytes_in) as bytes_in,
            SUM(bytes_out) as bytes_out
        FROM traffic_samples
        WHERE tenant_id = :tenant_id AND device_id = :device_id AND sampled_at >= :since
        GROUP BY bucket
        ORDER BY bucket ASC
    """), {"tenant_id": str(user.tenant_id), "device_id": str(device_id), "since": since})

    return [{"ts": r[0].isoformat(), "bytes_in": int(r[1]), "bytes_out": int(r[2])} for r in result.fetchall()]


@router.post("/collect")
async def collect_traffic(
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
):
    """Manually trigger a netstat sample collection."""
    background_tasks.add_task(_collect_netstat_sample, str(user.tenant_id))
    return {"status": "collecting"}
