import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, BigInteger, Integer, Index
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB

from core.database import Base


class TrafficSample(Base):
    """TimescaleDB hypertable — one row per device per interval."""
    __tablename__ = "traffic_samples"
    __table_args__ = (
        Index("ix_traffic_tenant_device_ts", "tenant_id", "device_id", "sampled_at"),
        # Note: hypertable created in database.py init_db()
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sampled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

    # Bytes in the sample window
    bytes_in: Mapped[int] = mapped_column(BigInteger, default=0)
    bytes_out: Mapped[int] = mapped_column(BigInteger, default=0)
    packets_in: Mapped[int] = mapped_column(Integer, default=0)
    packets_out: Mapped[int] = mapped_column(Integer, default=0)

    # Protocol breakdown (JSON: {"tcp": N, "udp": N, ...})
    protocol_breakdown: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Top destination IPs (JSON list)
    top_destinations: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Interface (eth0, wlan0, etc.)
    interface: Mapped[str | None] = mapped_column(String(30), nullable=True)
