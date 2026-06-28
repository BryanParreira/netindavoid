"""Celery tasks: network scanning, Suricata ingestion, security scoring."""
import asyncio
import json
import uuid
from datetime import datetime, timezone

import structlog

from workers.celery_app import celery_app

logger = structlog.get_logger()


def _run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(name="workers.tasks.run_network_scan", bind=True, max_retries=3)
def run_network_scan(self, scan_id: str, tenant_id: str, scan_type: str = "arp"):
    return _run_async(_run_network_scan_async(scan_id, tenant_id, scan_type))


@celery_app.task(name="workers.tasks.deep_scan_device")
def deep_scan_device(device_id: str, tenant_id: str, ip: str):
    """Port + service scan on a single device. Runs after new device is discovered."""
    return _run_async(_deep_scan_device_async(device_id, tenant_id, ip))


async def _deep_scan_device_async(device_id: str, tenant_id: str, ip: str):
    from core.database import AsyncSessionLocal
    from models.device import Device
    from services.scanner import scan_device_ports
    from sqlalchemy import select

    port_data = scan_device_ports(ip)
    if not port_data:
        return

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Device).where(Device.id == uuid.UUID(device_id)))
        device = result.scalar_one_or_none()
        if not device:
            return
        device.open_ports = port_data.get("open_ports")
        device.os_guess    = port_data.get("os_guess")
        device.device_type = port_data.get("device_type")
        await db.commit()
    logger.info("Deep scan complete", device_id=device_id, ip=ip)


