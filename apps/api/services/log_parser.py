"""
Log format parsers.

Each parser receives raw bytes/string and returns a list of dicts:
    {
        "timestamp": datetime | None,
        "message":   str,
        "severity":  str | None,
        "host":      str | None,
        "source":    str | None,
        "fields":    dict,
    }

Auto-detection order: JSON → Syslog RFC 5424 → Syslog RFC 3164 →
  Apache/Nginx access → CEF → key=value → plain text
"""
import json
import re
from datetime import datetime, timezone
from typing import Any


# ─── Severity mapping helpers ─────────────────────────────────────────────────

_SYSLOG_SEV = {
    0: "emergency", 1: "alert", 2: "critical", 3: "error",
    4: "warning",   5: "notice", 6: "info",    7: "debug",
}

_WORD_SEV = re.compile(
    r'\b(emerg(?:ency)?|alert|crit(?:ical)?|err(?:or)?|warn(?:ing)?|notice|info(?:rmation(?:al)?)?|debug)\b',
    re.IGNORECASE,
)

def _normalise_sev(raw: str | None) -> str | None:
    if raw is None:
        return None
    raw = raw.lower()
    mapping = {
        "emerg": "critical", "emergency": "critical", "alert": "critical",
        "crit": "critical",  "critical": "critical",
        "err":  "error",     "error": "error",
        "warn": "warning",   "warning": "warning",
        "notice": "notice",  "info": "info", "information": "info",
        "informational": "info", "debug": "debug",
    }
    return mapping.get(raw, raw)


def _guess_sev(message: str) -> str | None:
    m = _WORD_SEV.search(message)
    if m:
        return _normalise_sev(m.group(1))
    if re.search(r'\b(500|503|502|504)\b', message):
        return "error"
    if re.search(r'\b(4\d{2})\b', message):
        return "warning"
    return "info"


# ─── Timestamp parsers ────────────────────────────────────────────────────────

_TS_FORMATS = [
    "%Y-%m-%dT%H:%M:%S.%fZ",
    "%Y-%m-%dT%H:%M:%SZ",
    "%Y-%m-%dT%H:%M:%S.%f%z",
    "%Y-%m-%dT%H:%M:%S%z",
    "%Y-%m-%d %H:%M:%S.%f",
    "%Y-%m-%d %H:%M:%S",
    "%b %d %H:%M:%S",
    "%b  %d %H:%M:%S",
]

