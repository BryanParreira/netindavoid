"""Saved searches — named SPL queries with optional schedule."""
import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, DateTime, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB

from core.database import Base
from models.mixins import TimestampMixin


class SavedSearch(Base, TimestampMixin):
    __tablename__ = "saved_searches"

    id: Mapped[uuid.UUID]           = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID]    = mapped_column(UUID(as_uuid=True), nullable=False, index=True)

    name: Mapped[str]               = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    query: Mapped[str]              = mapped_column(Text, nullable=False)
    time_range: Mapped[str]         = mapped_column(String(50), default="last_24h")

    # Visualization hint returned with search results
    viz_type: Mapped[str | None]    = mapped_column(String(30), nullable=True)  # table, line, bar, pie, single

    # Whether this search is pinned to the SIEM dashboard
    is_dashboard: Mapped[bool]      = mapped_column(Boolean, default=False)
    dashboard_order: Mapped[int]    = mapped_column(Integer, default=0)