async def _run_network_scan_async(scan_id: str, tenant_id: str, scan_type: str):
    from core.database import AsyncSessionLocal
    from core.config import settings
    from core.redis import publish_event
    from models.scan import Scan, ScanStatus
    from models.device import Device, DeviceStatus, DeviceEvent
    from services.scanner import scan_network
    from sqlalchemy import select, func

    async with AsyncSessionLocal() as db:
        scan_result = await db.execute(select(Scan).where(Scan.id == uuid.UUID(scan_id)))
        scan = scan_result.scalar_one_or_none()
        if not scan:
            return

        scan.status = ScanStatus.RUNNING
        scan.started_at = datetime.now(timezone.utc)
        await db.commit()

        try:
            from services.network import get_subnet_cidr
            from services.active_network import get_active_network_id
            network_id = await get_active_network_id()
            cidr = scan.target_cidr or get_subnet_cidr()
            logger.info("scanning network", cidr=cidr)
            hosts = scan_network(cidr)
            new_count = 0
            from models.alert import Alert, AlertSeverity, AlertCategory

            for host in hosts:
                mac = host["mac_address"].upper()
                ip  = host.get("ip_address", "")
                result = await db.execute(
                    select(Device).where(
                        Device.tenant_id == uuid.UUID(tenant_id),
                        func.upper(Device.mac_address) == mac,
                    )
                )
                device = result.scalar_one_or_none()
                now = datetime.now(timezone.utc)

                # ── ARP spoofing detection ─────────────────────────────────
                if ip and device and device.ip_address and device.ip_address != ip:
                    # Same MAC, different IP — could be IP change OR ARP spoof
                    # Check if any OTHER device already claims this IP
                    ip_collision = await db.execute(
                        select(Device).where(
                            Device.tenant_id == uuid.UUID(tenant_id),
                            Device.ip_address == ip,
                            func.upper(Device.mac_address) != mac,
                        )
                    )
                    if ip_collision.scalar_one_or_none():
                        # Different MAC claiming same IP → ARP spoofing
                        spoof_alert = Alert(
                            tenant_id=uuid.UUID(tenant_id),
                            network_id=network_id,
                            device_id=device.id,
                            title=f"ARP Spoofing Detected — {ip}",
                            description=(
                                f"IP {ip} is claimed by MAC {mac} but was previously "
                                f"assigned to a different device. This may indicate an "
                                f"ARP poisoning / man-in-the-middle attack."
                            ),
                            severity=AlertSeverity.CRITICAL,
                            category=AlertCategory.INTRUSION,
                            source="arp_monitor",
                            triggered_at=now,
                        )
                        db.add(spoof_alert)
                        await publish_event("alerts", json.dumps({
                            "event": "new_alert",
                            "tenant_id": tenant_id,
                            "severity": "critical",
                            "title": spoof_alert.title,
                        }))

                if device is None:
                    device = Device(
                        tenant_id=uuid.UUID(tenant_id),
                        network_id=network_id,
                        mac_address=mac,
                        ip_address=ip,
                        hostname=host.get("hostname"),
                        vendor=host.get("vendor"),
                        status=DeviceStatus.ONLINE,
                        first_seen_at=now,
                        last_seen_at=now,
                    )
                    db.add(device)
                    await db.flush()
                    new_count += 1

                    db.add(DeviceEvent(
                        tenant_id=uuid.UUID(tenant_id),
                        device_id=device.id,
                        event_type="new",
                        occurred_at=now,
                    ))

                    # ── New device alert ───────────────────────────────────
                    vendor_str = host.get("vendor") or mac
                    new_alert = Alert(
                        tenant_id=uuid.UUID(tenant_id),
                        network_id=network_id,
                        device_id=device.id,
                        title=f"New Device Joined Network — {host.get('hostname') or ip}",
                        description=(
                            f"An unknown device has connected to your network.\n"
                            f"IP: {ip} | MAC: {mac} | Vendor: {vendor_str}\n"
                            f"Verify this device belongs to you. Block it immediately if unrecognized."
                        ),
                        severity=AlertSeverity.HIGH,
                        category=AlertCategory.NEW_DEVICE,
                        source="scanner",
                        triggered_at=now,
                    )
                    db.add(new_alert)

                    await publish_event("devices", json.dumps({
                        "event": "new_device",
                        "tenant_id": tenant_id,
                        "device_id": str(device.id),
                        "mac": mac,
                    }))
                    await publish_event("alerts", json.dumps({
                        "event": "new_alert",
                        "tenant_id": tenant_id,
                        "severity": "high",
                        "title": new_alert.title,
                    }))
                    # Queue deep port/service/OS scan for new device
                    deep_scan_device.delay(str(device.id), tenant_id, ip)
                else:
                    device.ip_address = ip or device.ip_address
                    device.hostname = host.get("hostname") or device.hostname
                    device.last_seen_at = now
                    if device.status != DeviceStatus.ONLINE:
                        device.status = DeviceStatus.ONLINE
                        db.add(DeviceEvent(
                            tenant_id=uuid.UUID(tenant_id),
                            device_id=device.id,
                            event_type="online",
                            occurred_at=now,
                        ))

            scan.status = ScanStatus.COMPLETED
            scan.completed_at = datetime.now(timezone.utc)
            scan.devices_found = len(hosts)
            scan.new_devices = new_count
            await db.commit()

        except Exception as e:
            scan.status = ScanStatus.FAILED
            scan.error_message = str(e)
            await db.commit()
            logger.error("Scan failed", scan_id=scan_id, error=str(e))
            raise


@celery_app.task(name="workers.tasks.run_periodic_scan")
def run_periodic_scan():
    """Periodic auto-scan for all tenants."""
    return _run_async(_periodic_scan_async())


