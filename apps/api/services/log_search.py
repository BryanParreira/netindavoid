"""
SPL-like search engine — translates pipe queries to PostgreSQL.

Supported syntax:
  <base search> | <pipe> | <pipe> ...

Base search tokens:
  word          → message ILIKE '%word%'
  field=value   → exact match (column or JSONB field)
  field!=value  → not equal
  NOT word      → exclude
  "multi word"  → phrase match in message

Column shortcuts: index, host, source, sourcetype, severity, message

Pipe commands:
  stats [count] [avg|sum|max|min|dc(field)] [by f1,f2]
  timechart [span=Xs|m|h|d] count [by field]
  top [N] field
  where field OP value
  sort [-]field
  head N
  tail N
  fields f1 f2
  rex "(?P<name>pat)"
  dedup field
"""
import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, or_, func, select, cast, Float, text
from sqlalchemy.ext.asyncio import AsyncSession

from models.log_event import LogEvent


# ── Constants ─────────────────────────────────────────────────────────────────

COLUMN_MAP: dict[str, str] = {
    "index":      "index_name",
    "host":       "host",
    "source":     "source",
    "sourcetype": "sourcetype",
    "severity":   "severity",
    "message":    "message",
}

# time-range seconds → bucket seconds
_BUCKET_THRESHOLDS = [
    (3_600,           60),    # ≤1h  → 1min
    (3_600 * 4,       300),   # ≤4h  → 5min
    (3_600 * 24,      900),   # ≤24h → 15min
    (3_600 * 24 * 7,  3_600), # ≤7d  → 1h
    (float("inf"),    86_400), # >7d  → 1d
]


def _auto_bucket(t_from: datetime, t_to: datetime) -> int:
    delta = (t_to - t_from).total_seconds()
    for threshold, secs in _BUCKET_THRESHOLDS:
        if delta <= threshold:
            return secs
    return 86_400


# ── SPL tokeniser ─────────────────────────────────────────────────────────────

_FIELD_OP = re.compile(r'^([A-Za-z_][\w.]*)(!?=|>=?|<=?)(.+)$')
_PIPE_SPLIT = re.compile(r'\s*\|\s*(?=(?:[^"\']*["\'][^"\']*["\'])*[^"\']*$)')
_TOKEN_RE   = re.compile(r'"[^"]*"|\'[^\']*\'|\S+')


def _col(field: str):
    """Return the SQLAlchemy column expression for a field name."""
    col_name = COLUMN_MAP.get(field)
    if col_name:
        return getattr(LogEvent, col_name)
    return LogEvent.fields[field].astext


def _col_numeric(field: str):
    col_name = COLUMN_MAP.get(field)
    if col_name:
        return cast(getattr(LogEvent, col_name), Float)
    return cast(LogEvent.fields[field].astext, Float)


def _build_field_cond(field: str, op: str, value: str):
    col = _col(field)
    if op == "=":
        return col == value
    if op == "!=":
        return col != value
    if op == ">":
        return cast(col, Float) > float(value)
    if op == "<":
        return cast(col, Float) < float(value)
    if op == ">=":
        return cast(col, Float) >= float(value)
    if op == "<=":
        return cast(col, Float) <= float(value)
    return col == value


def _parse_spl(query: str) -> tuple[list[dict], list[dict]]:
    """
    Returns (base_tokens, pipes).
    base_tokens: [{type: "text"|"field", term?, field?, op?, value?, negate: bool}]
    pipes:       [{cmd, args}]
    """
    parts = _PIPE_SPLIT.split(query.strip())
    base_str  = parts[0].strip()
    pipe_strs = [p.strip() for p in parts[1:] if p.strip()]

    base_tokens: list[dict] = []
    negate = False
    for token in _TOKEN_RE.findall(base_str):
        if token.upper() == "NOT" or token == "-":
            negate = True
            continue
        m = _FIELD_OP.match(token)
        if m:
            base_tokens.append({"type": "field", "field": m.group(1),
                                 "op": m.group(2), "value": m.group(3).strip("\"'"),
                                 "negate": negate})
        else:
            base_tokens.append({"type": "text", "term": token.strip("\"'"), "negate": negate})
        negate = False

    pipes: list[dict] = []
    for p in pipe_strs:
        head, _, rest = p.partition(" ")
        pipes.append({"cmd": head.lower(), "args": rest.strip()})

    return base_tokens, pipes


def _build_where(tenant_id: str, tokens: list[dict], t_from: datetime, t_to: datetime) -> list:
    conds: list = [
        LogEvent.tenant_id == tenant_id,
        LogEvent.timestamp >= t_from,
        LogEvent.timestamp <= t_to,
    ]
    for tok in tokens:
        if tok["type"] == "field":
            try:
                cond = _build_field_cond(tok["field"], tok["op"], tok["value"])
            except Exception:
                continue
            conds.append(~cond if tok["negate"] else cond)
        else:
            term = tok["term"]
            if not term:
                continue
            cond = func.lower(LogEvent.message).contains(term.lower())
            conds.append(~cond if tok["negate"] else cond)
    return conds


