from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from datetime import datetime, timezone, timedelta

from core.deps import get_current_user, get_db
from models.user import User

router = APIRouter(prefix="/dns", tags=["dns"])


@router.get("/overview")
async def dns_overview(
    hours: int = Query(24, ge=1, le=168),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from services.active_network import get_active_network_id
    network_id = await get_active_network_id()
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    network_clause = "AND (network_id = :network_id OR network_id IS NULL)" if network_id else ""
    params: dict = {"tenant_id": str(user.tenant_id), "since": since}
    if network_id:
        params["network_id"] = str(network_id)

    stats = await db.execute(text(f"""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN is_blocked THEN 1 ELSE 0 END) as blocked,
            SUM(CASE WHEN is_malicious THEN 1 ELSE 0 END) as malicious,
            COUNT(DISTINCT domain) as unique_domains
        FROM dns_queries
        WHERE tenant_id = :tenant_id AND queried_at >= :since {network_clause}
    """), params)
    row = stats.fetchone()

    top_domains = await db.execute(text(f"""
        SELECT domain, COUNT(*) as count, bool_or(is_blocked) as blocked
        FROM dns_queries
        WHERE tenant_id = :tenant_id AND queried_at >= :since {network_clause}
        GROUP BY domain
        ORDER BY count DESC
        LIMIT 20
    """), params)

    blocked_domains = await db.execute(text(f"""
        SELECT domain, COUNT(*) as count
        FROM dns_queries
        WHERE tenant_id = :tenant_id AND queried_at >= :since AND is_blocked = true {network_clause}
        GROUP BY domain
        ORDER BY count DESC
        LIMIT 10
    """), params)

    return {
        "total": int(row[0]),
        "blocked": int(row[1]),
        "malicious": int(row[2]),
        "unique_domains": int(row[3]),
        "block_rate": round(int(row[1]) / max(int(row[0]), 1) * 100, 1),
        "top_domains": [{"domain": r[0], "count": int(r[1]), "blocked": r[2]} for r in top_domains.fetchall()],
        "top_blocked": [{"domain": r[0], "count": int(r[1])} for r in blocked_domains.fetchall()],
    }


@router.get("/queries")
async def list_queries(
    hours: int = Query(1, ge=1, le=168),
    domain: str | None = Query(None),
    blocked_only: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from services.active_network import get_active_network_id
    network_id = await get_active_network_id()
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    conditions = "tenant_id = :tenant_id AND queried_at >= :since"
    params: dict = {"tenant_id": str(user.tenant_id), "since": since}

    if network_id:
        conditions += " AND (network_id = :network_id OR network_id IS NULL)"
        params["network_id"] = str(network_id)
    if domain:
        conditions += " AND domain ILIKE :domain"
        params["domain"] = f"%{domain}%"
    if blocked_only:
        conditions += " AND is_blocked = true"

    result = await db.execute(text(f"""
        SELECT id, domain, query_type, queried_at, is_blocked, is_malicious, resolved_ip, source
        FROM dns_queries
        WHERE {conditions}
        ORDER BY queried_at DESC
        LIMIT :limit
    """), {**params, "limit": limit})

    return [
        {
            "id": str(r[0]),
            "domain": r[1],
            "query_type": r[2],
            "queried_at": r[3].isoformat(),
            "is_blocked": r[4],
            "is_malicious": r[5],
            "resolved_ip": r[6],
            "source": r[7],
        }
        for r in result.fetchall()
    ]


@router.post("/collect")
async def collect_dns(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Resolve hostnames of known active connections (from netstat) to populate DNS table.
    Works on any macOS without special permissions.
    """
    import asyncio, uuid as _uuid, hashlib, socket as _socket
    from services.active_network import get_active_network_id
    network_id = await get_active_network_id()

    collected = 0
    now = datetime.now(timezone.utc)

    # Get IPs from active connections via netstat
    try:
        proc = await asyncio.create_subprocess_exec(
            "netstat", "-anp", "tcp",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=8)
        lines = stdout.decode().splitlines()
    except Exception:
        return {"collected": 0, "total_domains": 0}

    ips_to_resolve: set[str] = set()
    for line in lines:
        if "ESTABLISHED" not in line and "CLOSE_WAIT" not in line:
            continue
        parts = line.split()
        if len(parts) < 5:
            continue
        remote = parts[4]
        if remote.count(".") >= 4:
            rparts = remote.rsplit(".", 1)
            if len(rparts) == 2:
                ip = rparts[0]
                if ip and ip != "*" and "0.0.0.0" not in ip and "127.0" not in ip:
                    ips_to_resolve.add(ip)

    # Resolve IPs → hostnames in parallel
    async def resolve_one(ip: str) -> tuple[str, str, str]:
        try:
            loop = asyncio.get_event_loop()
            hostname = await asyncio.wait_for(
                loop.run_in_executor(None, lambda: _socket.gethostbyaddr(ip)[0]),
                timeout=2.0,
            )
            return ip, hostname.rstrip("."), ip
        except Exception:
            return ip, ip, ip

    results = await asyncio.gather(*[resolve_one(ip) for ip in list(ips_to_resolve)[:50]])

    for orig_ip, hostname, resolved_ip in results:
        if not hostname or hostname == orig_ip:
            continue
        domain = hostname.rstrip(".")
        if "." not in domain:
            continue

        det_id = _uuid.UUID(hashlib.md5(
            f"{user.tenant_id}:{domain}:{now.strftime('%Y%m%d%H')}".encode()
        ).hexdigest())
        await db.execute(text("""
            INSERT INTO dns_queries
                (id, tenant_id, network_id, domain, query_type, queried_at, is_blocked, is_malicious, resolved_ip, source)
            VALUES (:id, :tid, :network_id, :domain, 'A', :ts, false, false, :ip, 'netstat-rdns')
            ON CONFLICT (id) DO NOTHING
        """), {
            "id": str(det_id), "tid": str(user.tenant_id),
            "network_id": str(network_id) if network_id else None,
            "domain": domain, "ts": now, "ip": resolved_ip,
        })
        collected += 1

    await db.commit()
    return {"collected": collected, "total_domains": len(ips_to_resolve)}
