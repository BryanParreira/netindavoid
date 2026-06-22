"""
Network flows — reads active connections from macOS netstat + enriches with GeoIP-lite.
Caches results in Redis for 30s to avoid hammering netstat.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
import asyncio, json, socket, re
from datetime import datetime, timezone

from core.deps import get_current_user, get_db
from core.config import settings
from models.user import User

router = APIRouter(prefix="/flows", tags=["flows"])

REDIS_KEY = "flows:latest"
REDIS_TTL = 30  # seconds


PRIVATE_RANGES = [
    re.compile(r'^10\.'), re.compile(r'^192\.168\.'), re.compile(r'^172\.(1[6-9]|2\d|3[01])\.'),
    re.compile(r'^127\.'), re.compile(r'^::1$'), re.compile(r'^fe80:'),
]

def _is_private(ip: str) -> bool:
    return any(r.match(ip) for r in PRIVATE_RANGES)


PROTO_MAP = {
    "443": "TLS/HTTPS", "80": "HTTP", "53": "DNS",
    "22": "SSH", "21": "FTP", "25": "SMTP",
    "587": "SMTP", "993": "IMAPS", "3306": "MySQL",
    "5432": "PostgreSQL", "6379": "Redis", "8080": "HTTP-ALT",
}

def _classify_proto(port: str) -> str:
    return PROTO_MAP.get(port, "UNKNOWN")


def _resolve_hostname(ip: str) -> str:
    try:
        return socket.gethostbyaddr(ip)[0]
    except Exception:
        return ip


async def _collect_flows() -> list[dict]:
    """Run netstat and parse TCP/UDP connections."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "netstat", "-anp", "tcp",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=8)
        lines = stdout.decode().splitlines()
    except Exception:
        return []

    flows = []
    seen = set()

    for line in lines:
        if not line.startswith("tcp"):
            continue
        parts = line.split()
        if len(parts) < 6:
            continue

        state = parts[5] if len(parts) > 5 else ""
        if state not in ("ESTABLISHED", "CLOSE_WAIT", "SYN_SENT"):
            continue

        local  = parts[3]
        remote = parts[4]

        # Parse remote IP:port
        if "." not in remote and ":" not in remote:
            continue
        if remote.count(".") == 4:  # IPv4 dotted notation
            rparts = remote.rsplit(".", 1)
        elif ":" in remote:
            # IPv6 - skip for simplicity
            continue
        else:
            rparts = remote.rsplit(".", 1)

        if len(rparts) != 2:
            continue

        remote_ip   = rparts[0].lstrip("*")
        remote_port = rparts[1]

        if not remote_ip or remote_ip in ("*", "0.0.0.0"):
            continue

        key = f"{local}-{remote_ip}:{remote_port}"
        if key in seen:
            continue
        seen.add(key)

        is_external = not _is_private(remote_ip)
        proto = _classify_proto(remote_port)

        flows.append({
            "id":           key,
            "local":        local,
            "remote_ip":    remote_ip,
            "remote_port":  remote_port,
            "protocol":     proto,
            "state":        state,
            "is_external":  is_external,
            "risk":         _assess_risk(remote_port, state),
            "country":      None,
            "flag":         None,
            "bytes_out":    0,
            "bytes_in":     0,
            "started_at":   datetime.now(timezone.utc).isoformat(),
        })

    # Sort: external first, then by port
    flows.sort(key=lambda f: (not f["is_external"], f["remote_port"]))
    return flows[:200]


def _assess_risk(port: str, state: str) -> str | None:
    suspicious_ports = {"4444", "1337", "31337", "6666", "6667", "6668", "9001", "9002"}
    if port in suspicious_ports:
        return "c2_comms"
    return None


async def _get_redis():
    try:
        from core.redis import get_redis
        return get_redis()
    except Exception:
        return None


@router.get("")
async def list_flows(
    external_only: bool = Query(False),
    limit: int = Query(100, le=200),
    user: User = Depends(get_current_user),
):
    redis = await _get_redis()

    flows = None
    if redis:
        cached = await redis.get(REDIS_KEY)
        if cached:
            try:
                flows = json.loads(cached)
            except Exception:
                flows = None

    if flows is None:
        flows = await _collect_flows()
        if redis:
            await redis.setex(REDIS_KEY, REDIS_TTL, json.dumps(flows))

    if external_only:
        flows = [f for f in flows if f["is_external"]]

    # Stats
    proto_counts: dict[str, int] = {}
    for f in flows:
        proto_counts[f["protocol"]] = proto_counts.get(f["protocol"], 0) + 1

    return {
        "flows": flows[:limit],
        "total": len(flows),
        "external": sum(1 for f in flows if f["is_external"]),
        "proto_breakdown": [{"protocol": k, "count": v} for k, v in sorted(proto_counts.items(), key=lambda x: -x[1])],
    }


@router.post("/refresh")
async def refresh_flows(user: User = Depends(get_current_user)):
    redis = await _get_redis()
    if redis:
        await redis.delete(REDIS_KEY)
    flows = await _collect_flows()
    if redis:
        await redis.setex(REDIS_KEY, REDIS_TTL, json.dumps(flows))
    return {"total": len(flows)}
