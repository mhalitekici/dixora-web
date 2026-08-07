from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import PrintJobKind, PrintJobStatus, enum_column


class PrinterDevice(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "printer_devices"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "code", name="uq_printer_scope_code"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    preparation_station_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("preparation_stations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    code: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    transport: Mapped[str] = mapped_column(String(40), default="MOCK", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(nullable=True)
    settings: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)


class PrintBridgeClient(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "print_bridge_clients"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_print_bridge_token_hash"),
        UniqueConstraint("tenant_id", "branch_id", "name", name="uq_print_bridge_scope_name"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(nullable=True)


class PrintJob(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "print_jobs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_print_job_idempotency"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    preparation_station_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("preparation_stations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    printer_device_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("printer_devices.id", ondelete="SET NULL"), nullable=True, index=True
    )
    claimed_by_bridge_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("print_bridge_clients.id", ondelete="SET NULL"), nullable=True, index=True
    )
    order_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("orders.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    kitchen_ticket_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("kitchen_tickets.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    payload: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
    status: Mapped[PrintJobStatus] = mapped_column(
        enum_column(PrintJobStatus, "print_job_status"),
        default=PrintJobStatus.PENDING,
        nullable=False,
        index=True,
    )
    kind: Mapped[PrintJobKind] = mapped_column(
        enum_column(PrintJobKind, "print_job_kind"),
        default=PrintJobKind.ORIGINAL,
        nullable=False,
    )
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(nullable=True)
    printed_at: Mapped[datetime | None] = mapped_column(nullable=True)
