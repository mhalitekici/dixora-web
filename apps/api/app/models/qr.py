from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import JSON, Boolean, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import QrOrderMode, QrRequestStatus, enum_column


class QrMenuConfig(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "qr_menu_configs"
    __table_args__ = (UniqueConstraint("tenant_id", "branch_id", name="uq_qr_menu_tenant_branch"),)

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    menu_name: Mapped[str] = mapped_column(String(160), default="Menu", nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    order_mode: Mapped[QrOrderMode] = mapped_column(
        enum_column(QrOrderMode, "qr_order_mode"),
        default=QrOrderMode.WAITER_APPROVAL,
        nullable=False,
    )
    logo_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    cover_image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    primary_color: Mapped[str] = mapped_column(String(16), default="#F4511E", nullable=False)
    language: Mapped[str] = mapped_column(String(12), default="tr", nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="TRY", nullable=False)
    service_hours: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)
    out_of_hours_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    customer_notes_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allergens_visible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    max_order_amount: Mapped[int | None] = mapped_column(nullable=True)
    contact_info: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)
    social_links: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)


class QrOrderRequest(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "qr_order_requests"
    __table_args__ = (
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_qr_request_idempotency"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    table_id: Mapped[UUID] = mapped_column(
        ForeignKey("dining_tables.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    table_session_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("table_sessions.id", ondelete="SET NULL"), nullable=True
    )
    order_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    loyalty_membership_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("loyalty_memberships.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[QrRequestStatus] = mapped_column(
        enum_column(QrRequestStatus, "qr_request_status"),
        default=QrRequestStatus.PENDING,
        nullable=False,
        index=True,
    )
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)
    session_nonce_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    items_payload: Mapped[list[dict[str, object]]] = mapped_column(JSON, nullable=False)
    customer_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_metadata: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False, index=True)
    resolved_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(nullable=True)