async def _periodic_scan_async():
    from core.database import AsyncSessionLocal
    from core.redis import get_redis
    from models.tenant import Tenant
    from models.scan import Scan, ScanType, ScanStatus
    from models.device import Device, DeviceStatus, DeviceEvent
    from services.network import get_gateway, get_subnet_cidr
    from sqlalchemy import select, update as sa_update
    import redis.asyncio as aioredis
    from core.config import settings

    # Detect current network via gateway IP
    current_gateway = get_gateway() or ""
    current_cidr    = get_subnet_cidr()

    r = aioredis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Tenant).where(Tenant.is_active == True))
            tenants = result.scalars().all()
            for tenant in tenants:
                tid = str(tenant.id)
                gw_key = f"network:gateway:{tid}"
                prev_gateway = await r.get(gw_key)

                if prev_gateway and prev_gateway != current_gateway:
                    # Network changed — immediately mark ALL online devices offline
                    logger.info("Network changed — marking all devices offline",
                                old_gw=prev_gateway, new_gw=current_gateway, cidr=current_cidr)
                    stale_all = await db.execute(
                        select(Device).where(
                            Device.tenant_id == tenant.id,
                            Device.status == DeviceStatus.ONLINE,
                        )
                    )
                    now = datetime.now(timezone.utc)
                    for dev in stale_all.scalars().all():
                        dev.status = DeviceStatus.OFFLINE
                        db.add(DeviceEvent(
                            tenant_id=tenant.id,
                            device_id=dev.id,
                            event_type="offline",
                            occurred_at=now,
                        ))
                    # Clear DNS dedup cache so new network gets fresh PTR scans
                    await r.delete(f"dns:seen:{tid}")
                    # Reset traffic cursor so first sample doesn't produce huge delta
                    await r.delete(f"traffic:prev:{tid}")
                    await r.delete(f"traffic:cursor:{tid}")

                await r.set(gw_key, current_gateway, ex=7200)

                scan = Scan(
                    tenant_id=tenant.id,
                    scan_type=ScanType.ARP,
                    status=ScanStatus.PENDING,
                )
                db.add(scan)
                await db.flush()
                run_network_scan.delay(str(scan.id), tid, "arp")

                # Mark devices not seen in last 5 minutes as OFFLINE
                from datetime import timedelta
                cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
                stale = await db.execute(
                    select(Device).where(
                        Device.tenant_id == tenant.id,
                        Device.status == DeviceStatus.ONLINE,
                        Device.last_seen_at < cutoff,
                    )
                )
                for dev in stale.scalars().all():
                    dev.status = DeviceStatus.OFFLINE
                    now = datetime.now(timezone.utc)
                    db.add(DeviceEvent(
                        tenant_id=tenant.id,
                        device_id=dev.id,
                        event_type="offline",
                        occurred_at=now,
                    ))
            await db.commit()
    finally:
        await r.aclose()


@celery_app.task(name="workers.tasks.ingest_suricata_events")
def ingest_suricata_events():
    return _run_async(_ingest_suricata_async())


async def _ingest_suricata_async():
    """Tail Suricata EVE JSON and ingest new alerts into the DB."""
    import os
    from core.config import settings
    from core.database import AsyncSessionLocal
    from core.redis import publish_event, get_redis
    from models.alert import Alert, AlertSeverity, AlertCategory
    from models.tenant import Tenant
    from sqlalchemy import select

    eve_path = settings.SURICATA_EVE_LOG_PATH
    if not os.path.exists(eve_path):
        return

    r = get_redis()
    cursor_key = "suricata:cursor"
    cursor = int(await r.get(cursor_key) or 0)

    with open(eve_path, "rb") as f:
        f.seek(cursor)
        lines = f.readlines()
        new_cursor = f.tell()

    if not lines:
        return

    async with AsyncSessionLocal() as db:
        tenant_result = await db.execute(select(Tenant).where(Tenant.is_active == True).limit(1))
        tenant = tenant_result.scalar_one_or_none()
        if not tenant:
            return

        for line in lines:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            if event.get("event_type") != "alert":
                continue

            sig = event.get("alert", {})
            severity_int = sig.get("severity", 3)
            sev_map = {1: AlertSeverity.CRITICAL, 2: AlertSeverity.HIGH, 3: AlertSeverity.MEDIUM}
            sev = sev_map.get(severity_int, AlertSeverity.LOW)

            alert = Alert(
                tenant_id=tenant.id,
                title=sig.get("signature", "Suricata Alert"),
                description=f"[{sig.get('category', 'IDS')}] {sig.get('signature', '')} — "
                            f"src={event.get('src_ip')}:{event.get('src_port')} → "
                            f"dst={event.get('dest_ip')}:{event.get('dest_port')}",
                severity=sev,
                category=AlertCategory.INTRUSION,
                source="suricata",
                triggered_at=datetime.fromisoformat(event.get("timestamp", datetime.now(timezone.utc).isoformat())),
                suricata_sid=sig.get("id"),
                suricata_signature=sig.get("signature"),
                raw_data=event,
            )
            db.add(alert)
            await db.flush()

            await publish_event("alerts", json.dumps({
                "event": "new_alert",
                "tenant_id": str(tenant.id),
                "alert_id": str(alert.id),
                "severity": sev,
                "title": alert.title,
            }))

        await db.commit()

    await r.set(cursor_key, new_cursor)