# ── Aggregation helpers ───────────────────────────────────────────────────────

def _time_bucket_expr(bucket_secs: int):
    """PG-compatible time bucket (works with or without TimescaleDB)."""
    return text(
        f"to_timestamp(floor(extract(epoch from timestamp) / {bucket_secs}) * {bucket_secs})"
        " AT TIME ZONE 'UTC'"
    )


def _parse_by_fields(args: str) -> tuple[str, list[str]]:
    """Split 'stats_part by f1, f2' → (stats_part, [f1, f2])."""
    m = re.search(r'\bby\s+(.+)$', args.strip())
    if m:
        stats_part = args[:m.start()].strip()
        by_fields  = [f.strip() for f in m.group(1).split(",") if f.strip()]
    else:
        stats_part = args.strip()
        by_fields  = []
    return stats_part, by_fields


def _parse_agg_fns(stats_part: str) -> list[dict]:
    """Parse 'count avg(bytes) max(dur)' → list of {fn, field, alias}."""
    fns: list[dict] = []
    for tok in stats_part.split():
        if tok == "count":
            fns.append({"fn": "count", "field": None, "alias": "count"})
        else:
            m = re.match(r'(\w+)\((\w+)\)', tok)
            if m:
                fn, field = m.group(1).lower(), m.group(2)
                fns.append({"fn": fn, "field": field, "alias": f"{fn}_{field}"})
    return fns or [{"fn": "count", "field": None, "alias": "count"}]


def _agg_expr(af: dict):
    """Build SQLAlchemy aggregate expression for one fn spec."""
    fn, field = af["fn"], af["field"]
    if fn == "count":
        return func.count()
    num_col = _col_numeric(field) if field else None
    if fn == "sum":
        return func.sum(num_col)
    if fn == "avg":
        return func.avg(num_col)
    if fn == "max":
        return func.max(num_col)
    if fn == "min":
        return func.min(num_col)
    if fn == "dc":  # distinct count
        return func.count(func.distinct(_col(field)))
    return func.count()


# ── Main engine ───────────────────────────────────────────────────────────────

def _serialize_event(e: LogEvent) -> dict:
    return {
        "id":         str(e.id),
        "timestamp":  e.timestamp.isoformat(),
        "index":      e.index_name,
        "source":     e.source,
        "sourcetype": e.sourcetype,
        "host":       e.host,
        "message":    e.message,
        "severity":   e.severity,
        "fields":     e.fields or {},
    }


async def run_search(
    db:        AsyncSession,
    tenant_id: str,
    query:     str,
    t_from:    datetime,
    t_to:      datetime,
    limit:     int = 1000,
) -> dict:
    tokens, pipes = _parse_spl(query)
    where = _build_where(tenant_id, tokens, t_from, t_to)

    # Find first aggregation pipe
    agg_idx = next(
        (i for i, p in enumerate(pipes) if p["cmd"] in ("stats", "timechart", "top")),
        None,
    )

    if agg_idx is not None:
        agg_pipe   = pipes[agg_idx]
        post_pipes = pipes[agg_idx + 1:]
        return await _run_agg(db, where, agg_pipe, post_pipes, t_from, t_to)

    return await _run_events(db, where, pipes, limit)


# ── Event search ──────────────────────────────────────────────────────────────

async def _run_events(db: AsyncSession, where: list, pipes: list, limit: int) -> dict:
    q = (
        select(LogEvent)
        .where(and_(*where))
        .order_by(LogEvent.timestamp.desc())
        .limit(limit)
    )
    for p in pipes:
        if p["cmd"] == "head":
            with _suppress():
                q = q.limit(int(p["args"]))
        elif p["cmd"] == "tail":
            with _suppress():
                q = q.order_by(LogEvent.timestamp).limit(int(p["args"]))

    rows = (await db.execute(q)).scalars().all()
    total = (await db.execute(select(func.count()).select_from(LogEvent).where(and_(*where)))).scalar() or 0

    return {"type": "events", "total": total, "events": [_serialize_event(e) for e in rows]}


# ── Aggregations ──────────────────────────────────────────────────────────────

async def _run_agg(db: AsyncSession, where: list, agg_pipe: dict, post_pipes: list, t_from: datetime, t_to: datetime) -> dict:
    cmd  = agg_pipe["cmd"]
    args = agg_pipe["args"]

    if cmd == "timechart":
        return await _run_timechart(db, where, args, t_from, t_to)
    if cmd == "top":
        return await _run_top(db, where, args, post_pipes)
    if cmd == "stats":
        return await _run_stats(db, where, args, post_pipes)

    return {"type": "events", "total": 0, "events": []}


