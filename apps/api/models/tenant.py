from sqlalchemy import String, Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
import uuid
from datetime import datetime, timezone

from core.database import Base
from models.mixins import TimestampMixin


class Tenant(Base, TimestampMixin):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    plan: Mapped[str] = mapped_column(String(50), default="self-hosted")
    settings: Mapped[dict] = mapped_column(Text, default="{}")  # JSON blob

    # Relationships
    users: Mapped[list["User"]] = relationship("User", back_populates="tenant", lazy="noload")
    devices: Mapped[list["Device"]] = relationship("Device", back_populates="tenant", lazy="noload")
    alert_rules: Mapped[list["AlertRule"]] = relationship("AlertRule", back_populates="tenant", lazy="noload")
