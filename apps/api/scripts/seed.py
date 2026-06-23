#!/usr/bin/env python3
"""
Seed script — populates fake but realistic network data so the dashboard
can be fully demoed without real network hardware.

Usage:
    python -m scripts.seed
    python -m scripts.seed --clear   # wipe and re-seed
"""
import asyncio
import random
import sys
import uuid
from datetime import datetime, timezone, timedelta

import argparse
import structlog

logger = structlog.get_logger()

FAKE_DEVICES = [
    {"display_name": "Ana's MacBook Pro", "mac": "A4:C3:F0:11:22:33", "ip": "192.168.1.10", "vendor": "Apple Inc.", "hostname": "anas-macbook.local", "category": "computer", "os_guess": "macOS 14.x", "device_type": "general purpose"},
    {"display_name": "Living Room TV", "mac": "F0:1D:BC:44:55:66", "ip": "192.168.1.11", "vendor": "Samsung Electronics", "hostname": "samsung-tv.local", "category": "media", "os_guess": "Tizen 7.0", "device_type": "media device"},
    {"display_name": "Ring Doorbell", "mac": "B8:27:EB:77:88:99", "ip": "192.168.1.12", "vendor": "Ring LLC", "hostname": None, "category": "iot", "os_guess": "Linux", "device_type": "security camera"},
    {"display_name": "Bryan's iPhone", "mac": "3C:22:FB:AA:BB:CC", "ip": "192.168.1.13", "vendor": "Apple Inc.", "hostname": "bryans-iphone.local", "category": "mobile", "os_guess": "iOS 17.x", "device_type": "phone"},
    {"display_name": "Google Nest Hub", "mac": "20:DF:B9:DD:EE:FF", "ip": "192.168.1.14", "vendor": "Google LLC", "hostname": "nest-hub.local", "category": "iot", "os_guess": "Cast OS", "device_type": "smart speaker"},
    {"display_name": "Office PC", "mac": "74:D4:35:00:11:22", "ip": "192.168.1.15", "vendor": "Dell Inc.", "hostname": "office-pc.local", "category": "computer", "os_guess": "Windows 11", "device_type": "general purpose"},
    {"display_name": "Raspberry Pi (Pi-hole)", "mac": "DC:A6:32:33:44:55", "ip": "192.168.1.2", "vendor": "Raspberry Pi Foundation", "hostname": "pihole.local", "category": "network", "os_guess": "Raspberry Pi OS (Bookworm)", "device_type": "general purpose"},
    {"display_name": "OpenWrt Router", "mac": "00:11:22:33:44:55", "ip": "192.168.1.1", "vendor": "TP-Link Technologies", "hostname": "router.local", "category": "network", "os_guess": "OpenWrt 23.05", "device_type": "router"},
    {"display_name": "Smart Thermostat", "mac": "18:B4:30:66:77:88", "ip": "192.168.1.16", "vendor": "Ecobee Inc", "hostname": None, "category": "iot", "os_guess": "Embedded Linux", "device_type": "smart thermostat"},
    {"display_name": "Xbox Series X", "mac": "60:45:CB:99:AA:BB", "ip": "192.168.1.17", "vendor": "Microsoft Corporation", "hostname": "xbox.local", "category": "media", "os_guess": "Xbox OS", "device_type": "game console"},
    {"display_name": "Unknown Device", "mac": "B0:FC:36:CC:DD:EE", "ip": "192.168.1.18", "vendor": None, "hostname": None, "category": "unknown", "os_guess": None, "device_type": None},
    {"display_name": "Guest Phone", "mac": "AC:2B:6E:12:34:56", "ip": "192.168.1.50", "vendor": "OnePlus Technology", "hostname": None, "category": "guest", "os_guess": "Android 14", "device_type": "phone"},
]

DOMAINS = [
    ("google.com", False), ("youtube.com", False), ("apple.com", False),
    ("netflix.com", False), ("spotify.com", False), ("github.com", False),
    ("stackoverflow.com", False), ("amazon.com", False), ("reddit.com", False),
    ("ads.doubleclick.net", True), ("tracking.google-analytics.com", True),
    ("pagead2.googlesyndication.com", True), ("telemetry.microsoft.com", False),
    ("malicious-c2.xyz", False), ("update.ring.amazon.com", False),
    ("ec2.amazonaws.com", False), ("cdn.cloudflare.com", False),
    ("api.ecobee.com", False), ("t.co", False), ("l.facebook.com", True),
]

