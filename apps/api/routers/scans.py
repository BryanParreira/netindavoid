from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
import uuid

from core.deps import require_admin, get_db
from models.user import User
from models.scan import Scan, ScanType, ScanStatus

router = APIRouter(prefix="/scans", tags=["scans"])


async def _run_scan_inline(scan_id: str, tenant_id: str, scan_type: str):
    """Run scan in-process (no Celery needed). Used as BackgroundTasks fallback."""
    from workers.tasks import _run_network_scan_async
    await _run_network_scan_async(scan_id, tenant_id, scan_type)


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def trigger_scan(
    background_tasks: BackgroundTasks,
    scan_type: str = "arp",
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        stype = ScanType(scan_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid scan type: {scan_type}")

    scan = Scan(
        tenant_id=user.tenant_id,
        scan_type=stype,
        status=ScanStatus.PENDING,
        target_cidr=None,
    )
    db.add(scan)
    await db.flush()
    scan_id = str(scan.id)

    # Try Celery first; fall back to in-process BackgroundTask
    try:
        from workers.tasks import run_network_scan
        task = run_network_scan.delay(scan_id, str(user.tenant_id), scan_type)
        scan.celery_task_id = task.id
        mode = "queued"
    except Exception:
        background_tasks.add_task(_run_scan_inline, scan_id, str(user.tenant_id), scan_type)
        mode = "running"

    return {"scan_id": scan_id, "status": mode}


@router.get("/{scan_id}")
async def get_scan(
    scan_id: str,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Scan).where(Scan.id == uuid.UUID(scan_id), Scan.tenant_id == user.tenant_id)
    )
    scan = result.scalar_one_or_none()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return {
        "id": str(scan.id),
        "scan_type": scan.scan_type,
        "status": scan.status,
        "started_at": scan.started_at.isoformat() if scan.started_at else None,
        "completed_at": scan.completed_at.isoformat() if scan.completed_at else None,
        "devices_found": scan.devices_found,
        "new_devices": scan.new_devices,
        "error_message": scan.error_message,
    }


@router.get("")
async def list_scans(
    limit: int = 20,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Scan)
        .where(Scan.tenant_id == user.tenant_id)
        .order_by(Scan.created_at.desc())
        .limit(limit)
    )
    scans = result.scalars().all()
    return [
        {
            "id": str(s.id),
            "scan_type": s.scan_type,
            "status": s.status,
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "completed_at": s.completed_at.isoformat() if s.completed_at else None,
            "devices_found": s.devices_found,
            "new_devices": s.new_devices,
        }
        for s in scans
    ]
