from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update, and_
from datetime import datetime, timezone, timedelta
import uuid

from core.deps import get_current_user, require_admin, get_db
from core.redis import publish_event
from models.user import User
from models.device import Device, DeviceEvent, DeviceStatus
from models.audit_log import AuditLog
from schemas.device import DeviceResponse, DeviceUpdateRequest, DeviceBlockRequest, DeviceListResponse
import orjson

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("", response_model=DeviceListResponse)
async def list_devices(
    status: str | None = Query(None, enum=["online", "offline", "unknown"]),
    category: str | None = Query(None),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(Device).where(Device.tenant_id == user.tenant_id)

    if status:
        q = q.where(Device.status == DeviceStatus[status.upper()])
    if category:
        q = q.where(Device.category == category)
    if search:
        q = q.where(
            Device.display_name.ilike(f"%{search}%")
            | Device.hostname.ilike(f"%{search}%")
            | Device.ip_address.ilike(f"%{search}%")
            | Device.mac_address.ilike(f"%{search}%")
        )

    total_result = await db.execute(select(func.count()).select_from(q.subquery()))
    total = total_result.scalar()

    online_result = await db.execute(
        select(func.count(Device.id)).where(Device.tenant_id == user.tenant_id, Device.status == DeviceStatus.ONLINE)
    )
    offline_result = await db.execute(
        select(func.count(Device.id)).where(Device.tenant_id == user.tenant_id, Device.status == DeviceStatus.OFFLINE)
    )
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)
    new_result = await db.execute(
        select(func.count(Device.id)).where(
            Device.tenant_id == user.tenant_id, Device.first_seen_at >= yesterday
        )
    )

    devices_result = await db.execute(
        q.order_by(Device.last_seen_at.desc().nullslast()).offset((page - 1) * limit).limit(limit)
    )
    devices = devices_result.scalars().all()

    return DeviceListResponse(
        items=[_to_response(d) for d in devices],
        total=total or 0,
        online=online_result.scalar() or 0,
        offline=offline_result.scalar() or 0,
        new_today=new_result.scalar() or 0,
    )


@router.get("/{device_id}", response_model=DeviceResponse)
async def get_device(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    device = await _get_or_404(db, device_id, user.tenant_id)
    return _to_response(device)


@router.patch("/{device_id}", response_model=DeviceResponse)
async def update_device(
    device_id: uuid.UUID,
    body: DeviceUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    device = await _get_or_404(db, device_id, user.tenant_id)
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(device, field, val)
    await db.flush()
    await publish_event("devices", orjson.dumps({"event": "updated", "device_id": str(device_id)}).decode())
    return _to_response(device)


@router.post("/{device_id}/block", response_model=DeviceResponse)
async def block_device(
    device_id: uuid.UUID,
    body: DeviceBlockRequest,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    device = await _get_or_404(db, device_id, user.tenant_id)
    device.is_blocked = body.blocked

    log = AuditLog(
        tenant_id=user.tenant_id,
        user_id=user.id,
        action="device.block" if body.blocked else "device.unblock",
        resource_type="device",
        resource_id=str(device_id),
        occurred_at=datetime.now(timezone.utc),
        ip_address=request.client.host if request.client else None,
        metadata={"reason": body.reason},
    )
    db.add(log)
    await db.flush()

    event_type = "blocked" if body.blocked else "unblocked"
    await publish_event("devices", orjson.dumps({"event": event_type, "device_id": str(device_id)}).decode())
    return _to_response(device)


@router.get("/{device_id}/events")
async def device_events(
    device_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, device_id, user.tenant_id)
    result = await db.execute(
        select(DeviceEvent)
        .where(DeviceEvent.device_id == device_id, DeviceEvent.tenant_id == user.tenant_id)
        .order_by(DeviceEvent.occurred_at.desc())
        .limit(limit)
    )
    events = result.scalars().all()
    return [{"id": str(e.id), "type": e.event_type, "occurred_at": e.occurred_at.isoformat(), "data": e.event_data} for e in events]


async def _get_or_404(db: AsyncSession, device_id: uuid.UUID, tenant_id: uuid.UUID) -> Device:
    result = await db.execute(
        select(Device).where(Device.id == device_id, Device.tenant_id == tenant_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    return device


def _to_response(d: Device) -> DeviceResponse:
    return DeviceResponse(
        id=str(d.id),
        mac_address=d.mac_address,
        ip_address=d.ip_address,
        hostname=d.hostname,
        vendor=d.vendor,
        os_guess=d.os_guess,
        display_name=d.display_name,
        category=d.category,
        status=d.status,
        is_trusted=d.is_trusted,
        is_blocked=d.is_blocked,
        risk_score=d.risk_score,
        first_seen_at=d.first_seen_at,
        last_seen_at=d.last_seen_at,
        open_ports=d.open_ports,
        tags=[{"name": t.name, "color": t.color} for t in (d.tags or [])],
    )