ALERT_TEMPLATES = [
    {
        "title": "ET MALWARE Possible Malware Command and Control Traffic",
        "description": "A device on your network attempted to contact a known malware C2 server.",
        "ai_explanation": "One of your devices tried to reach a server commonly used by malware to receive commands. This often means the device may be infected. Consider isolating it and running a full antivirus scan.",
        "severity": "critical",
        "category": "intrusion",
        "source": "suricata",
    },
    {
        "title": "GPL SCAN SSH Brute Force Attempt",
        "description": "Multiple rapid SSH login attempts detected from an external IP.",
        "ai_explanation": "Someone outside your network tried many passwords on your SSH port very quickly. This is an automated attack. Make sure SSH is not exposed to the internet, or enable fail2ban.",
        "severity": "high",
        "category": "intrusion",
        "source": "suricata",
    },
    {
        "title": "New Device Joined Network",
        "description": "An unrecognized device appeared on your network.",
        "ai_explanation": "A device you have not seen before joined your Wi-Fi. If you don't recognize it, consider blocking it until you can verify what it is.",
        "severity": "medium",
        "category": "new_device",
        "source": "system",
    },
    {
        "title": "Unusual Outbound Traffic Spike",
        "description": "A device sent 3x its normal outbound traffic in the last 10 minutes.",
        "ai_explanation": "One of your devices is sending a lot more data than usual. This could be a backup, an update, or potentially data being exfiltrated. Worth checking what that device is doing.",
        "severity": "medium",
        "category": "anomaly",
        "source": "system",
    },
    {
        "title": "DNS Lookup for Known Malicious Domain",
        "description": "A device queried a domain flagged in threat intelligence feeds.",
        "ai_explanation": "A device on your network looked up a domain that is known to be associated with malware or phishing. This may indicate the device clicked a malicious link or has an infected application.",
        "severity": "high",
        "category": "dns",
        "source": "suricata",
    },
    {
        "title": "ET SCAN Nmap Scripting Engine Scan Detected",
        "description": "A network scanning tool was detected running against your network.",
        "ai_explanation": "Someone ran a network scanner (possibly nmap) against your network. This could be internal security testing or a reconnaissance step before an attack.",
        "severity": "low",
        "category": "intrusion",
        "source": "suricata",
    },
]


