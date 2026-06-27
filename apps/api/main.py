from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import structlog, subprocess, asyncio, os

from core.config import settings
from core.database import init_db, check_db_health, AsyncSessionLocal
from core.redis import check_redis_health
from middleware.rate_limit import setup_rate_limiting
from routers import (
    devices, traffic, alerts, dns, scans, ai, websocket,
    audit, vulnscan, wifi, nmap_scanner, capture, logs, uptime, flows, network,
)
from scripts.bootstrap import bootstrap_admin

logger = structlog.get_logger()


async def _get_tenant_id() -> str | None:
    from sqlalchemy import select
    from models.user import User
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.is_active == True).limit(1))
        user = result.scalar_one_or_none()
        return str(user.tenant_id) if user else None


async def _auto_scan(tenant_id: str):
    """Trigger a background ARP scan using the current network's subnet."""
    from services.network import get_subnet_cidr
    from services.active_network import get_active_network_id
    from models.scan import Scan, ScanType, ScanStatus

    cidr = get_subnet_cidr()
    network_id = await get_active_network_id()
    logger.info("auto-scan triggered", cidr=cidr)

    async with AsyncSessionLocal() as db:
        scan = Scan(
            tenant_id=__import__("uuid").UUID(tenant_id),
            network_id=network_id,
            scan_type=ScanType.ARP,
            status=ScanStatus.PENDING,
            target_cidr=cidr,
        )
        db.add(scan)
        await db.flush()
        scan_id = str(scan.id)
        await db.commit()

    # Run inline (no Celery dependency)
    from workers.tasks import _run_network_scan_async
    try:
        await _run_network_scan_async(scan_id, tenant_id, "arp")
    except Exception as e:
        logger.warning("auto-scan error", error=str(e))


async def _background_collector():
    """
    Continuous background loop:
      Every 30s  — traffic sample from active interface
      Every 5min — ping all known devices for uptime
      Every 5min — ARP scan to discover new/leaving devices
      Every 15min — sync internal events to log index
    """
    tick = 0
    while True:
        try:
            await asyncio.sleep(30)
            tick += 1

            tenant_id = await _get_tenant_id()
            if not tenant_id:
                continue

            # Traffic sample (every 30s)
            await traffic._collect_netstat_sample(tenant_id)

            # Device ping + network scan (every 5 min = every 10 ticks)
            if tick % 10 == 0:
                from services.active_network import resolve_active_network
                await resolve_active_network()
                await uptime.ping_all_devices_task(tenant_id)
                asyncio.create_task(_auto_scan(tenant_id))

            # Log sync (every 15 min = every 30 ticks)
            if tick % 30 == 0:
                try:
                    from sqlalchemy import select
                    from models.user import User
                    async with AsyncSessionLocal() as db:
                        result = await db.execute(select(User).where(User.is_active == True).limit(1))
                        user = result.scalar_one_or_none()
                        if user:
                            from routers.logs import sync_internal
                            from fastapi import Request
                            # Call sync directly without HTTP
                            await _sync_logs_direct(tenant_id)
                except Exception as e:
                    logger.warning("log sync error", error=str(e))

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning("collector error", error=str(e))


