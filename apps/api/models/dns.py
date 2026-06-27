import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, ForeignKey, DateTime, Integer, Index
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from core.database import Base


class DnsQuery(Base):
    """TimescaleDB hypertable — one row per DNS query event."""
    __tablename__ = "dns_queries"
    __table_args__ = (
        Index("ix_dns_tenant_ts", "tenant_id", "queried_at"),
        Index("ix_dns_domain", "domain"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    network_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True
    )

    queried_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

    domain: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    query_type: Mapped[str] = mapped_column(String(10), default="A")  # A, AAAA, CNAME, MX, etc.

    # Response
    response_code: Mapped[str | None] = mapped_column(String(20), nullable=True)  # NOERROR, NXDOMAIN, etc.
    resolved_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)

    # Classification
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)  # Pi-hole blocked
    is_malicious: Mapped[bool] = mapped_column(Boolean, default=False)  # Threat intel hit
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)  # ads, tracker, malware, etc.

    # Source (pihole, suricata, etc.)
    source: Mapped[str] = mapped_column(String(50), default="suricata")
