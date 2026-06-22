import uuid

from sqlalchemy import String, Boolean, ForeignKey, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB

from core.database import Base
from models.mixins import TimestampMixin


class RouterConfig(Base, TimestampMixin):
    """Stores router credentials encrypted at rest via Fernet."""
    __tablename__ = "router_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True, index=True)

    router_type: Mapped[str] = mapped_column(String(50), default="openwrt")  # openwrt, dd-wrt, generic
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    ssh_port: Mapped[int] = mapped_column(Integer, default=22)
    ssh_user: Mapped[str] = mapped_column(String(100), default="root")

    # Encrypted with Fernet — never stored in plaintext
    encrypted_ssh_password: Mapped[str | None] = mapped_column(Text, nullable=True)
    encrypted_ssh_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    # API-based access (ubus RPC)
    api_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    encrypted_api_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_connected_at: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Capabilities discovered on connect
    capabilities: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
