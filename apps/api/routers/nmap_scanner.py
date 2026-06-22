"""Nmap scanner — REST endpoints. WebSocket streaming handler lives in websocket.py."""
import re
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.deps import get_current_user, require_admin
from models.user import User

router = APIRouter(prefix="/nmap", tags=["nmap"])

SCAN_PROFILES: dict[str, dict] = {
    "ping":  {"args": "-sn -T4",                     "label": "Host Discovery",  "desc": "Find live hosts, no port scan"},
    "quick": {"args": "-F -T4 -sV",                  "label": "Quick Scan",      "desc": "Top 100 ports + service version"},
    "ports": {"args": "--top-ports 1000 -T4 -sV",    "label": "Port Scan",       "desc": "Top 1000 ports + service version"},
    "os":    {"args": "-O -sV -T4 --top-ports 1000", "label": "OS Detection",    "desc": "OS fingerprint + top 1000 ports (requires root)"},
    "full":  {"args": "-A -T4",                      "label": "Aggressive",      "desc": "OS + versions + scripts + traceroute"},
    "vuln":  {"args": "-sV --script vuln -T4",       "label": "Vuln Scan",       "desc": "Service version + NSE vulnerability scripts"},
}

# In-memory scan store — ephemeral, cleared on restart
_scan_store: dict[str, dict] = {}


class ScanRequest(BaseModel):
    target: str
    profile: str = "quick"


@router.get("/profiles")
async def list_profiles():
    return [{"id": k, **v} for k, v in SCAN_PROFILES.items()]


@router.post("/scan", status_code=202)
async def create_scan(
    body: ScanRequest,
    user: User = Depends(require_admin),
):
    profile = body.profile if body.profile in SCAN_PROFILES else "quick"
    scan_id = str(uuid.uuid4())
    _scan_store[scan_id] = {
        "id":      scan_id,
        "target":  body.target,
        "profile": profile,
        "status":  "pending",
        "output":  [],
        "hosts":   [],
        "error":   None,
    }
    return {"scan_id": scan_id}


@router.get("/scan/{scan_id}")
async def get_scan(scan_id: str, user: User = Depends(get_current_user)):
    scan = _scan_store.get(scan_id)
    if not scan:
        raise HTTPException(404, "Scan not found")
    return scan


def _parse_nmap_output(output: str) -> list[dict]:
    """Parse nmap plain-text output into a structured host list."""
    hosts: list[dict] = []
    current: dict | None = None

    for line in output.splitlines():
        line = line.strip()

        # "Nmap scan report for hostname (IP)" or "… for IP"
        m = re.match(r"Nmap scan report for (.+?)(?:\s+\((\d+\.\d+\.\d+\.\d+)\))?$", line)
        if m:
            if current:
                hosts.append(current)
            name = m.group(1).strip()
            ip   = m.group(2) or (name if re.match(r"^\d+\.\d+\.\d+\.\d+$", name) else "")
            hostname = name if m.group(2) else None
            current = {"ip": ip, "hostname": hostname, "status": "up", "ports": [], "os": None}
            continue

        if current is None:
            continue

        # PORT  STATE  SERVICE  VERSION
        pm = re.match(r"(\d+)/(tcp|udp)\s+(open|closed|filtered|open\|filtered)\s+(\S+)(?:\s+(.+))?", line)
        if pm:
            current["ports"].append({
                "port":    int(pm.group(1)),
                "proto":   pm.group(2),
                "state":   pm.group(3),
                "service": pm.group(4),
                "version": (pm.group(5) or "").strip(),
            })
            continue

        # OS detection
        om = re.match(r"OS details:\s+(.+)", line) or re.match(r"Aggressive OS guesses:\s+(.+)", line)
        if om and not current.get("os"):
            current["os"] = om.group(1).split(",")[0].strip()

    if current:
        hosts.append(current)

    return hosts
