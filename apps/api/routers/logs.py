"""
Log management — ingest, search, tail, saved searches.

Ingest endpoints:
  POST /logs/hec                  Splunk-compatible HEC (JSON event or raw text)
  POST /logs/ingest/batch         Bulk JSON array
  POST /logs/upload               Multipart file upload
  POST /logs/sync                 Pull from existing app tables (DNS/Alerts/Scans)

Search:
  POST /logs/search               SPL-like query
  GET  /logs/search/count         Quick count (for timeline widgets)

Saved searches:
  GET/POST /logs/saved            CRUD
  GET/PATCH/DELETE /logs/saved/{id}

Meta:
  GET  /logs/indexes              Distinct index names
  GET  /logs/sourcetypes          Distinct sourcetypes
  GET  /logs/fields               Extracted field names
"""
import json
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Request
from pydantic import BaseModel
from sqlalchemy import select, func, and_, distinct, text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.deps import get_current_user, get_db
from models.log_event import LogEvent
from models.saved_search import SavedSearch
from models.user import User
from services.log_parser import parse_line, parse_bytes
from services.log_search import run_search

router = APIRouter(prefix="/logs", tags=["logs"])


# ─── HEC token auth helper ────────────────────────────────────────────────────

async def _hec_auth(request: Request, db: AsyncSession) -> str | None:
    """Return tenant_id if HEC token or JWT is valid, else None."""
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("splunk "):
        token = auth[7:].strip()
        if token and token == getattr(settings, "HEC_TOKEN", ""):
            # Use first tenant from DB as HEC target
            from models.tenant import Tenant
            result = await db.execute(select(Tenant).limit(1))
            t = result.scalar_one_or_none()
            return str(t.id) if t else None
    # Fall back: expect JWT-bearing user (handled by require_admin)
    return None


# ─── Ingest helpers ───────────────────────────────────────────────────────────

async def _ingest_one(
    db:         AsyncSession,
    tenant_id:  str,
    message:    str,
    timestamp:  datetime | None = None,
    index_name: str = "main",
    source:     str | None = None,
    sourcetype: str | None = None,
    host:       str | None = None,
    extra:      dict | None = None,
    redis=None,
    network_id=None,
) -> LogEvent:
    st, parsed = parse_line(message, sourcetype)
    if not parsed:
        parsed = {"message": message, "timestamp": None, "severity": "info",
                  "host": None, "source": None, "fields": {}}

    fields = {**parsed.get("fields", {}), **(extra or {})}

    evt = LogEvent(
        tenant_id  = uuid.UUID(tenant_id),
        network_id = network_id,
        timestamp  = timestamp or parsed.get("timestamp") or datetime.now(timezone.utc),
        index_name = index_name,
        source     = source or parsed.get("source"),
        sourcetype = sourcetype or st,
        host       = host or parsed.get("host"),
        message    = parsed.get("message", message),
        severity   = parsed.get("severity", "info"),
        fields     = fields,
    )
    db.add(evt)
    await db.flush()

    if redis:
        payload = json.dumps({
            "event": "log",
            "tenant_id": tenant_id,
            "id":         str(evt.id),
            "timestamp":  evt.timestamp.isoformat(),
            "index":      evt.index_name,
            "source":     evt.source,
            "sourcetype": evt.sourcetype,
            "host":       evt.host,
            "message":    evt.message,
            "severity":   evt.severity,
            "fields":     evt.fields,
        })
        await redis.publish("logs", payload)

    return evt


# ─── Splunk-compatible HEC ────────────────────────────────────────────────────

