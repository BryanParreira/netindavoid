"""
Auto-detect the active network interface and subnet — works on any LAN.
No root required. macOS + Linux compatible.
"""
import ipaddress
import re
import socket
import subprocess
from functools import lru_cache

import structlog

logger = structlog.get_logger()


def _default_route_iface_macos() -> str | None:
    """Ask the routing table which interface handles the default route."""
    try:
        out = subprocess.run(
            ["route", "-n", "get", "default"],
            capture_output=True, text=True, timeout=5,
        ).stdout
        for line in out.splitlines():
            if "interface:" in line:
                return line.split()[-1].strip()
    except Exception:
        pass
    return None


def _default_route_iface_linux() -> str | None:
    try:
        out = subprocess.run(
            ["ip", "route", "show", "default"],
            capture_output=True, text=True, timeout=5,
        ).stdout
        # "default via 192.168.1.1 dev eth0 ..."
        m = re.search(r"dev\s+(\S+)", out)
        if m:
            return m.group(1)
    except Exception:
        pass
    return None


def get_active_interface() -> str:
    """Return the interface name carrying the default route."""
    iface = _default_route_iface_macos() or _default_route_iface_linux()
    if iface:
        return iface
    # Last resort: connect UDP to 8.8.8.8, read local IP, match to interface
    try:
        local_ip = _local_ip_via_udp()
        if local_ip:
            out = subprocess.run(["ifconfig"], capture_output=True, text=True, timeout=5).stdout
            current_iface = None
            for line in out.splitlines():
                m = re.match(r"^(\S+):", line)
                if m:
                    current_iface = m.group(1)
                if current_iface and local_ip in line:
                    return current_iface
    except Exception:
        pass
    return "en0"


def _local_ip_via_udp() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(3)
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return None


def get_local_ip() -> str:
    """Return the LAN IP of this machine."""
    try:
        iface = get_active_interface()
        out = subprocess.run(["ifconfig", iface], capture_output=True, text=True, timeout=5).stdout
        m = re.search(r"inet\s+(\d+\.\d+\.\d+\.\d+)", out)
        if m:
            ip = m.group(1)
            if not ip.startswith("127."):
                return ip
    except Exception:
        pass
    return _local_ip_via_udp() or "127.0.0.1"


def get_subnet_cidr() -> str:
    """
    Return the CIDR for the LAN subnet, e.g. '192.168.1.0/24'.
    Works on WiFi, Ethernet, VPN — adapts to whatever network is active.
    """
    try:
        iface = get_active_interface()
        out = subprocess.run(["ifconfig", iface], capture_output=True, text=True, timeout=5).stdout

        # macOS: inet 192.168.1.5 netmask 0xffffff00
        m = re.search(r"inet\s+(\d+\.\d+\.\d+\.\d+)\s+netmask\s+(0x[0-9a-f]+|\d+\.\d+\.\d+\.\d+)", out, re.I)
        if m:
            ip   = m.group(1)
            mask = m.group(2)
            if mask.startswith("0x"):
                mask_int = int(mask, 16)
                mask = socket.inet_ntoa(mask_int.to_bytes(4, "big"))
            net = ipaddress.IPv4Network(f"{ip}/{mask}", strict=False)
            # Cap at /16 — don't scan a /8 corporate network
            if net.prefixlen < 16:
                net = ipaddress.IPv4Network(f"{ip}/24", strict=False)
            return str(net)
    except Exception as e:
        logger.warning("subnet detection failed", error=str(e))

    # Fallback: guess /24 from local IP
    local = _local_ip_via_udp()
    if local and not local.startswith("127."):
        parts = local.split(".")
        return f"{parts[0]}.{parts[1]}.{parts[2]}.0/24"

    return "192.168.1.0/24"


def get_gateway() -> str | None:
    """Return the default gateway IP."""
    try:
        out = subprocess.run(
            ["route", "-n", "get", "default"],
            capture_output=True, text=True, timeout=5,
        ).stdout
        for line in out.splitlines():
            if "gateway:" in line:
                return line.split()[-1].strip()
    except Exception:
        pass
    try:
        out = subprocess.run(
            ["ip", "route", "show", "default"],
            capture_output=True, text=True, timeout=5,
        ).stdout
        m = re.search(r"via\s+(\S+)", out)
        if m:
            return m.group(1)
    except Exception:
        pass
    return None


def get_dns_servers() -> list[str]:
    """Read /etc/resolv.conf or scutil for DNS servers."""
    servers: list[str] = []
    try:
        out = subprocess.run(
            ["scutil", "--dns"],
            capture_output=True, text=True, timeout=5,
        ).stdout
        for line in out.splitlines():
            m = re.search(r"nameserver\[0\]\s*:\s*(\d+\.\d+\.\d+\.\d+)", line)
            if m and m.group(1) not in servers:
                servers.append(m.group(1))
        if servers:
            return servers[:4]
    except Exception:
        pass
    try:
        with open("/etc/resolv.conf") as f:
            for line in f:
                if line.startswith("nameserver"):
                    ip = line.split()[1]
                    if ip not in servers:
                        servers.append(ip)
    except Exception:
        pass
    return servers


def get_gateway_mac() -> str | None:
    """
    Return the MAC address of the default gateway.
    This is the stable fingerprint for a physical network —
    unique per router regardless of subnet or IP assignment.
    """
    gw_ip = get_gateway()
    if not gw_ip:
        return None
    try:
        from services.scanner import _mac_from_arp_cache
        mac = _mac_from_arp_cache(gw_ip)
        return mac.upper() if mac else None
    except Exception:
        return None


def get_ssid() -> str | None:
    """
    Try to read the current WiFi SSID on macOS.
    Returns None on failure or if on Ethernet.
    """
    try:
        result = subprocess.run(
            ["/System/Library/PrivateFrameworks/Apple80211.framework"
             "/Versions/Current/Resources/airport", "-I"],
            capture_output=True, text=True, timeout=5,
        )
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.startswith("SSID:"):
                return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return None


def network_info() -> dict:
    """All network info in one call — used by the /network/info endpoint."""
    iface  = get_active_interface()
    local  = get_local_ip()
    cidr   = get_subnet_cidr()
    gw     = get_gateway()
    dns    = get_dns_servers()
    return {
        "interface":   iface,
        "local_ip":    local,
        "subnet_cidr": cidr,
        "gateway":     gw,
        "dns_servers": dns,
    }
