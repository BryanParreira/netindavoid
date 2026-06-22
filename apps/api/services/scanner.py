"""Network scanner: ARP sweep + nmap OS/port fingerprint."""
import asyncio
import subprocess
import re
import socket
from datetime import datetime, timezone
from typing import Any

import nmap
import structlog

from core.config import settings
from services.oui import lookup_vendor

logger = structlog.get_logger()


def _arp_scan(cidr: str) -> list[dict[str, str]]:
    """Run arp-scan and parse output. Returns list of {ip, mac, vendor}."""
    try:
        result = subprocess.run(
            ["arp-scan", "--localnet", cidr, "--quiet"],
            capture_output=True, text=True, timeout=30
        )
        hosts = []
        for line in result.stdout.splitlines():
            # Format: "192.168.1.10    aa:bb:cc:dd:ee:ff    Vendor Name"
            match = re.match(r"^(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f:]{17})\s*(.*)", line.strip(), re.IGNORECASE)
            if match:
                hosts.append({
                    "ip": match.group(1),
                    "mac": match.group(2).upper(),
                    "vendor_raw": match.group(3).strip(),
                })
        return hosts
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        logger.warning("arp-scan failed, falling back to nmap ARP", error=str(e))
        return _nmap_arp_scan(cidr)


def _nmap_arp_scan(cidr: str) -> list[dict[str, str]]:
    """nmap ARP+ping scan merged with OS ARP cache. Most reliable on LAN."""
    # ARP cache first — instant, catches sleeping/low-power devices
    arp_hosts = {h["ip"]: h for h in _read_arp_cache(cidr)}

    try:
        nm = nmap.PortScanner()
        # -PR: ARP ping — most reliable on local subnet, no root needed for ARP on LAN
        nm.scan(hosts=cidr, arguments="-sn -PR -T4 --host-timeout 15s", sudo=settings.NMAP_SUDO)
        for host in nm.all_hosts():
            if nm[host].state() == "up":
                addresses = nm[host].get("addresses", {})
                raw_mac = addresses.get("mac", "")
                mac = raw_mac.upper()
                if not mac:
                    mac = _mac_from_arp_cache(host) or arp_hosts.get(host, {}).get("mac", "")
                if mac:
                    arp_hosts[host] = {
                        "ip": host,
                        "mac": mac,
                        "vendor_raw": nm[host].get("vendor", {}).get(raw_mac, ""),
                    }
    except Exception as e:
        logger.warning("nmap scan failed, using ARP cache only", error=str(e))

    return [h for h in arp_hosts.values() if h.get("mac")]


def _mac_from_arp_cache(ip: str) -> str:
    """Look up a single IP in the OS ARP cache."""
    try:
        out = subprocess.run(["arp", "-n", ip], capture_output=True, text=True, timeout=5).stdout
        for line in out.splitlines():
            m = re.search(r"([0-9a-f]{1,2}[:\-]){5}[0-9a-f]{1,2}", line, re.IGNORECASE)
            if m:
                raw = m.group(0)
                # Normalise to xx:xx:xx:xx:xx:xx
                parts = re.split(r"[:\-]", raw)
                return ":".join(p.zfill(2) for p in parts).upper()
    except Exception:
        pass
    return ""


def _read_arp_cache(cidr: str) -> list[dict[str, str]]:
    """Read the OS ARP table — instant, no root needed. macOS + Linux."""
    try:
        # -an: numeric output (no DNS), much faster, avoids timeout
        out = subprocess.run(["arp", "-an"], capture_output=True, text=True, timeout=15).stdout
    except Exception:
        return []

    # Trigger ARP population by pinging the subnet broadcast first
    try:
        import ipaddress
        net = ipaddress.ip_network(cidr, strict=False)
        subprocess.run(
            ["ping", "-c1", "-W1", str(net.broadcast_address)],
            capture_output=True, timeout=3,
        )
    except Exception:
        pass

    hosts = []
    seen_ips: set[str] = set()
    for line in out.splitlines():
        # macOS: hostname (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope ...
        # Linux: 192.168.1.1 ether aa:bb:cc:dd:ee:ff ...
        ip_m = re.search(r"\((\d+\.\d+\.\d+\.\d+)\)", line) or re.search(r"^(\d+\.\d+\.\d+\.\d+)", line)
        mac_m = re.search(r"([0-9a-f]{1,2}[:\-]){5}[0-9a-f]{1,2}", line, re.IGNORECASE)
        if not ip_m or not mac_m:
            continue
        ip = ip_m.group(1)
        if ip in seen_ips or ip.endswith(".255") or ip == "0.0.0.0":
            continue
        seen_ips.add(ip)
        raw_mac = mac_m.group(0)
        parts = re.split(r"[:\-]", raw_mac)
        mac = ":".join(p.zfill(2) for p in parts).upper()
        if mac == "FF:FF:FF:FF:FF:FF":
            continue
        hosts.append({"ip": ip, "mac": mac, "vendor_raw": ""})

    return hosts


def _nmap_os_scan(ip: str) -> dict[str, Any]:
    """Detect OS, device type, and open ports for a single host."""
    nm = nmap.PortScanner()

    # Try aggressive scan with sudo for OS detection first; fall back to version scan only
    scan_attempts = [
        ("-A --top-ports 1000 -T4 --host-timeout 60s", settings.NMAP_SUDO),
        ("-sV --top-ports 1000 -T4 --host-timeout 60s", False),
    ]

    for args, use_sudo in scan_attempts:
        try:
            nm.scan(hosts=ip, arguments=args, sudo=use_sudo)
            if ip not in nm.all_hosts():
                continue

            host = nm[ip]
            os_matches = host.get("osmatch", [])
            os_guess = os_matches[0]["name"] if os_matches else None
            device_type = None
            if os_matches:
                classes = os_matches[0].get("osclass", [])
                if classes:
                    device_type = classes[0].get("type")

            open_ports: dict[str, list] = {}
            for proto in host.all_protocols():
                open_ports[proto] = [
                    {
                        "port": p,
                        "state": host[proto][p]["state"],
                        "service": host[proto][p].get("name", ""),
                        "version": host[proto][p].get("version", ""),
                        "product": host[proto][p].get("product", ""),
                        "extrainfo": host[proto][p].get("extrainfo", ""),
                    }
                    for p in host[proto].keys()
                    if host[proto][p]["state"] == "open"
                ]

            return {
                "os_guess": os_guess,
                "device_type": device_type,
                "open_ports": open_ports,
            }
        except Exception as e:
            logger.warning("nmap scan attempt failed", ip=ip, args=args, error=str(e))

    return {}


def _resolve_hostname(ip: str) -> str | None:
    try:
        return socket.gethostbyaddr(ip)[0]
    except Exception:
        return None


def scan_network(cidr: str) -> list[dict[str, Any]]:
    """Full network scan: ARP + hostname resolution + OUI lookup."""
    logger.info("Starting network scan", cidr=cidr)
    hosts = _arp_scan(cidr)
    results = []

    for host in hosts:
        mac = host["mac"]
        ip = host["ip"]
        vendor = lookup_vendor(mac) or host.get("vendor_raw") or None
        hostname = _resolve_hostname(ip)

        results.append({
            "mac_address": mac,
            "ip_address": ip,
            "hostname": hostname,
            "vendor": vendor,
            "last_seen_at": datetime.now(timezone.utc).isoformat(),
        })

    logger.info("Network scan complete", found=len(results))
    return results


def scan_device_ports(ip: str) -> dict[str, Any]:
    """Deep scan a single device for OS + ports."""
    return _nmap_os_scan(ip)