@router.post("/hec")
async def hec_ingest(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Splunk HEC-compatible endpoint.
    Auth: 'Authorization: Splunk <HEC_TOKEN>'  or  'Authorization: Bearer <JWT>'
    Body: JSON event(s) or raw text
    """
    from core.redis import get_redis

    # HEC token auth
    auth = request.headers.get("Authorization", "")
    tenant_id: str | None = None

    if auth.lower().startswith("splunk "):
        token = auth[7:].strip()
        expected = getattr(settings, "HEC_TOKEN", None)
        if not expected or token != expected:
            raise HTTPException(401, "Invalid HEC token")
        from models.tenant import Tenant
        t = (await db.execute(select(Tenant).limit(1))).scalar_one_or_none()
        tenant_id = str(t.id) if t else None
    elif auth.lower().startswith("bearer "):
        from core.security import decode_token
        from jose import JWTError
        try:
            payload = decode_token(auth[7:])
            tenant_id = payload.get("tenant_id")
        except JWTError:
            raise HTTPException(401, "Invalid token")

    if not tenant_id:
        raise HTTPException(401, "Authentication required")

    body = await request.body()
    content_type = request.headers.get("content-type", "")
    redis = get_redis()

    count = 0
    try:
        # Try JSON parse
        data = json.loads(body)
        events = data if isinstance(data, list) else [data]
        for ev in events:
            raw_event = ev.get("event", ev)
            message   = raw_event if isinstance(raw_event, str) else json.dumps(raw_event)
            ts_raw    = ev.get("time")
            ts        = datetime.fromtimestamp(float(ts_raw), tz=timezone.utc) if ts_raw else None
            await _ingest_one(
                db, tenant_id, message,
                timestamp   = ts,
                index_name  = ev.get("index", "main"),
                source      = ev.get("source"),
                sourcetype  = ev.get("sourcetype"),
                host        = ev.get("host"),
                redis       = redis,
            )
            count += 1
    except (json.JSONDecodeError, TypeError):
        # Raw text
        for line in body.decode("utf-8", errors="replace").splitlines():
            if line.strip():
                await _ingest_one(db, tenant_id, line, redis=redis)
                count += 1

    return {"text": "Success", "code": 0, "count": count}


# ─── Batch JSON ingest ────────────────────────────────────────────────────────

class BatchEvent(BaseModel):
    message:    str
    timestamp:  str | None = None
    index:      str        = "main"
    source:     str | None = None
    sourcetype: str | None = None
    host:       str | None = None
    fields:     dict       = {}


@router.post("/ingest/batch", status_code=202)
async def batch_ingest(
    events: list[BatchEvent],
    user:   User            = Depends(get_current_user),
    db:     AsyncSession    = Depends(get_db),
):
    from core.redis import get_redis
    redis = get_redis()
    count = 0
    for ev in events:
        ts = None
        if ev.timestamp:
            try:
                ts = datetime.fromisoformat(ev.timestamp.replace("Z", "+00:00"))
            except ValueError:
                pass
        await _ingest_one(
            db, str(user.tenant_id), ev.message,
            timestamp   = ts,
            index_name  = ev.index,
            source      = ev.source,
            sourcetype  = ev.sourcetype,
            host        = ev.host,
            extra       = ev.fields,
            redis       = redis,
        )
        count += 1
    return {"accepted": count}


# ─── File upload ingest ───────────────────────────────────────────────────────

@router.post("/upload", status_code=202)
async def upload_logs(
    file:       UploadFile      = File(...),
    index:      str             = Query("main"),
    sourcetype: str | None      = Query(None),
    host:       str | None      = Query(None),
    source:     str | None      = Query(None),
    user:       User            = Depends(get_current_user),
    db:         AsyncSession    = Depends(get_db),
):
    from core.redis import get_redis
    redis = get_redis()

    raw = await file.read()
    parsed_lines = parse_bytes(raw, sourcetype or "_auto")
    count = 0
    for st, parsed in parsed_lines:
        if not parsed:
            continue
        await _ingest_one(
            db, str(user.tenant_id),
            parsed.get("message", ""),
            timestamp   = parsed.get("timestamp"),
            index_name  = index,
            source      = source or file.filename,
            sourcetype  = sourcetype or st,
            host        = host or parsed.get("host"),
            extra       = parsed.get("fields", {}),
            redis       = redis,
        )
        count += 1

    return {"accepted": count, "filename": file.filename}


# ─── Sync from existing app tables ───────────────────────────────────────────

@router.post("/sync", status_code=202)
async def sync_internal(
    user: User         = Depends(get_current_user),
    db:   AsyncSession = Depends(get_db),
):
    """Pull recent events from DNS, Alerts, Scans → log_events."""
    from core.redis import get_redis
    from models.alert import Alert
    from models.dns import DnsQuery
    from models.scan import Scan

    redis  = get_redis()
    since  = datetime.now(timezone.utc) - timedelta(days=7)
    tid    = str(user.tenant_id)
    count  = 0

    # Alerts → security index
    alerts = (await db.execute(
        select(Alert)
        .where(and_(Alert.tenant_id == user.tenant_id, Alert.triggered_at >= since))
        .order_by(Alert.triggered_at)
    )).scalars().all()
    for a in alerts:
        msg = f"[{a.severity.upper()}] {a.title}: {a.description}"
        await _ingest_one(
            db, tid, msg,
            timestamp   = a.triggered_at,
            index_name  = "security",
            source      = f"alert:{a.source}",
            sourcetype  = "vex:alert",
            host        = "vex",
            extra       = {
                "alert_id": str(a.id), "severity": a.severity,
                "category": a.category, "status": a.status,
            },
            redis       = redis,
        )
        count += 1

    # DNS queries → dns index
    dns_rows = (await db.execute(
        select(DnsQuery)
        .where(and_(DnsQuery.tenant_id == user.tenant_id, DnsQuery.queried_at >= since))
        .order_by(DnsQuery.queried_at)
    )).scalars().all()
    for d in dns_rows:
        severity = "error" if d.is_malicious else ("warning" if d.is_blocked else "info")
        msg = f"DNS {d.query_type} {d.domain} → {d.response_code or 'unknown'}"
        await _ingest_one(
            db, tid, msg,
            timestamp   = d.queried_at,
            index_name  = "dns",
            source      = "dns",
            sourcetype  = "dns:query",
            host        = str(d.device_id) if d.device_id else "unknown",
            extra       = {
                "domain": d.domain, "query_type": d.query_type,
                "rcode": d.response_code, "resolved_ip": d.resolved_ip,
                "is_malicious": str(d.is_malicious), "is_blocked": str(d.is_blocked),
            },
            redis       = redis,
        )
        count += 1

    # Scans → network index
    scans = (await db.execute(
        select(Scan)
        .where(and_(Scan.tenant_id == user.tenant_id, Scan.created_at >= since))
        .order_by(Scan.created_at)
    )).scalars().all()
    for s in scans:
        if not s.completed_at:
            continue
        msg = f"Network scan {s.scan_type} completed: {s.devices_found} devices, {s.new_devices} new"
        await _ingest_one(
            db, tid, msg,
            timestamp   = s.completed_at,
            index_name  = "network",
            source      = "scan",
            sourcetype  = "vex:scan",
            host        = "vex",
            extra       = {
                "scan_type": s.scan_type, "status": s.status,
                "devices_found": str(s.devices_found), "new_devices": str(s.new_devices),
            },
            redis       = redis,
        )
        count += 1

    return {"synced": count}


# ─── Search ───────────────────────────────────────────────────────────────────

TIME_PRESETS: dict[str, timedelta] = {
    "last_15m":  timedelta(minutes=15),
    "last_1h":   timedelta(hours=1),
    "last_4h":   timedelta(hours=4),
    "last_24h":  timedelta(hours=24),
    "last_7d":   timedelta(days=7),
    "last_30d":  timedelta(days=30),
}


class SearchRequest(BaseModel):
    query:      str   = "*"
    time_range: str   = "last_24h"
    time_from:  str | None = None  # ISO 8601 — override time_range
    time_to:    str | None = None
    limit:      int   = 1000


def _resolve_time(req: SearchRequest) -> tuple[datetime, datetime]:
    t_to = datetime.now(timezone.utc)
    if req.time_from and req.time_to:
        t_from = datetime.fromisoformat(req.time_from.replace("Z", "+00:00"))
        t_to   = datetime.fromisoformat(req.time_to.replace("Z", "+00:00"))
    else:
        delta  = TIME_PRESETS.get(req.time_range, timedelta(hours=24))
        t_from = t_to - delta
    return t_from, t_to


@router.post("/search")
async def search_logs(
    req:  SearchRequest,
    user: User         = Depends(get_current_user),
    db:   AsyncSession = Depends(get_db),
):
    t_from, t_to = _resolve_time(req)
    result = await run_search(
        db, str(user.tenant_id), req.query, t_from, t_to, req.limit
    )
    result["time_from"] = t_from.isoformat()
    result["time_to"]   = t_to.isoformat()
    return result


@router.get("/search/count")
async def count_over_time(
    time_range: str        = Query("last_24h"),
    user:       User       = Depends(get_current_user),
    db:         AsyncSession = Depends(get_db),
):
    """Event count bucketed over time — used for the top-of-search timeline."""
    req = SearchRequest(query="*", time_range=time_range)
    t_from, t_to = _resolve_time(req)
    result = await run_search(
        db, str(user.tenant_id), "* | timechart count", t_from, t_to
    )
    return result


# ─── Saved searches ───────────────────────────────────────────────────────────

class SavedSearchIn(BaseModel):
    name:          str
    description:   str | None = None
    query:         str
    time_range:    str        = "last_24h"
    viz_type:      str | None = None
    is_dashboard:  bool       = False
    dashboard_order: int      = 0


@router.get("/saved")
async def list_saved(
    user: User         = Depends(get_current_user),
    db:   AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(SavedSearch)
        .where(SavedSearch.tenant_id == user.tenant_id)
        .order_by(SavedSearch.dashboard_order, SavedSearch.created_at)
    )).scalars().all()
    return [_serialize_ss(s) for s in rows]


@router.post("/saved", status_code=201)
async def create_saved(
    body: SavedSearchIn,
    user: User         = Depends(get_current_user),
    db:   AsyncSession = Depends(get_db),
):
    ss = SavedSearch(tenant_id=user.tenant_id, **body.model_dump())
    db.add(ss)
    await db.flush()
    return _serialize_ss(ss)


@router.get("/saved/{ss_id}")
async def get_saved(ss_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ss = await _get_ss(ss_id, user, db)
    return _serialize_ss(ss)


@router.patch("/saved/{ss_id}")
async def update_saved(
    ss_id: uuid.UUID,
    body:  SavedSearchIn,
    user:  User         = Depends(get_current_user),
    db:    AsyncSession = Depends(get_db),
):
    ss = await _get_ss(ss_id, user, db)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ss, k, v)
    return _serialize_ss(ss)


@router.delete("/saved/{ss_id}", status_code=204)
async def delete_saved(
    ss_id: uuid.UUID,
    user:  User         = Depends(get_current_user),
    db:    AsyncSession = Depends(get_db),
):
    ss = await _get_ss(ss_id, user, db)
    await db.delete(ss)


async def _get_ss(ss_id: uuid.UUID, user: User, db: AsyncSession) -> SavedSearch:
    ss = (await db.execute(
        select(SavedSearch).where(
            SavedSearch.id == ss_id,
            SavedSearch.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if not ss:
        raise HTTPException(404, "Saved search not found")
    return ss


def _serialize_ss(s: SavedSearch) -> dict:
    return {
        "id":              str(s.id),
        "name":            s.name,
        "description":     s.description,
        "query":           s.query,
        "time_range":      s.time_range,
        "viz_type":        s.viz_type,
        "is_dashboard":    s.is_dashboard,
        "dashboard_order": s.dashboard_order,
        "created_at":      s.created_at.isoformat(),
    }


# ─── Meta endpoints ───────────────────────────────────────────────────────────

@router.get("/indexes")
async def list_indexes(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from services.active_network import get_active_network_id
    network_id = await get_active_network_id()
    q = (
        select(LogEvent.index_name, func.count().label("count"))
        .where(LogEvent.tenant_id == user.tenant_id)
    )
    if network_id:
        q = q.where((LogEvent.network_id == network_id) | LogEvent.network_id.is_(None))
    rows = (await db.execute(q.group_by(LogEvent.index_name).order_by(func.count().desc()))).fetchall()
    return [{"name": r[0], "count": r[1]} for r in rows]


@router.get("/sourcetypes")
async def list_sourcetypes(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from services.active_network import get_active_network_id
    network_id = await get_active_network_id()
    q = (
        select(LogEvent.sourcetype, func.count().label("count"))
        .where(and_(LogEvent.tenant_id == user.tenant_id, LogEvent.sourcetype.isnot(None)))
    )
    if network_id:
        q = q.where((LogEvent.network_id == network_id) | LogEvent.network_id.is_(None))
    rows = (await db.execute(q.group_by(LogEvent.sourcetype).order_by(func.count().desc()).limit(50))).fetchall()
    return [{"name": r[0], "count": r[1]} for r in rows]


@router.get("/stats")
async def log_stats(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from services.active_network import get_active_network_id
    network_id = await get_active_network_id()
    since_24h = datetime.now(timezone.utc) - timedelta(hours=24)

    net_clause = ((LogEvent.network_id == network_id) | LogEvent.network_id.is_(None)) if network_id else True

    total = (await db.execute(
        select(func.count()).select_from(LogEvent).where(
            and_(LogEvent.tenant_id == user.tenant_id, net_clause)
        )
    )).scalar() or 0
    last_24h = (await db.execute(
        select(func.count()).select_from(LogEvent).where(
            and_(LogEvent.tenant_id == user.tenant_id, LogEvent.timestamp >= since_24h, net_clause)
        )
    )).scalar() or 0
    critical = (await db.execute(
        select(func.count()).select_from(LogEvent).where(
            and_(LogEvent.tenant_id == user.tenant_id,
                 LogEvent.timestamp >= since_24h,
                 LogEvent.severity.in_(["critical", "error"]),
                 net_clause)
        )
    )).scalar() or 0
    return {"total_events": total, "last_24h": last_24h, "critical_24h": critical}
