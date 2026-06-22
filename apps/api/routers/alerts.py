from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, timezone, timedelta
import uuid

from core.deps import get_current_user, require_admin, get_db
from models.user import User
from models.alert import Alert, AlertRule, AlertStatus, AlertCategory
from models.device import Device
from schemas.alert import (
    AlertResponse, AlertDetailResponse, AlertAcknowledgeRequest,
    AlertRuleCreate, AlertRuleResponse, AffectedDevice,
)

router = APIRouter(prefix="/alerts", tags=["alerts"])

# Remediation playbooks keyed by category
_REMEDIATION: dict[str, list[str]] = {
    "intrusion": [
        "Block the source IP at your firewall immediately.",
        "Isolate the affected device from the network.",
        "Check for lateral movement — review traffic from the device over the past 24 hours.",
        "Update IDS signatures and run a full vulnerability scan on the affected host.",
        "Rotate any credentials that may have been exposed.",
    ],
    "anomaly": [
        "Review the device's recent traffic in the Traffic page for unusual patterns.",
        "Verify the device belongs to a known user — check the Devices page.",
        "If traffic destination is unknown, block the IP and investigate further.",
        "Consider adding a custom alert rule to catch this pattern automatically.",
    ],
    "new_device": [
        "Verify whether this device belongs to someone in your household or organization.",
        "If unrecognized, block it immediately via the Devices page.",
        "Check the MAC vendor to identify the manufacturer.",
        "Enable device approval mode in Settings to require manual approval for new devices.",
    ],
    "bandwidth": [
        "Identify the top destination IPs using the Traffic page.",
        "Check if the device is running a background update or backup.",
        "Consider setting a bandwidth quota for this device via your router's QoS settings.",
        "If unexpected, this could indicate data exfiltration — escalate if confirmed.",
    ],
    "dns": [
        "The queried domain has been flagged as malicious or C2 infrastructure.",
        "Block this domain immediately in your DNS resolver (Pi-hole, AdGuard).",
        "Investigate the device that made the query — it may be compromised.",
        "Run antivirus/malware scan on the device.",
        "Check if other devices also queried this domain.",
    ],
    "policy": [
        "Review your alert rules in Settings → Alert Rules.",
        "Update or disable the rule if it is producing false positives.",
        "If this is a legitimate violation, remediate and document it.",
    ],
    "system": [
        "Review Netindavoid system logs for more details.",
        "Ensure all services are healthy via the /health endpoint.",
        "Check the scan schedule and confirm network access is intact.",
    ],
}


