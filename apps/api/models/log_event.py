"""Log events — TimescaleDB hypertable, one row per ingested log line."""
import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Text, Index
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB

from core.database import Base


class LogEvent(Base):
    """
    Central log store.  Maps roughly to a Splunk event:
        index      → index_name   (partition bucket: main, security, network, dns …)
        source     → source       (origin file / URL / device)
        sourcetype → sourcetype   (parser: syslog, json, apache:access, suricata:eve …)
        host       → host         (hostname or IP of the sender)
        _raw       → message      (raw log line)
        _time      → timestamp    (event time, not ingest time)
        fields     → JSONB blob   (extracted key=value pairs)
    """
    __tablename__ = "log_events"
    __table_args__ = (
        Index("ix_log_events_tenant_ts",     "tenant_id", "timestamp"),
        Index("ix_log_events_sourcetype",    "sourcetype"),
        Index("ix_log_events_host",          "host"),
        Index("ix_log_events_severity",      "severity"),
        Index("ix_log_events_index",         "index_name"),
        Index("ix_log_events_fields_gin",    "fields", postgresql_using="gin"),
    )

    id: Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID]  = mapped_column(UUID(as_uuid=True), nullable=False)
    network_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)

    # Event time (from log itself, not ingest time)
    timestamp: Mapped[datetime]   = mapped_column(DateTime(timezone=True), nullable=False)

    # Splunk-style metadata
    index_name: Mapped[str]       = mapped_column(String(100), nullable=False, default="main")
    source:     Mapped[str | None] = mapped_column(String(512), nullable=True)
    sourcetype: Mapped[str | None] = mapped_column(String(100), nullable=True)
    host:       Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Raw log message
    message: Mapped[str]          = mapped_column(Text, nullable=False)

    # Derived severity: info, notice, warning, error, critical
    severity: Mapped[str | None]  = mapped_column(String(20), nullable=True)

    # Extracted structured fields (e.g. src_ip, dst_port, status_code, user, action …)
    fields: Mapped[dict]          = mapped_column(JSONB, nullable=False, default=dict)