def _parse_ts(raw: str) -> datetime | None:
    raw = raw.strip()
    for fmt in _TS_FORMATS:
        try:
            dt = datetime.strptime(raw, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return None


# ─── JSON parser ─────────────────────────────────────────────────────────────

def _try_json(line: str) -> dict | None:
    line = line.strip()
    if not (line.startswith("{") or line.startswith("[")):
        return None
    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        return None

    if isinstance(data, list):
        data = data[0] if data else {}

    ts_raw = (
        data.get("timestamp") or data.get("time") or data.get("@timestamp")
        or data.get("ts") or data.get("event_time") or data.get("date")
    )
    ts = _parse_ts(str(ts_raw)) if ts_raw else None

    message = (
        data.get("message") or data.get("msg") or data.get("log")
        or data.get("event") or line
    )
    if isinstance(message, dict):
        message = json.dumps(message)

    # Suricata EVE
    if "event_type" in data:
        return _parse_suricata_eve(data)

    host = (
        data.get("host") or data.get("hostname") or data.get("source_host")
        or data.get("logsource") or data.get("computer_name")
    )
    if isinstance(host, dict):
        host = host.get("name") or host.get("ip")

    sev_raw = data.get("severity") or data.get("level") or data.get("log_level")
    fields = {k: _flatten(v) for k, v in data.items()
              if k not in ("message", "msg", "log", "timestamp", "time", "@timestamp", "ts", "host")}

    return {
        "timestamp": ts,
        "message":   str(message),
        "severity":  _normalise_sev(str(sev_raw)) if sev_raw else _guess_sev(str(message)),
        "host":      str(host) if host else None,
        "source":    data.get("source") or data.get("src") or data.get("file"),
        "fields":    fields,
    }


def _flatten(val: Any) -> Any:
    if isinstance(val, (dict, list)):
        return json.dumps(val)
    return val


def _parse_suricata_eve(data: dict) -> dict:
    evt = data.get("event_type", "flow")
    ts = _parse_ts(data.get("timestamp", "")) or datetime.now(timezone.utc)
    src = data.get("src_ip", "")
    dst = data.get("dest_ip", "")
    sport = data.get("src_port", "")
    dport = data.get("dest_port", "")
    proto = data.get("proto", "")

    if evt == "alert":
        alert = data.get("alert", {})
        msg = f"{alert.get('signature', 'Alert')} [{src}:{sport} → {dst}:{dport}]"
        sev = "error" if alert.get("severity", 3) <= 2 else "warning"
    elif evt == "dns":
        dns = data.get("dns", {})
        rrname = dns.get("rrname", "?")
        msg = f"DNS {dns.get('type','query')} {rrname} [{src} → {dst}]"
        sev = "info"
    elif evt == "http":
        http = data.get("http", {})
        msg = (f"{http.get('http_method','?')} {http.get('hostname','')}"
               f"{http.get('url','')} → {http.get('status','')} [{src}:{sport}]")
        sev = "error" if str(http.get("status", 0)).startswith("5") else "info"
    elif evt == "tls":
        tls = data.get("tls", {})
        msg = f"TLS {tls.get('version','')} {tls.get('sni',dst)} [{src}:{sport} → {dst}:{dport}]"
        sev = "info"
    elif evt == "flow":
        msg = (f"Flow {proto} {src}:{sport} → {dst}:{dport} "
               f"bytes={data.get('flow', {}).get('bytes_toserver', 0)}")
        sev = "info"
    else:
        msg = f"Suricata {evt}: {src} → {dst}"
        sev = "info"

    fields = {
        "src_ip":    src,  "dst_ip":   dst,
        "src_port":  str(sport) if sport else None,
        "dst_port":  str(dport) if dport else None,
        "proto":     proto,
        "event_type": evt,
    }

    if evt == "alert":
        a = data.get("alert", {})
        fields.update({"signature": a.get("signature"), "category": a.get("category"), "sid": str(a.get("signature_id", ""))})
    elif evt == "dns":
        d = data.get("dns", {})
        fields.update({"rrname": d.get("rrname"), "rrtype": d.get("rrtype"), "rcode": d.get("rcode")})
    elif evt == "http":
        h = data.get("http", {})
        fields.update({"hostname": h.get("hostname"), "url": h.get("url"), "status": str(h.get("status", ""))})

    return {
        "timestamp": ts,
        "message":   msg,
        "severity":  sev,
        "host":      data.get("host", "suricata"),
        "source":    "suricata",
        "fields":    {k: v for k, v in fields.items() if v is not None},
    }


# ─── Syslog RFC 5424 ──────────────────────────────────────────────────────────

_SYSLOG5424 = re.compile(
    r'^<(\d+)>1 (\S+) (\S+) (\S+) (\S+) (\S+) (\S+|-) ?(.*)$'
)

def _try_syslog5424(line: str) -> dict | None:
    m = _SYSLOG5424.match(line.strip())
    if not m:
        return None
    pri, ts_raw, host, app, pid, msgid, sd, msg = m.groups()
    pri = int(pri)
    sev = _normalise_sev(_SYSLOG_SEV.get(pri & 0x07, "info"))
    ts  = _parse_ts(ts_raw)
    return {
        "timestamp": ts,
        "message":   msg.strip(),
        "severity":  sev,
        "host":      host if host != "-" else None,
        "source":    f"{app}[{pid}]" if pid != "-" else app,
        "fields":    {"app": app, "pid": pid, "msgid": msgid, "facility": pri >> 3},
    }


# ─── Syslog RFC 3164 ──────────────────────────────────────────────────────────

_SYSLOG3164 = re.compile(
    r'^<(\d+)>([A-Za-z]{3}\s+\d{1,2} \d{2}:\d{2}:\d{2}) (\S+) (\S+?): ?(.*)$'
)

def _try_syslog3164(line: str) -> dict | None:
    m = _SYSLOG3164.match(line.strip())
    if not m:
        return None
    pri, ts_raw, host, app, msg = m.groups()
    pri = int(pri)
    sev = _normalise_sev(_SYSLOG_SEV.get(pri & 0x07, "info"))
    ts  = _parse_ts(ts_raw.strip())
    return {
        "timestamp": ts,
        "message":   msg.strip(),
        "severity":  sev,
        "host":      host,
        "source":    app,
        "fields":    {"app": app, "facility": pri >> 3},
    }


# ─── Apache / Nginx combined access log ──────────────────────────────────────

_APACHE_ACCESS = re.compile(
    r'^(\S+) \S+ (\S+) \[([^\]]+)\] "([A-Z]+) ([^ ]+) HTTP/[\d.]+" (\d+) (\d+|-)(?: "([^"]*)")?(?: "([^"]*)")?'
)

def _try_apache_access(line: str) -> dict | None:
    m = _APACHE_ACCESS.match(line.strip())
    if not m:
        return None
    ip, user, ts_raw, method, path, status, size, referer, ua = m.groups()
    ts     = _parse_ts(ts_raw.replace(":", " ", 1))
    status = int(status)
    sev    = "error" if status >= 500 else ("warning" if status >= 400 else "info")
    msg    = f'{method} {path} {status} [{ip}]'
    return {
        "timestamp": ts,
        "message":   msg,
        "severity":  sev,
        "host":      ip,
        "source":    "apache:access",
        "fields":    {
            "src_ip": ip, "user": user if user != "-" else None,
            "method": method, "uri": path, "status": str(status),
            "bytes": size if size != "-" else None,
            "referer": referer, "user_agent": ua,
        },
    }


# ─── CEF (ArcSight Common Event Format) ──────────────────────────────────────

_CEF_HEADER = re.compile(
    r'^CEF:(\d+)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|(\d+)\|(.*)$'
)

def _try_cef(line: str) -> dict | None:
    m = _CEF_HEADER.match(line.strip())
    if not m:
        return None
    _ver, vendor, product, version, sig, name, severity_raw, ext = m.groups()
    severity_num = int(severity_raw)
    if severity_num >= 8:
        sev = "critical"
    elif severity_num >= 6:
        sev = "error"
    elif severity_num >= 4:
        sev = "warning"
    else:
        sev = "info"

    fields: dict = {"vendor": vendor, "product": product, "sig_id": sig}
    for kv in re.findall(r'(\w+)=(.*?)(?=\s+\w+=|$)', ext):
        fields[kv[0]] = kv[1].strip()

    host = fields.pop("dhost", fields.pop("shost", None))
    return {
        "timestamp": _parse_ts(fields.pop("rt", "")) or datetime.now(timezone.utc),
        "message":   name,
        "severity":  sev,
        "host":      host,
        "source":    f"{vendor}:{product}",
        "fields":    fields,
    }


# ─── Key=value (logfmt) ──────────────────────────────────────────────────────

_KV_PAIR = re.compile(r'(\w[\w.]*?)=("(?:[^"\\]|\\.)*"|\S+)')

def _try_logfmt(line: str) -> dict | None:
    pairs = _KV_PAIR.findall(line)
    if len(pairs) < 2:
        return None
    fields = {k: v.strip('"') for k, v in pairs}
    ts_raw = fields.pop("time", fields.pop("ts", fields.pop("timestamp", None)))
    msg    = fields.pop("msg", fields.pop("message", line))
    sev    = _normalise_sev(fields.pop("level", fields.pop("severity", None)))
    host   = fields.pop("host", fields.pop("hostname", None))
    return {
        "timestamp": _parse_ts(str(ts_raw)) if ts_raw else None,
        "message":   msg,
        "severity":  sev or _guess_sev(msg),
        "host":      host,
        "source":    fields.pop("source", None),
        "fields":    fields,
    }


# ─── Public API ──────────────────────────────────────────────────────────────

_PARSERS = [
    ("json",         _try_json),
    ("syslog:rfc5424", _try_syslog5424),
    ("syslog:rfc3164", _try_syslog3164),
    ("apache:access",  _try_apache_access),
    ("cef",            _try_cef),
    ("logfmt",         _try_logfmt),
]


def parse_line(line: str, sourcetype: str | None = None) -> tuple[str, dict]:
    """
    Parse a single log line.
    Returns (detected_sourcetype, parsed_dict).
    parsed_dict always has: timestamp, message, severity, host, source, fields
    """
    line = line.rstrip("\r\n")
    if not line:
        return ("empty", {})

    if sourcetype and sourcetype != "_auto":
        # Try the requested parser first
        for st, fn in _PARSERS:
            if st == sourcetype or sourcetype.startswith(st):
                result = fn(line)
                if result:
                    return (sourcetype, result)

    for st, fn in _PARSERS:
        result = fn(line)
        if result:
            return (st, result)

    # Plain text fallback
    return ("plain", {
        "timestamp": None,
        "message":   line,
        "severity":  _guess_sev(line),
        "host":      None,
        "source":    None,
        "fields":    {},
    })


def parse_bytes(raw: bytes, sourcetype: str | None = None, encoding: str = "utf-8") -> list[tuple[str, dict]]:
    """Parse multi-line content (file upload) into a list of events."""
    text = raw.decode(encoding, errors="replace")
    results = []
    for line in text.splitlines():
        if line.strip():
            results.append(parse_line(line, sourcetype))
    return results