async def _sync_logs_direct(tenant_id: str):
    """Pull recent events from DNS/Alerts/Scans into log_events table."""
    import uuid as _uuid
    from datetime import timedelta
    from sqlalchemy import select, and_
    from models.alert import Alert
    from models.dns import DnsQuery
    from models.scan import Scan
    from core.redis import get_redis
    from routers.logs import _ingest_one
    from services.active_network import get_active_network_id

    redis = get_redis()
    network_id = await get_active_network_id()
    since = __import__("datetime").datetime.now(__import__("datetime").timezone.utc) - timedelta(minutes=20)
    tid_uuid = _uuid.UUID(tenant_id)

    async with AsyncSessionLocal() as db:
        # Alerts
        alerts = (await db.execute(
            select(Alert).where(and_(Alert.tenant_id == tid_uuid, Alert.triggered_at >= since))
        )).scalars().all()
        for a in alerts:
            msg = f"[{a.severity.upper()}] {a.title}: {a.description}"
            await _ingest_one(db, tenant_id, msg,
                timestamp=a.triggered_at, index_name="security",
                source=f"alert:{a.source}", sourcetype="vex:alert",
                host="vex",
                extra={"alert_id": str(a.id), "severity": a.severity,
                       "category": a.category, "status": a.status},
                redis=redis, network_id=network_id)

        # DNS
        dns_rows = (await db.execute(
            select(DnsQuery).where(and_(DnsQuery.tenant_id == tid_uuid, DnsQuery.queried_at >= since))
        )).scalars().all()
        for d in dns_rows:
            msg = f"DNS {d.query_type} {d.domain} → {d.response_code or 'unknown'}"
            sev = "error" if d.is_malicious else ("warning" if d.is_blocked else "info")
            await _ingest_one(db, tenant_id, msg,
                timestamp=d.queried_at, index_name="dns",
                source="dns", sourcetype="dns:query",
                host=str(d.device_id) if d.device_id else "unknown",
                extra={"domain": d.domain, "query_type": d.query_type,
                       "rcode": d.response_code, "is_malicious": str(d.is_malicious),
                       "is_blocked": str(d.is_blocked)},
                redis=redis, network_id=network_id)

        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Vex API starting", env=settings.APP_ENV)
    await init_db()
    await bootstrap_admin()

    # Detect the physical network we're on right now
    from services.active_network import resolve_active_network
    await resolve_active_network()

    from routers.websocket import bus
    await bus.start()

    # Start syslog UDP receiver (port 5140 — no root needed)
    tenant_id = await _get_tenant_id()
    if tenant_id:
        network.start_syslog_receiver(tenant_id, port=5140)
        # Kick off an immediate scan on startup so the devices page populates instantly
        asyncio.create_task(_auto_scan(tenant_id))

    collector_task = asyncio.create_task(_background_collector())
    logger.info("Startup complete — syslog on UDP 5140, scanning active network")

    yield

    collector_task.cancel()
    try:
        await collector_task
    except asyncio.CancelledError:
        pass
    network.stop_syslog_receiver()
    logger.info("Shutting down")


app = FastAPI(
    title="Vex API",
    description="Network Security Monitoring Platform — Splunk-compatible HEC, real-time search, device discovery",
    version="1.0.0",
    docs_url="/docs",
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
setup_rate_limiting(app)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(devices.router,       prefix="/api/v1")
app.include_router(traffic.router,       prefix="/api/v1")
app.include_router(alerts.router,        prefix="/api/v1")
app.include_router(dns.router,           prefix="/api/v1")
app.include_router(scans.router,         prefix="/api/v1")
app.include_router(ai.router,            prefix="/api/v1")
app.include_router(audit.router,         prefix="/api/v1")
app.include_router(vulnscan.router,      prefix="/api/v1")
app.include_router(wifi.router,          prefix="/api/v1")
app.include_router(nmap_scanner.router,  prefix="/api/v1")
app.include_router(capture.router,       prefix="/api/v1")
app.include_router(logs.router,          prefix="/api/v1")
app.include_router(uptime.router,        prefix="/api/v1")
app.include_router(flows.router,         prefix="/api/v1")
app.include_router(network.router,       prefix="/api/v1")
app.include_router(websocket.router)


# ── Health & version ──────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    db_ok    = await check_db_health()
    redis_ok = await check_redis_health()
    status   = "healthy" if db_ok and redis_ok else "degraded"
    return JSONResponse(
        content={"status": status, "db": db_ok, "redis": redis_ok},
        status_code=200 if status == "healthy" else 503,
    )


@app.get("/version")
async def version():
    try:
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=project_root
        ).decode().strip()
        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=project_root
        ).decode().strip()
    except Exception:
        commit, branch = "unknown", "unknown"
    return {"version": "1.1.0", "commit": commit, "branch": branch}


@app.get("/")
async def root():
    return {"name": "Vex", "version": "1.1.0", "docs": "/docs"}
