import enum
import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, Enum, ForeignKey, DateTime, Text, Integer, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from core.database import Base
from models.mixins import TimestampMixin


class DeviceStatus(str, enum.Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    UNKNOWN = "unknown"


class DeviceCategory(str, enum.Enum):
    COMPUTER = "computer"
    MOBILE = "mobile"
    IOT = "iot"
    NETWORK = "network"
    MEDIA = "media"
    GUEST = "guest"
    UNKNOWN = "unknown"


class Device(Base, TimestampMixin):
    __tablename__ = "devices"
    __table_args__ = (
        Index("ix_devices_tenant_mac", "tenant_id", "mac_address", unique=True),
        Index("ix_devices_tenant_ip", "tenant_id", "ip_address"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)

    # Network identity
    mac_address: Mapped[str] = mapped_column(String(17), nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    ipv6_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    hostname: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Identification
    vendor: Mapped[str | None] = mapped_column(String(255), nullable=True)  # OUI lookup
    os_guess: Mapped[str | None] = mapped_column(String(255), nullable=True)  # nmap OS detection
    device_type: Mapped[str | None] = mapped_column(String(100), nullable=True)  # nmap device type

    # User-provided metadata
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category: Mapped[DeviceCategory] = mapped_column(Enum(DeviceCategory), default=DeviceCategory.UNKNOWN)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)  # icon slug

    # Status
    status: Mapped[DeviceStatus] = mapped_column(Enum(DeviceStatus), default=DeviceStatus.UNKNOWN)
    is_trusted: Mapped[bool] = mapped_column(Boolean, default=False)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    is_ignored: Mapped[bool] = mapped_column(Boolean, default=False)

    # Timing
    first_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Open ports (from nmap, stored as JSON)
    open_ports: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Risk metadata
    risk_score: Mapped[int] = mapped_column(Integer, default=0)

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="devices", lazy="noload")
    events: Mapped[list["DeviceEvent"]] = relationship("DeviceEvent", back_populates="device", lazy="noload")
    tags: Mapped[list["DeviceTag"]] = relationship("DeviceTag", back_populates="device", lazy="noload")

    @property
    def effective_name(self) -> str:
        return self.display_name or self.hostname or self.mac_address


class DeviceEvent(Base):
    __tablename__ = "device_events"
    __table_args__ = (
        Index("ix_device_events_device_ts", "device_id", "occurred_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    device_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)

    event_type: Mapped[str] = mapped_column(String(50), nullable=False)  # online|offline|new|blocked|ip_change
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    event_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    device: Mapped["Device"] = relationship("Device", back_populates="events", lazy="noload")


class DeviceTag(Base):
    __tablename__ = "device_tags"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    device_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="#6366f1")

    device: Mapped["Device"] = relationship("Device", back_populates="tags", lazy="noload")
