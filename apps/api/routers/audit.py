"""Security audit endpoints — on-demand SSL, HTTP, port vuln, DNS, traceroute, webapp."""
import uuid
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, field_validator
import ipaddress
import socket
import urllib.parse

from core.deps import get_current_user, get_db
from models.user import User
from models.device import Device

router = APIRouter(prefix="/audit", tags=["audit"])


class AuditTarget(BaseModel):
    ip: str
    hostname: str | None = None
    ports: list[int] | None = None

    @field_validator("ip")
    @classmethod
    def validate_ip(cls, v: str) -> str:
        try:
            ipaddress.ip_address(v)
        except ValueError:
            # Allow hostnames too
            try:
                socket.gethostbyname(v)
            except Exception:
                raise ValueError(f"Invalid IP or hostname: {v}")
        return v


def _run_full_audit(ip: str, hostname: str | None, open_ports: dict | None) -> dict[str, Any]:
    from services.audit import full_audit
    return full_audit(ip, hostname=hostname, open_ports=open_ports)


@router.post("/device/{device_id}")
async def audit_device(
    device_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Run a full security audit on a known device."""
    result = await db.execute(
        select(Device).where(Device.id == device_id, Device.tenant_id == user.tenant_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    if not device.ip_address:
        raise HTTPException(status_code=400, detail="Device has no IP address")

    from services.audit import full_audit
    report = full_audit(
        ip=device.ip_address,
        hostname=device.hostname,
        open_ports=device.open_ports,
    )
    return report


@router.post("/target")
async def audit_target(
    body: AuditTarget,
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Run a full security audit on any IP or hostname. For friend/company audits."""
    # Resolve hostname to IP if needed
    ip = body.ip
    try:
        ipaddress.ip_address(ip)
    except ValueError:
        # It's a hostname
        try:
            ip = socket.gethostbyname(body.ip)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Cannot resolve {body.ip}")

    hostname = body.hostname or (body.ip if not ip == body.ip else None)

    open_ports: dict | None = None
    if body.ports:
        # Build a minimal open_ports structure from the provided list
        open_ports = {"tcp": [{"port": p, "service": "", "version": ""} for p in body.ports]}

    from services.audit import full_audit
    return full_audit(ip=ip, hostname=hostname, open_ports=open_ports)


@router.post("/device/{device_id}/ssl")
async def audit_device_ssl(
    device_id: uuid.UUID,
    port: int = 443,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Quick SSL/TLS check on a device port."""
    result = await db.execute(
        select(Device).where(Device.id == device_id, Device.tenant_id == user.tenant_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if not device.ip_address:
        raise HTTPException(status_code=400, detail="Device has no IP")

    from services.audit import ssl_check
    return ssl_check(device.ip_address, port=port, hostname=device.hostname)


@router.post("/traceroute")
async def run_traceroute(
    body: AuditTarget,
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Traceroute to any target."""
    from services.audit import traceroute
    hops = traceroute(body.ip)
    return {"target": body.ip, "hops": hops, "hop_count": len(hops)}


@router.get("/device/{device_id}/port-vulns")
async def device_port_vulns(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Return vulnerability mapping for a device's known open ports."""
    result = await db.execute(
        select(Device).where(Device.id == device_id, Device.tenant_id == user.tenant_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if not device.open_ports:
        return []

    from services.audit import map_port_vulns
    return map_port_vulns(device.open_ports)


class WebAuditRequest(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def normalize_url(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith(("http://", "https://")):
            v = "https://" + v
        parsed = urllib.parse.urlparse(v)
        if not parsed.hostname:
            raise ValueError("Invalid URL")
        return v


@router.post("/webapp")
async def audit_webapp(
    body: WebAuditRequest,
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Full web application security audit: SSL, headers, CORS, cookies, sensitive paths, DNS."""
    from services.webaudit import webapp_audit
    return webapp_audit(body.url)