async def _run_timechart(db: AsyncSession, where: list, args: str, t_from: datetime, t_to: datetime) -> dict:
    # Optional span= override
    span_m = re.search(r'\bspan=(\d+)([smhd]?)\b', args)
    if span_m:
        n, unit = int(span_m.group(1)), span_m.group(2) or "s"
        bucket_secs = n * {"s": 1, "m": 60, "h": 3600, "d": 86400}.get(unit, 1)
    else:
        bucket_secs = _auto_bucket(t_from, t_to)

    by_m = re.search(r'\bby\s+(\w+)', args)
    by_field = by_m.group(1) if by_m else None

    tb = _time_bucket_expr(bucket_secs).label("_time")

    if by_field:
        grp_col = func.coalesce(_col(by_field), "other").label("_series")
        result  = await db.execute(
            select(tb, grp_col, func.count().label("count"))
            .where(and_(*where))
            .group_by(text("1"), text("2"))
            .order_by(text("1"))
        )
        rows_raw = result.fetchall()

        pivot: dict[str, dict] = {}
        series_set: set[str] = set()
        for ts_val, series_val, cnt in rows_raw:
            ts_str = ts_val.isoformat() if ts_val else ""
            sv = str(series_val)
            series_set.add(sv)
            pivot.setdefault(ts_str, {"_time": ts_str})[sv] = cnt

        series_names = sorted(series_set)
        return {
            "type":    "timechart",
            "series":  series_names,
            "columns": ["_time"] + series_names,
            "rows":    list(pivot.values()),
        }

    result = await db.execute(
        select(tb, func.count().label("count"))
        .where(and_(*where))
        .group_by(text("1"))
        .order_by(text("1"))
    )
    rows = [{"_time": r[0].isoformat() if r[0] else "", "count": r[1]} for r in result.fetchall()]
    return {"type": "timechart", "series": ["count"], "columns": ["_time", "count"], "rows": rows}


async def _run_top(db: AsyncSession, where: list, args: str, post_pipes: list) -> dict:
    parts = args.strip().split()
    n = 10
    field_name = ""
    if parts:
        try:
            n = int(parts[0])
            field_name = parts[1] if len(parts) > 1 else ""
        except ValueError:
            field_name = parts[0]

    if not field_name:
        return {"type": "stats", "columns": [], "rows": []}

    grp_col = func.coalesce(_col(field_name), "null").label("value")
    total   = (await db.execute(select(func.count()).select_from(LogEvent).where(and_(*where)))).scalar() or 1

    result = await db.execute(
        select(grp_col, func.count().label("count"))
        .where(and_(*where))
        .group_by(text("1"))
        .order_by(func.count().desc())
        .limit(n)
    )
    rows = [
        {field_name: r[0], "count": r[1], "percent": round(r[1] / total * 100, 2)}
        for r in result.fetchall()
    ]
    return {"type": "stats", "columns": [field_name, "count", "percent"], "rows": rows}


async def _run_stats(db: AsyncSession, where: list, args: str, post_pipes: list) -> dict:
    stats_part, by_fields = _parse_by_fields(args)
    agg_fns = _parse_agg_fns(stats_part)

    # Build select list
    select_exprs = []
    col_names:   list[str] = []

    for bf in by_fields:
        col = func.coalesce(_col(bf), "null").label(bf)
        select_exprs.append(col)
        col_names.append(bf)

    for af in agg_fns:
        expr = _agg_expr(af).label(af["alias"])
        select_exprs.append(expr)
        col_names.append(af["alias"])

    q = select(*select_exprs).where(and_(*where))
    if by_fields:
        q = q.group_by(*select_exprs[: len(by_fields)])

    # Default sort: first agg desc
    if len(by_fields) < len(select_exprs):
        q = q.order_by(select_exprs[len(by_fields)].desc())

    for p in post_pipes:
        if p["cmd"] == "sort" and p["args"]:
            desc = p["args"].startswith("-")
            sf   = p["args"].lstrip("-")
            if sf in col_names:
                i    = col_names.index(sf)
                q    = q.order_by(select_exprs[i].desc() if desc else select_exprs[i])
        elif p["cmd"] == "head":
            with _suppress():
                q = q.limit(int(p["args"]))

    result   = await db.execute(q)
    rows_raw = result.fetchall()

    rows = []
    for r in rows_raw:
        row: dict[str, Any] = {}
        for i, name in enumerate(col_names):
            val = r[i]
            if isinstance(val, float):
                val = round(val, 4)
            elif val is not None:
                val = str(val) if not isinstance(val, (int,)) else val
            row[name] = val
        rows.append(row)

    return {"type": "stats", "columns": col_names, "rows": rows}


# ── helpers ───────────────────────────────────────────────────────────────────

class _suppress:
    """Silently swallow any exception in a with block."""
    def __enter__(self):     return self
    def __exit__(self, *_):  return True


Any = Any  # re-export for type hints inside file
