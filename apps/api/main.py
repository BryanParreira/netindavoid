from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import structlog, subprocess, asyncio

from core.config import settings
from core.database import init_db, check_db_health, AsyncSessionLocal
from core.redis import check_redis_health
from middleware.rate_limit import setup_rate_limiting
from routers import devices, traffic, alerts, dns, scans, ai, websocket, audit, vulnscan, wifi, nmap_scanner, capture, logs, uptime, flows
from scripts.bootstrap import bootstrap_admin

logger = structlog.get_logger()


async def _background_collector():
    """Every 60s: traffic sample. Every 5min: ping devices."""
    from sqlalchemy import select
    from models.user import User

    tick = 0
    while True:
        try:
            await asyncio.sleep(60)
            tick += 1

            tenant_id = None
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(User).where(User.is_active == True).limit(1))
                user = result.scalar_one_or_none()
                if user:
                    tenant_id = str(user.tenant_id)

            if not tenant_id:
                continue

            await traffic._collect_netstat_sample(tenant_id)

            if tick % 5 == 0:
                await uptime.ping_all_devices_task(tenant_id)

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning("collector error", error=str(e))


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Netindavoid API starting", env=settings.APP_ENV)
    await init_db()
    await bootstrap_admin()

    from routers.websocket import bus
    await bus.start()

    collector_task = asyncio.create_task(_background_collector())
    logger.info("Startup complete")

    yield

    collector_task.cancel()
    try:
        await collector_task
    except asyncio.CancelledError:
        pass
    logger.info("Shutting down")


app = FastAPI(
    title="Netindavoid API",
    description="Network Security Monitoring Platform",
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
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd="/Users/bryanbernardo/Desktop/netindavoid"
        ).decode().strip()
        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd="/Users/bryanbernardo/Desktop/netindavoid"
        ).decode().strip()
    except Exception:
        commit, branch = "unknown", "unknown"
    return {"version": "1.0.0", "commit": commit, "branch": branch}


@app.get("/")
async def root():
    return {"name": "Netindavoid", "version": "1.0.0", "docs": "/docs"}
