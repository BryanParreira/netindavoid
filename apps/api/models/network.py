"""Network identity — one row per physical network ever joined."""
import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Index
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base
from models.mixins import TimestampMixin


class Network(Base, TimestampMixin):
    __tablename__ = "networks"
    __table_args__ = (
        Index("ix_networks_gateway_mac", "gateway_mac", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # Fingerprint — unique per physical router, survives IP changes
    gateway_mac: Mapped[str] = mapped_column(String(17), nullable=False, unique=True)

    # Informational — may change
    gateway_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    subnet_cidr: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ssid: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # User-assigned label (e.g. "Home", "Office", "Starbucks Castro")
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    is_trusted: Mapped[bool] = mapped_column(Boolean, default=False)

    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
