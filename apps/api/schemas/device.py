from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime
import uuid


class DeviceResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    mac_address: str
    ip_address: Optional[str] = None
    hostname: Optional[str] = None
    vendor: Optional[str] = None
    os_guess: Optional[str] = None
    display_name: Optional[str] = None
    category: str
    status: str
    is_trusted: bool
    is_blocked: bool
    risk_score: int
    first_seen_at: Optional[datetime] = None
    last_seen_at: Optional[datetime] = None
    open_ports: Optional[dict] = None
    tags: list[dict] = []

    @property
    def effective_name(self) -> str:
        return self.display_name or self.hostname or self.mac_address


class DeviceUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    is_trusted: Optional[bool] = None
    icon: Optional[str] = None


class DeviceBlockRequest(BaseModel):
    blocked: bool
    reason: Optional[str] = None


class DeviceListResponse(BaseModel):
    items: list[DeviceResponse]
    total: int
    online: int
    offline: int
    new_today: int
