"""
WiFi Intelligence Service — ESP32Marauder-inspired features on macOS:
  - AP scanner (beacon frames → SSID, BSSID, channel, signal, security, PHY)
  - Probe request monitor (who's probing for what SSIDs)
  - Deauth / disassoc detector (attack detection)
  - Rogue AP detector (known BSSID vs new BSSID for same SSID)
  - Client-to-AP association tracking
  - Monitor mode managed via sudo tcpdump -I en0
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()

TCPDUMP = shutil.which("tcpdump") or "/opt/homebrew/bin/tcpdump"
IFACE   = "en0"

# ── CoreWLAN for current connection info ─────────────────────────────────────

def current_connection() -> dict:
    """Return current Wi-Fi connection details (no sudo needed)."""
    try:
        import CoreWLAN
        client = CoreWLAN.CWWiFiClient.sharedWiFiClient()
        iface  = client.interface()
        ch     = iface.wlanChannel()
        band_raw = str(ch.channelBand()) if ch else ""
        band = "5GHz" if "5" in band_raw else ("6GHz" if "6" in band_raw else "2.4GHz")
        return {
            "interface":   str(iface.interfaceName() or IFACE),
            "ssid":        str(iface.ssid() or "(private — macOS 14+)"),
            "bssid":       str(iface.bssid() or "(private — macOS 14+)"),
            "rssi":        int(iface.rssiValue()),
            "noise":       int(iface.noiseMeasurement()),
            "snr":         int(iface.rssiValue()) - int(iface.noiseMeasurement()),
            "channel":     int(ch.channelNumber()) if ch else 0,
            "band":        band,
            "tx_rate":     0,
        }
    except Exception as e:
        logger.warning("current_connection error", error=str(e))
        return {"error": str(e)}


# ── system_profiler fallback (no monitor mode, no SSID due to privacy) ───────

def scan_aps_sysprofile() -> list[dict]:
    """Scan nearby APs using system_profiler — no sudo, but SSIDs/BSSIDs hidden on macOS 14+."""
    try:
        result = subprocess.run(
            ["system_profiler", "SPAirPortDataType"],
            capture_output=True, text=True, timeout=30,
        )
        lines = result.stdout.splitlines()
        aps = []
        current: dict = {}

        def flush():
            nonlocal current
            if current:
                aps.append(current)
                current = {}

        in_other = False
        for line in lines:
            stripped = line.strip()
            if "Other Local Wi-Fi Networks" in line:
                in_other = True
                continue
            if in_other or "Current Network" not in line:
                if re.match(r"^\w.*:$", stripped) and ":" in stripped and not any(k in stripped for k in ("Channel", "Security", "Signal", "PHY", "Network", "Country")):
                    flush()
                    current = {"ssid": stripped.rstrip(":")}
                m = re.match(r"Channel:\s*(\d+)\s*\((.+?)\)", stripped)
                if m:
                    current["channel"] = int(m.group(1))
                    current["band"] = m.group(2).split(",")[0].strip()
                m = re.match(r"Security:\s*(.+)", stripped)
                if m:
                    current["security"] = m.group(1).strip()
                m = re.match(r"Signal / Noise:\s*(-?\d+)\s*dBm\s*/\s*(-?\d+)\s*dBm", stripped)
                if m:
                    current["rssi"]  = int(m.group(1))
                    current["noise"] = int(m.group(2))
                    current["snr"]   = int(m.group(1)) - int(m.group(2))
        flush()
        return [a for a in aps if a.get("channel")]
    except Exception as e:
        logger.warning("system_profiler scan error", error=str(e))
        return []


# ── Monitor-mode capture via tcpdump -I ──────────────────────────────────────

# 802.11 frame type/subtype constants
FT_MGMT   = 0
FT_CTRL   = 1
FT_DATA   = 2

ST_ASSOC_REQ  = 0
ST_ASSOC_RESP = 1
ST_PROBE_REQ  = 4
ST_PROBE_RESP = 5
ST_BEACON     = 8
ST_DISASSOC   = 10
ST_AUTH       = 11
ST_DEAUTH     = 12

# Security OUI/type detection from RSN/WPA IEs
RSN_OUI = bytes([0x00, 0x0F, 0xAC])
WPA_OUI = bytes([0x00, 0x50, 0xF2, 0x01])

_MONITOR_ACTIVE = threading.Event()
_MONITOR_LOCK   = threading.Lock()
_LATEST_RESULTS: dict[str, Any] = {}


def _parse_ies(ie_data: bytes) -> dict:
    """Parse 802.11 Information Elements into a dict {id: bytes}."""
    ies: dict[int, bytes] = {}
    i = 0
    while i + 1 < len(ie_data):
        ie_id  = ie_data[i]
        ie_len = ie_data[i + 1]
        if i + 2 + ie_len > len(ie_data):
            break
        ies[ie_id] = ie_data[i + 2: i + 2 + ie_len]
        i += 2 + ie_len
    return ies


def _security_from_ies(ies: dict) -> str:
    if 48 in ies:  # RSN IE
        return "WPA3 Personal" if b"\x00\x0f\xac\x08" in ies[48] else "WPA2 Personal"
    if 221 in ies and ies[221][:4] == WPA_OUI:
        return "WPA Personal"
    return "Open"


def _phy_from_ies(ies: dict) -> str:
    if 191 in ies:  return "802.11ax (Wi-Fi 6)"
    if 127 in ies:  return "802.11ac (Wi-Fi 5)"
    if 61 in ies:   return "802.11n (Wi-Fi 4)"
    return "802.11a/b/g"


def _capture_pcap(seconds: int = 12) -> bytes | None:
    """Run tcpdump in monitor mode for `seconds` seconds, return raw pcap bytes."""
    if not Path(TCPDUMP).exists():
        logger.error("tcpdump not found", path=TCPDUMP)
        return None
    try:
        # -I = monitor mode, -i en0, -s 0 = full packet, -U = unbuffered
        # filter: only management frames (type 0)
        proc = subprocess.run(
            ["sudo", "-n", TCPDUMP, "-I", "-i", IFACE,
             "-s", "0", "-w", "-",
             "-G", str(seconds), "-W", "1",
             "type mgt"],
            capture_output=True, timeout=seconds + 5,
        )
        return proc.stdout if proc.stdout else None
    except subprocess.TimeoutExpired as e:
        return e.stdout if e.stdout else None
    except Exception as e:
        logger.warning("tcpdump capture error", error=str(e))
        return None


def _parse_pcap(raw: bytes) -> dict[str, Any]:
    """Parse pcap bytes with scapy, extract APs/probes/deauths."""
    try:
        from scapy.all import rdpcap, PcapReader
        from scapy.layers.dot11 import (
            Dot11, Dot11Beacon, Dot11ProbeReq, Dot11ProbeResp,
            Dot11Elt, Dot11Deauth, Dot11Disas, Dot11AssoReq,
            RadioTap,
        )
        import io
    except ImportError:
        return {"error": "scapy not installed"}

    aps:    dict[str, dict] = {}   # bssid → ap_info
    probes: list[dict] = []
    deauths: list[dict] = []
    clients: dict[str, set] = defaultdict(set)  # bssid → {client_macs}

    seen_probes: set[tuple] = set()

    try:
        pkts = rdpcap(io.BytesIO(raw))
    except Exception as e:
        logger.warning("pcap parse error", error=str(e))
        return {"aps": [], "probes": [], "deauths": [], "clients": []}

    now = datetime.now(timezone.utc).isoformat()

    for pkt in pkts:
        if not pkt.haslayer(Dot11):
            continue

        dot11  = pkt[Dot11]
        fc_type    = dot11.type
        fc_subtype = dot11.subtype
        src = str(dot11.addr2 or "")
        dst = str(dot11.addr1 or "")
        bssid_field = str(dot11.addr3 or "")

        # Signal from RadioTap
        rssi = None
        if pkt.haslayer(RadioTap):
            try:
                rssi = int(pkt[RadioTap].dBm_AntSignal)
            except Exception:
                pass

        # ── Beacon ───────────────────────────────────────────────────────────
        if fc_type == FT_MGMT and fc_subtype == ST_BEACON and pkt.haslayer(Dot11Beacon):
            bssid = src
            ssid  = ""
            channel = 0
            ie_bytes = b""

            elt = pkt.getlayer(Dot11Elt)
            while elt:
                if elt.ID == 0:
                    try: ssid = elt.info.decode(errors="replace")
                    except: ssid = ""
                elif elt.ID == 3:
                    try: channel = elt.info[0]
                    except: pass
                ie_bytes += bytes([elt.ID, len(elt.info)]) + bytes(elt.info)
                elt = elt.payload.getlayer(Dot11Elt)

            ies = _parse_ies(ie_bytes)
            security = _security_from_ies(ies)
            phy = _phy_from_ies(ies)

            if bssid and bssid != "ff:ff:ff:ff:ff:ff":
                if bssid not in aps:
                    aps[bssid] = {
                        "ssid": ssid or "(hidden)",
                        "bssid": bssid,
                        "channel": channel,
                        "rssi": rssi or -99,
                        "security": security,
                        "phy": phy,
                        "clients": 0,
                        "first_seen": now,
                    }
                else:
                    if rssi: aps[bssid]["rssi"] = rssi
                    if ssid: aps[bssid]["ssid"] = ssid

        # ── Probe Request ─────────────────────────────────────────────────────
        elif fc_type == FT_MGMT and fc_subtype == ST_PROBE_REQ:
            ssid = ""
            elt = pkt.getlayer(Dot11Elt)
            while elt:
                if elt.ID == 0:
                    try: ssid = elt.info.decode(errors="replace")
                    except: ssid = ""
                elt = elt.payload.getlayer(Dot11Elt)

            key = (src, ssid)
            if key not in seen_probes:
                seen_probes.add(key)
                probes.append({
                    "mac":  src,
                    "ssid": ssid or "(wildcard — any AP)",
                    "rssi": rssi,
                    "ts":   now,
                })

        # ── Deauth / Disassoc ─────────────────────────────────────────────────
        elif fc_type == FT_MGMT and fc_subtype in (ST_DEAUTH, ST_DISASSOC):
            frame_type = "deauth" if fc_subtype == ST_DEAUTH else "disassoc"
            reason = 0
            try:
                if fc_subtype == ST_DEAUTH and pkt.haslayer(Dot11Deauth):
                    reason = pkt[Dot11Deauth].reason
                elif pkt.haslayer(Dot11Disas):
                    reason = pkt[Dot11Disas].reason
            except Exception:
                pass
            deauths.append({
                "type":   frame_type,
                "src":    src,
                "dst":    dst,
                "bssid":  bssid_field,
                "reason": reason,
                "ts":     now,
            })

        # ── Association Request ───────────────────────────────────────────────
        elif fc_type == FT_MGMT and fc_subtype == ST_ASSOC_REQ:
            bssid = bssid_field or dst
            if bssid and src:
                clients[bssid].add(src)

    # Populate client count on APs
    for bssid, mac_set in clients.items():
        if bssid in aps:
            aps[bssid]["clients"] = len(mac_set)

    return {
        "aps":     sorted(aps.values(), key=lambda x: x["rssi"], reverse=True),
        "probes":  probes,
        "deauths": deauths,
        "clients": [{"bssid": b, "macs": list(ms)} for b, ms in clients.items()],
        "captured_at": now,
    }


def _detect_rogues(aps: list[dict], known: dict[str, str]) -> list[dict]:
    """
    Detect rogue APs: same SSID but different BSSID from what we've seen before.
    `known` is {ssid: bssid} from previous trusted scan.
    """
    rogues = []
    for ap in aps:
        ssid = ap["ssid"]
        if ssid == "(hidden)" or not ssid:
            continue
        bssid = ap["bssid"]
        if ssid in known and known[ssid] != bssid:
            rogues.append({
                **ap,
                "rogue_reason": f"SSID '{ssid}' seen before on {known[ssid]}, now on {bssid}",
            })
    return rogues


# ── Public API ────────────────────────────────────────────────────────────────

def check_monitor_mode_available() -> bool:
    """Check if we can run tcpdump in monitor mode without a password."""
    try:
        result = subprocess.run(
            ["sudo", "-n", TCPDUMP, "--version"],
            capture_output=True, timeout=3,
        )
        return result.returncode == 0
    except Exception:
        return False


def wifi_scan(duration_secs: int = 12, known_aps: dict[str, str] | None = None) -> dict[str, Any]:
    """
    Full WiFi intelligence scan:
    - Puts en0 in monitor mode for `duration_secs` seconds (WiFi disconnects briefly)
    - Returns: APs, probe requests, deauth events, rogue APs, client associations
    """
    if not check_monitor_mode_available():
        # Fallback: system_profiler only (no SSID/BSSID, no probes)
        aps = scan_aps_sysprofile()
        conn = current_connection()
        return {
            "mode": "passive",
            "warning": "Monitor mode unavailable. Run scripts/setup-wifi-intel.sh to enable full scanning.",
            "current_connection": conn,
            "aps": aps,
            "probes": [],
            "deauths": [],
            "rogues": [],
            "clients": [],
        }

    raw = _capture_pcap(duration_secs)
    if not raw or len(raw) < 24:
        return {"error": "Capture returned no data — check tcpdump permissions or Wi-Fi interface"}

    parsed = _parse_pcap(raw)
    rogues = _detect_rogues(parsed.get("aps", []), known_aps or {})
    conn   = current_connection()

    return {
        "mode":               "monitor",
        "duration_secs":      duration_secs,
        "current_connection": conn,
        "aps":                parsed.get("aps", []),
        "probes":             parsed.get("probes", []),
        "deauths":            parsed.get("deauths", []),
        "clients":            parsed.get("clients", []),
        "rogues":             rogues,
        "captured_at":        parsed.get("captured_at"),
        "stats": {
            "aps_found":      len(parsed.get("aps", [])),
            "probes_seen":    len(parsed.get("probes", [])),
            "deauth_events":  len(parsed.get("deauths", [])),
            "rogues_found":   len(rogues),
        },
    }


def signal_strength_label(rssi: int) -> str:
    if rssi >= -50:  return "Excellent"
    if rssi >= -60:  return "Good"
    if rssi >= -70:  return "Fair"
    if rssi >= -80:  return "Weak"
    return "Very Weak"
