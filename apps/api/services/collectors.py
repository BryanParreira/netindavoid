"""
Real data collectors for macOS — no root/sudo required.

Traffic: polls netstat -ibn for interface byte counters, stores deltas.
DNS:     PTR reverse-lookups on all ARP-discovered LAN IPs (real DNS queries).
"""
import asyncio
import json
import subprocess
from datetime import datetime, timezone
from typing import Optional

import structlog

logger = structlog.get_logger()

# Active interface — en0 is WiFi, en1 is Ethernet on most Macs
ACTIVE_IFACE = "en0"


# ── Traffic ───────────────────────────────────────────────────────────────────

def _netstat_bytes(iface: str = ACTIVE_IFACE) -> tuple[int, int]:
    """Return (bytes_in, bytes_out) for the given interface via netstat -ibn."""
    try:
        out = subprocess.run(["netstat", "-ibn"], capture_output=True, text=True, timeout=5).stdout
        for line in out.splitlines():
            parts = line.split()
            if parts and parts[0] == iface and len(parts) >= 10:
                # Link-level row: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
                try:
                    return int(parts[6]), int(parts[9])
                except (ValueError, IndexError):
                    continue
    except Exception as e:
        logger.warning("netstat failed", error=str(e))
    return 0, 0


async def collect_traffic(tenant_id: str, redis_client) -> Optional[dict]:
    """
    Read interface counters, compute delta since last sample, store in DB.
    Returns the stored traffic row dict or None if no change.
    """
    from core.database import AsyncSessionLocal
    from models.traffic import TrafficSample

    bytes_in, bytes_out = _netstat_bytes()
    if bytes_in == 0 and bytes_out == 0:
        return None

    now = datetime.now(timezone.utc)
    cursor_key = f"traffic:cursor:{tenant_id}"

    prev_raw = await redis_client.get(cursor_key)
    prev = json.loads(prev_raw) if prev_raw else None

    await redis_client.set(cursor_key, json.dumps({
        "bytes_in": bytes_in, "bytes_out": bytes_out, "ts": now.isoformat()
    }), ex=3600)

    if not prev:
        return None  # first run — no delta yet

    delta_in  = max(bytes_in  - prev["bytes_in"],  0)
    delta_out = max(bytes_out - prev["bytes_out"], 0)

    # Counters reset on reboot — ignore implausibly large deltas (> 1 GB/sample)
    if delta_in > 1_000_000_000 or delta_out > 1_000_000_000:
        return None

    async with AsyncSessionLocal() as db:
        import uuid
        sample = TrafficSample(
            tenant_id=uuid.UUID(tenant_id),
            device_id=None,
            sampled_at=now,
            bytes_in=delta_in,
            bytes_out=delta_out,
            packets_in=0,
            packets_out=0,
        )
        db.add(sample)
        await db.commit()

    return {"bytes_in": delta_in, "bytes_out": delta_out}


# ── DNS ───────────────────────────────────────────────────────────────────────

def _arp_ips() -> list[str]:
    """IPs in the OS ARP table that have a valid (non-incomplete) MAC address."""
    import re
    try:
        # -an: numeric IPs, no hostname resolution
        out = subprocess.run(["arp", "-an"], capture_output=True, text=True, timeout=15).stdout
        ips = []
        for line in out.splitlines():
            # Skip entries with no resolved MAC ("(incomplete)")
            if "incomplete" in line or "(none)" in line:
                continue
            # Must have a MAC-like pattern: xx:xx:xx:xx:xx:xx
            if not re.search(r'[0-9a-f]{1,2}:[0-9a-f]{1,2}:[0-9a-f]{1,2}', line, re.I):
                continue
            m = re.search(r'\((\d+\.\d+\.\d+\.\d+)\)', line)
            if m:
                ip = m.group(1)
                if not ip.startswith("169.254"):  # skip APIPA link-local
                    ips.append(ip)
        return ips
    except Exception:
        return []


def _ptr_lookup(ip: str) -> Optional[str]:
    """Reverse DNS lookup for an IP. Returns hostname or None."""
    try:
        import dns.reversename
        import dns.resolver
        rev = dns.reversename.from_address(ip)
        answers = dns.resolver.resolve(rev, "PTR", lifetime=2.0)
        return str(answers[0]).rstrip(".")
    except Exception:
        return None


def _forward_lookup(hostname: str) -> Optional[str]:
    """Forward DNS A lookup. Returns first IP or None."""
    try:
        import dns.resolver
        answers = dns.resolver.resolve(hostname, "A", lifetime=2.0)
        return str(answers[0])
    except Exception:
        return None


# Known ad/tracker domains (lightweight blocklist)
_BLOCKLIST = {
    "doubleclick.net", "googlesyndication.com", "google-analytics.com",
    "googletagmanager.com", "fbcdn.net", "scorecardresearch.com",
    "quantserve.com", "adsrvr.org", "adnxs.com",
    "moatads.com", "rubiconproject.com", "openx.net", "pubmatic.com",
    "advertising.com", "outbrain.com", "taboola.com", "criteo.com",
    "amazon-adsystem.com",
}

_MALICIOUS_KEYWORDS = {
    "malware", "c2server", "botnet", "phish", "trojan",
    "coinhive", "cryptonight", "xmrig", "miner.",
}


def _is_blocked(domain: str) -> bool:
    return any(b in domain for b in _BLOCKLIST)


def _is_malicious(domain: str) -> bool:
    return any(m in domain.lower() for m in _MALICIOUS_KEYWORDS)


async def collect_dns(tenant_id: str, redis_client) -> int:
    """
    PTR reverse-lookup every IP in the ARP table → real DNS queries to the LAN DNS server.
    Stores new (hostname, ip) pairs in dns_queries.
    Returns count of new entries stored.
    """
    from core.database import AsyncSessionLocal
    from models.dns import DnsQuery
    import uuid

    ips = _arp_ips()
    if not ips:
        return 0

    seen_key = f"dns:seen:{tenant_id}"
    new_count = 0
    now = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as db:
        for ip in ips:
            cache_key_ptr = f"PTR:{ip}"
            already = await redis_client.sismember(seen_key, cache_key_ptr)

            hostname = _ptr_lookup(ip)
            domain = hostname or f"{ip}.in-addr.arpa"
            rcode = "NOERROR" if hostname else "NXDOMAIN"

            if not already:
                await redis_client.sadd(seen_key, cache_key_ptr)
                await redis_client.expire(seen_key, 86400)

                record = DnsQuery(
                    tenant_id=uuid.UUID(tenant_id),
                    device_id=None,
                    queried_at=now,
                    domain=domain,
                    query_type="PTR",
                    response_code=rcode,
                    is_blocked=False,
                    is_malicious=_is_malicious(domain),
                    source="ptr_scan",
                )
                db.add(record)
                new_count += 1

            # If we got a real hostname, also log a forward A lookup
            if hostname:
                cache_key_a = f"A:{hostname}"
                already_a = await redis_client.sismember(seen_key, cache_key_a)
                if not already_a:
                    await redis_client.sadd(seen_key, cache_key_a)
                    resolved_ip = _forward_lookup(hostname)
                    record_a = DnsQuery(
                        tenant_id=uuid.UUID(tenant_id),
                        device_id=None,
                        queried_at=now,
                        domain=hostname,
                        query_type="A",
                        response_code="NOERROR" if resolved_ip else "NXDOMAIN",
                        is_blocked=_is_blocked(hostname),
                        is_malicious=_is_malicious(hostname),
                        source="ptr_scan",
                    )
                    db.add(record_a)
                    new_count += 1

        if new_count:
            await db.commit()

    return new_count