@router.get("", response_model=list[AlertResponse])
async def list_alerts(
    severity: str | None = Query(None),
    status: str | None = Query(None),
    hours: int = Query(24, ge=1, le=720),
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    q = select(Alert).where(Alert.tenant_id == user.tenant_id, Alert.triggered_at >= since)
    if severity:
        q = q.where(Alert.severity == severity)
    if status:
        q = q.where(Alert.status == status)
    result = await db.execute(q.order_by(Alert.triggered_at.desc()).limit(limit))
    return [_to_response(a) for a in result.scalars().all()]


@router.get("/stats")
async def alert_stats(
    hours: int = Query(24),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    result = await db.execute(
        select(Alert.severity, func.count(Alert.id))
        .where(Alert.tenant_id == user.tenant_id, Alert.triggered_at >= since)
        .group_by(Alert.severity)
    )
    return {
        str(row[0]).split(".")[-1].lower(): row[1]
        for row in result.all()
    }


@router.get("/rules", response_model=list[AlertRuleResponse])
async def list_rules(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AlertRule).where(AlertRule.tenant_id == user.tenant_id)
    )
    return [_rule_to_response(r) for r in result.scalars().all()]


@router.post("/rules", response_model=AlertRuleResponse, status_code=status.HTTP_201_CREATED)
async def create_rule(
    body: AlertRuleCreate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    rule = AlertRule(tenant_id=user.tenant_id, **body.model_dump())
    db.add(rule)
    await db.flush()
    return _rule_to_response(rule)


@router.get("/{alert_id}", response_model=AlertDetailResponse)
async def get_alert(
    alert_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Alert).where(Alert.id == alert_id, Alert.tenant_id == user.tenant_id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    # Count related alerts (same category on same device, last 7 days)
    related_count = 0
    if alert.device_id:
        since = datetime.now(timezone.utc) - timedelta(days=7)
        rel = await db.execute(
            select(func.count(Alert.id)).where(
                Alert.tenant_id == user.tenant_id,
                Alert.device_id == alert.device_id,
                Alert.category == alert.category,
                Alert.id != alert.id,
                Alert.triggered_at >= since,
            )
        )
        related_count = rel.scalar_one() or 0

    remediation = _REMEDIATION.get(str(alert.category).replace("AlertCategory.", ""), [])

    affected_device = None
    if alert.device_id:
        dev_result = await db.execute(
            select(Device).where(Device.id == alert.device_id, Device.tenant_id == user.tenant_id)
        )
        dev = dev_result.scalar_one_or_none()
        if dev:
            affected_device = AffectedDevice(
                id=str(dev.id),
                ip_address=dev.ip_address,
                mac_address=dev.mac_address,
                hostname=dev.hostname,
                display_name=dev.display_name or dev.hostname or dev.mac_address,
                vendor=dev.vendor,
                category=str(dev.category).split(".")[-1].lower() if dev.category else "unknown",
                status=str(dev.status).split(".")[-1].lower() if dev.status else "unknown",
            )

    return AlertDetailResponse(
        **_to_response(alert).model_dump(),
        affected_device=affected_device,
        remediation_steps=remediation,
        related_alert_count=related_count,
    )


@router.post("/{alert_id}/acknowledge", status_code=status.HTTP_204_NO_CONTENT)
async def acknowledge_alert(
    alert_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    body: AlertAcknowledgeRequest | None = None,
):
    result = await db.execute(
        select(Alert).where(Alert.id == alert_id, Alert.tenant_id == user.tenant_id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.status = AlertStatus.ACKNOWLEDGED
    alert.acknowledged_at = datetime.now(timezone.utc)


@router.post("/{alert_id}/resolve", status_code=status.HTTP_204_NO_CONTENT)
async def resolve_alert(
    alert_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Alert).where(Alert.id == alert_id, Alert.tenant_id == user.tenant_id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.status = AlertStatus.RESOLVED
    alert.resolved_at = datetime.now(timezone.utc)



@router.patch("/rules/{rule_id}", response_model=AlertRuleResponse)
async def update_rule(
    rule_id: uuid.UUID,
    body: AlertRuleCreate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AlertRule).where(AlertRule.id == rule_id, AlertRule.tenant_id == user.tenant_id)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(rule, k, v)
    return _rule_to_response(rule)


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(
    rule_id: uuid.UUID,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AlertRule).where(AlertRule.id == rule_id, AlertRule.tenant_id == user.tenant_id)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.delete(rule)
    await db.flush()


def _to_response(a: Alert) -> AlertResponse:
    return AlertResponse(
        id=str(a.id),
        title=a.title,
        description=a.description,
        ai_explanation=a.ai_explanation,
        severity=str(a.severity).split(".")[-1].lower() if a.severity else "info",
        category=str(a.category).split(".")[-1].lower() if a.category else "system",
        status=str(a.status).split(".")[-1].lower() if a.status else "open",
        source=a.source,
        triggered_at=a.triggered_at,
        acknowledged_at=a.acknowledged_at,
        resolved_at=a.resolved_at,
        device_id=str(a.device_id) if a.device_id else None,
        rule_id=str(a.rule_id) if a.rule_id else None,
        suricata_sid=a.suricata_sid,
        suricata_signature=a.suricata_signature,
        raw_data=a.raw_data,
    )


def _rule_to_response(r: AlertRule) -> AlertRuleResponse:
    return AlertRuleResponse(
        id=str(r.id),
        name=r.name,
        description=r.description,
        is_enabled=r.is_enabled,
        condition=r.condition,
        severity=str(r.severity).split(".")[-1].lower() if r.severity else "medium",
        category=str(r.category).split(".")[-1].lower() if r.category else "policy",
        channels=r.channels if isinstance(r.channels, list) else [],
        cooldown_seconds=r.cooldown_seconds,
        last_fired_at=r.last_fired_at,
    )
