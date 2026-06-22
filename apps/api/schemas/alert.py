from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime


class AlertResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    title: str
    description: str
    ai_explanation: Optional[str] = None
    severity: str
    category: str
    status: str
    source: str
    triggered_at: datetime
    acknowledged_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    device_id: Optional[str] = None
    rule_id: Optional[str] = None
    suricata_sid: Optional[int] = None
    suricata_signature: Optional[str] = None
    raw_data: Optional[Any] = None


class AffectedDevice(BaseModel):
    id: str
    ip_address: Optional[str] = None
    mac_address: Optional[str] = None
    hostname: Optional[str] = None
    display_name: Optional[str] = None
    vendor: Optional[str] = None
    category: str = "unknown"
    status: str = "unknown"


class AlertDetailResponse(AlertResponse):
    affected_device: Optional[AffectedDevice] = None
    remediation_steps: list[str] = []
    related_alert_count: int = 0


class AlertAcknowledgeRequest(BaseModel):
    note: Optional[str] = None


class AlertRuleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    condition: dict
    severity: str = "medium"
    category: str = "policy"
    channels: list[str] = []
    webhook_url: Optional[str] = None
    cooldown_seconds: int = 300


class AlertRuleResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    name: str
    description: Optional[str] = None
    is_enabled: bool
    condition: dict
    severity: str
    category: str
    channels: list
    cooldown_seconds: int
    last_fired_at: Optional[datetime] = None
