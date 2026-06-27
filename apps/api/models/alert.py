import enum
import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, Enum, ForeignKey, DateTime, Text, Integer, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from core.database import Base
from models.mixins import TimestampMixin


class AlertSeverity(str, enum.Enum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AlertStatus(str, enum.Enum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    SUPPRESSED = "suppressed"


class AlertCategory(str, enum.Enum):
    INTRUSION = "intrusion"
    ANOMALY = "anomaly"
    NEW_DEVICE = "new_device"
    BANDWIDTH = "bandwidth"
    DNS = "dns"
    POLICY = "policy"
    SYSTEM = "system"


class Alert(Base, TimestampMixin):
    __tablename__ = "alerts"
    __table_args__ = (
        Index("ix_alerts_tenant_ts", "tenant_id", "triggered_at"),
        Index("ix_alerts_severity", "severity"),
        Index("ix_alerts_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    network_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True
    )
    rule_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("alert_rules.id", ondelete="SET NULL"), nullable=True
    )

    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    ai_explanation: Mapped[str | None] = mapped_column(Text, nullable=True)  # plain-language AI summary

    severity: Mapped[AlertSeverity] = mapped_column(Enum(AlertSeverity), nullable=False)
    category: Mapped[AlertCategory] = mapped_column(Enum(AlertCategory), default=AlertCategory.SYSTEM)
    status: Mapped[AlertStatus] = mapped_column(Enum(AlertStatus), default=AlertStatus.OPEN)

    triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Raw event payload (Suricata EVE JSON, nmap result, etc.)
    raw_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Source
    source: Mapped[str] = mapped_column(String(50), default="system")  # suricata, nmap, system, rule

    # Suricata-specific
    suricata_sid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    suricata_signature: Mapped[str | None] = mapped_column(Text, nullable=True)

    rule: Mapped["AlertRule"] = relationship("AlertRule", lazy="noload")


class AlertRule(Base, TimestampMixin):
    __tablename__ = "alert_rules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # Trigger condition (JSON DSL)
    condition: Mapped[dict] = mapped_column(JSONB, nullable=False)

    severity: Mapped[AlertSeverity] = mapped_column(Enum(AlertSeverity), default=AlertSeverity.MEDIUM)
    category: Mapped[AlertCategory] = mapped_column(Enum(AlertCategory), default=AlertCategory.POLICY)

    # Notification channels (JSON list: ["email", "slack", "discord", "webhook"])
    channels: Mapped[dict] = mapped_column(JSONB, default=list)
    webhook_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Cooldown — don't re-fire within N seconds
    cooldown_seconds: Mapped[int] = mapped_column(Integer, default=300)
    last_fired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="alert_rules", lazy="noload")