@celery_app.task(name="workers.tasks.compute_security_scores")
def compute_security_scores():
    return _run_async(_compute_scores_async())


async def _compute_scores_async():
    """Simple heuristic security score for each device."""
    from core.database import AsyncSessionLocal
    from models.device import Device
    from models.alert import Alert, AlertSeverity
    from sqlalchemy import select, func
    from datetime import timedelta

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Device))
        devices = result.scalars().all()

        for device in devices:
            score = 0

            # High-severity alerts → penalty
            alert_result = await db.execute(
                select(func.count(Alert.id)).where(
                    Alert.device_id == device.id,
                    Alert.severity.in_([AlertSeverity.HIGH, AlertSeverity.CRITICAL]),
                    Alert.triggered_at >= datetime.now(timezone.utc) - timedelta(days=7),
                )
            )
            alerts = alert_result.scalar() or 0
            score += min(alerts * 20, 60)

            # Open ports — scored by risk level
            if device.open_ports:
                CRITICAL_PORTS = {23, 2323, 1900, 7547}   # Telnet, UPnP, TR-069
                HIGH_PORTS     = {22, 3389, 5900, 5901}   # SSH, RDP, VNC
                MEDIUM_PORTS   = {21, 25, 110, 143, 1433, 3306, 5432, 6379, 27017}
                for proto in device.open_ports.values():
                    for p in proto:
                        port = p["port"]
                        if port in CRITICAL_PORTS:
                            score += 25
                        elif port in HIGH_PORTS:
                            score += 15
                        elif port in MEDIUM_PORTS:
                            score += 10

            # OFFLINE devices with recent critical alerts stay scored
            if device.status and str(device.status).lower() == "offline":
                score = max(score - 10, 0)  # Slight reduction — not actively on network

            device.risk_score = min(score, 100)

        await db.commit()


@celery_app.task(name="workers.tasks.collect_traffic_dns")
def collect_traffic_dns():
    return _run_async(_collect_traffic_dns_async())


async def _collect_traffic_dns_async():
    """Collect real traffic stats + DNS from macOS — no root needed."""
    import redis.asyncio as aioredis
    from core.config import settings
    from core.database import AsyncSessionLocal
    from models.tenant import Tenant
    from sqlalchemy import select
    from services.collectors import collect_traffic, collect_dns

    # Fresh Redis connection per task — Celery tasks run in new event loops
    r = aioredis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Tenant).where(Tenant.is_active == True).limit(1))
            tenant = result.scalar_one_or_none()
            if not tenant:
                return

        tid = str(tenant.id)
        await collect_traffic(tid, r)
        await collect_dns(tid, r)
    finally:
        await r.aclose()


@celery_app.task(name="workers.tasks.ping_all_devices")
def ping_all_devices():
    return _run_async(_ping_all_devices_async())


async def _ping_all_devices_async():
    """Ping every known device on the active network and record uptime beats."""
    from core.database import AsyncSessionLocal
    from models.tenant import Tenant
    from routers.uptime import ping_all_devices_task
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Tenant).where(Tenant.is_active == True))
        tenants = result.scalars().all()

    for tenant in tenants:
        try:
            await ping_all_devices_task(str(tenant.id))
        except Exception as e:
            logger.warning("ping_all failed", tenant_id=str(tenant.id), error=str(e))
