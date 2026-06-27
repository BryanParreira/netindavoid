"""Network information & syslog ingestion endpoints."""
import asyncio
import json
import socketserver
import threading
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.deps import get_current_user, get_db
from models.user import User
from services.network import network_info, get_subnet_cidr

router = APIRouter(prefix="/network", tags=["network"])


@router.get("/info")
async def get_network_info(user: User = Depends(get_current_user)):
    """Return current interface, IP, subnet, gateway, DNS servers."""
    return network_info()


@router.get("/subnet")
async def get_subnet(user: User = Depends(get_current_user)):
    """Quick endpoint — just the CIDR used for scanning."""
    return {"cidr": get_subnet_cidr()}


# ── Syslog UDP receiver ───────────────────────────────────────────────────────
# Listens on UDP 5140 (not 514 — no root needed).
# Routers, switches, APs can send syslog here.
# Point your device at: udp://<this-mac-ip>:5140

_syslog_server: socketserver.UDPServer | None = None
_syslog_thread: threading.Thread | None = None
_syslog_tenant_id: str | None = None


class _SyslogHandler(socketserver.BaseRequestHandler):
    def handle(self):
        global _syslog_tenant_id
        raw = self.request[0]
        try:
            msg = raw.decode("utf-8", errors="replace").strip()
        except Exception:
            return
        if not msg or not _syslog_tenant_id:
            return

        # Fire-and-forget into the event loop
        try:
            loop = asyncio.get_event_loop()
            asyncio.run_coroutine_threadsafe(
                _ingest_syslog(msg, self.client_address[0], _syslog_tenant_id),
                loop,
            )
        except Exception:
            pass


async def _ingest_syslog(msg: str, src_ip: str, tenant_id: str):
    from core.database import AsyncSessionLocal
    from routers.logs import _ingest_one
    from core.redis import get_redis
    from services.active_network import get_active_network_id

    redis = get_redis()
    network_id = await get_active_network_id()
    async with AsyncSessionLocal() as db:
        await _ingest_one(
            db, tenant_id, msg,
            index_name="syslog",
            source=f"syslog:{src_ip}",
            sourcetype="syslog",
            host=src_ip,
            redis=redis,
            network_id=network_id,
        )
        await db.commit()


def start_syslog_receiver(tenant_id: str, port: int = 5140):
    """Start UDP syslog listener in a background thread."""
    global _syslog_server, _syslog_thread, _syslog_tenant_id

    if _syslog_server:
        return  # already running

    _syslog_tenant_id = tenant_id
    try:
        _syslog_server = socketserver.UDPServer(("0.0.0.0", port), _SyslogHandler)
        _syslog_thread = threading.Thread(target=_syslog_server.serve_forever, daemon=True)
        _syslog_thread.start()
    except Exception as e:
        import structlog
        structlog.get_logger().warning("syslog receiver failed to start", port=port, error=str(e))


def stop_syslog_receiver():
    global _syslog_server
    if _syslog_server:
        _syslog_server.shutdown()
        _syslog_server = None


@router.get("/current")
async def get_current_network(user: User = Depends(get_current_user)):
    """Return the active network's metadata."""
    from services.active_network import get_active_network_id
    from models.network import Network
    from core.database import AsyncSessionLocal
    from sqlalchemy import select

    network_id = await get_active_network_id()
    if not network_id:
        return {"network": None, "detected": False}

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Network).where(Network.id == network_id))
        net = result.scalar_one_or_none()

    if not net:
        return {"network": None, "detected": False}

    return {
        "detected": True,
        "network": {
            "id":            str(net.id),
            "gateway_mac":   net.gateway_mac,
            "gateway_ip":    net.gateway_ip,
            "subnet_cidr":   net.subnet_cidr,
            "ssid":          net.ssid,
            "display_name":  net.display_name,
            "is_trusted":    net.is_trusted,
            "first_seen_at": net.first_seen_at.isoformat(),
            "last_seen_at":  net.last_seen_at.isoformat(),
        }
    }


@router.get("/history")
async def list_networks(user: User = Depends(get_current_user)):
    """Return all networks ever seen, most recently visited first."""
    from models.network import Network
    from core.database import AsyncSessionLocal
    from services.active_network import get_active_network_id
    from sqlalchemy import select

    active_id = await get_active_network_id()

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Network).order_by(Network.last_seen_at.desc())
        )
        networks = result.scalars().all()

    return [
        {
            "id":            str(n.id),
            "gateway_mac":   n.gateway_mac,
            "gateway_ip":    n.gateway_ip,
            "subnet_cidr":   n.subnet_cidr,
            "ssid":          n.ssid,
            "display_name":  n.display_name,
            "is_trusted":    n.is_trusted,
            "is_active":     n.id == active_id,
            "first_seen_at": n.first_seen_at.isoformat(),
            "last_seen_at":  n.last_seen_at.isoformat(),
        }
        for n in networks
    ]


@router.patch("/history/{network_id}")
async def update_network(
    network_id: str,
    body: dict,
    user: User = Depends(get_current_user),
):
    """Let the user rename a network or mark it trusted."""
    import uuid as _uuid
    from models.network import Network
    from core.database import AsyncSessionLocal
    from sqlalchemy import select
    from fastapi import HTTPException

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Network).where(Network.id == _uuid.UUID(network_id))
        )
        net = result.scalar_one_or_none()
        if not net:
            raise HTTPException(404, "Network not found")

        if "display_name" in body:
            net.display_name = body["display_name"]
        if "is_trusted" in body:
            net.is_trusted = body["is_trusted"]

        await db.commit()
        await db.refresh(net)

    return {"id": str(net.id), "display_name": net.display_name, "is_trusted": net.is_trusted}


@router.get("/syslog/status")
async def syslog_status(user: User = Depends(get_current_user)):
    from services.network import get_local_ip
    return {
        "running": _syslog_server is not None,
        "port": 5140,
        "target": f"udp://{get_local_ip()}:5140",
        "instructions": "Point your router/switch/AP syslog to this address.",
    }