async def seed(clear: bool = False) -> None:
    from core.database import AsyncSessionLocal, init_db
    from core.security import hash_password
    from models.tenant import Tenant
    from models.user import User, UserRole
    from models.device import Device, DeviceStatus, DeviceEvent
    from models.traffic import TrafficSample
    from models.dns import DnsQuery
    from models.alert import Alert, AlertSeverity, AlertCategory, AlertStatus
    from sqlalchemy import select, delete, text

    await init_db()

    async with AsyncSessionLocal() as db:
        if clear:
            logger.info("Clearing existing data")
            for table in ["ai_query_logs", "audit_logs", "alert_rules", "alerts",
                          "dns_queries", "traffic_samples", "device_events",
                          "device_tags", "devices", "users", "tenants"]:
                await db.execute(text(f"TRUNCATE TABLE {table} CASCADE"))
            await db.commit()

        # Tenant
        existing = await db.execute(select(Tenant).limit(1))
        tenant = existing.scalar_one_or_none()
        if not tenant:
            tenant = Tenant(name="Demo Home Network", slug="demo-home")
            db.add(tenant)
            await db.flush()

            user = User(
                tenant_id=tenant.id,
                email="admin@vex.local",
                display_name="Admin",
                hashed_password=hash_password("DemoPassword123!"),
                role=UserRole.ADMIN,
            )
            db.add(user)
            await db.flush()
            logger.info("Created demo user", email="admin@vex.local", password="DemoPassword123!")

        # Devices
        device_ids: list[uuid.UUID] = []
        now = datetime.now(timezone.utc)

        for i, d in enumerate(FAKE_DEVICES):
            first_seen = now - timedelta(days=random.randint(1, 180))
            last_seen = now - timedelta(minutes=random.randint(0, 30)) if i < 9 else now - timedelta(hours=random.randint(2, 48))
            status = DeviceStatus.ONLINE if last_seen > now - timedelta(minutes=10) else DeviceStatus.OFFLINE

            device = Device(
                tenant_id=tenant.id,
                mac_address=d["mac"],
                ip_address=d["ip"],
                hostname=d.get("hostname"),
                vendor=d.get("vendor"),
                os_guess=d.get("os_guess"),
                device_type=d.get("device_type"),
                display_name=d["display_name"],
                category=d["category"],
                status=status,
                is_trusted=i < 8,
                first_seen_at=first_seen,
                last_seen_at=last_seen,
                open_ports={"tcp": [{"port": 80, "state": "open", "service": "http", "version": ""}]} if i == 7 else None,
            )
            db.add(device)
            await db.flush()
            device_ids.append(device.id)

            db.add(DeviceEvent(
                tenant_id=tenant.id,
                device_id=device.id,
                event_type="new",
                occurred_at=first_seen,
            ))

        await db.flush()
        logger.info("Created devices", count=len(FAKE_DEVICES))

        # Traffic samples — last 48 hours, 5-min buckets
        samples = []
        for minutes_ago in range(0, 48 * 60, 5):
            ts = now - timedelta(minutes=minutes_ago)
            # Network-wide sample (no device_id)
            base_in = random.randint(50_000, 2_000_000)
            base_out = random.randint(20_000, 500_000)
            # Daytime spike
            hour = ts.hour
            mult = 2.5 if 9 <= hour <= 22 else 0.4
            samples.append(TrafficSample(
                tenant_id=tenant.id,
                device_id=None,
                sampled_at=ts,
                bytes_in=int(base_in * mult * random.uniform(0.8, 1.2)),
                bytes_out=int(base_out * mult * random.uniform(0.8, 1.2)),
                packets_in=random.randint(100, 5000),
                packets_out=random.randint(50, 2000),
            ))

        # Per-device traffic for top 5 talkers
        for dev_id in device_ids[:5]:
            for minutes_ago in range(0, 48 * 60, 5):
                ts = now - timedelta(minutes=minutes_ago)
                hour = ts.hour
                mult = 2.0 if 9 <= hour <= 22 else 0.3
                samples.append(TrafficSample(
                    tenant_id=tenant.id,
                    device_id=dev_id,
                    sampled_at=ts,
                    bytes_in=int(random.randint(10_000, 500_000) * mult * random.uniform(0.7, 1.3)),
                    bytes_out=int(random.randint(5_000, 200_000) * mult * random.uniform(0.7, 1.3)),
                    packets_in=random.randint(20, 1000),
                    packets_out=random.randint(10, 500),
                ))

        db.add_all(samples)
        logger.info("Created traffic samples", count=len(samples))

        # DNS queries — last 24 hours
        dns_entries = []
        for _ in range(2000):
            domain, blocked = random.choice(DOMAINS)
            dev_id = random.choice(device_ids)
            ts = now - timedelta(minutes=random.randint(0, 24 * 60))
            dns_entries.append(DnsQuery(
                tenant_id=tenant.id,
                device_id=dev_id,
                queried_at=ts,
                domain=domain,
                query_type=random.choice(["A", "A", "A", "AAAA", "CNAME"]),
                response_code="NOERROR" if not blocked else "NXDOMAIN",
                is_blocked=blocked,
                is_malicious=domain in ("malicious-c2.xyz",),
                source=random.choice(["suricata", "pihole"]),
            ))
        db.add_all(dns_entries)
        logger.info("Created DNS entries", count=len(dns_entries))

        # Alerts
        for i, tmpl in enumerate(ALERT_TEMPLATES):
            sev_map = {"critical": AlertSeverity.CRITICAL, "high": AlertSeverity.HIGH,
                       "medium": AlertSeverity.MEDIUM, "low": AlertSeverity.LOW}
            cat_map = {"intrusion": AlertCategory.INTRUSION, "new_device": AlertCategory.NEW_DEVICE,
                       "anomaly": AlertCategory.ANOMALY, "dns": AlertCategory.DNS}
            ts = now - timedelta(hours=random.randint(0, 24))
            alert = Alert(
                tenant_id=tenant.id,
                device_id=random.choice(device_ids) if i != 1 else None,
                title=tmpl["title"],
                description=tmpl["description"],
                ai_explanation=tmpl["ai_explanation"],
                severity=sev_map[tmpl["severity"]],
                category=cat_map[tmpl["category"]],
                status=AlertStatus.OPEN if i < 4 else AlertStatus.RESOLVED,
                source=tmpl["source"],
                triggered_at=ts,
                suricata_signature=tmpl["title"] if tmpl["source"] == "suricata" else None,
            )
            db.add(alert)

        await db.commit()
        logger.info("Seed complete", tenant=tenant.name)
        print("\n" + "=" * 60)
        print("  DEMO CREDENTIALS")
        print("  Email:    admin@vex.local")
        print("  Password: DemoPassword123!")
        print("=" * 60 + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--clear", action="store_true", help="Wipe all data before seeding")
    args = parser.parse_args()
    asyncio.run(seed(clear=args.clear))
