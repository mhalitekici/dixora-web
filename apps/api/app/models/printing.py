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
    # Reported by the local agent on every heartbeat/claim; purely descriptive,
    # never trusted for authorization decisions.
    platform: Mapped[str | None] = mapped_column(String(20), nullable=True)
    version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    printer_inventory: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(nullable=True)


class PrintBridgeEnrollmentCode(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A short-lived, one-time code that lets a new desktop agent enroll itself.

    Deliberately separate from `PrintBridgeClient`: nothing about the eventual
    bridge (its id, its token) exists until the code is redeemed, so a code
    that is never used or that expires leaves nothing behind to revoke.
    """

    __tablename__ = "print_bridge_enrollment_codes"
    __table_args__ = (
        UniqueConstraint("code_hash", name="uq_print_bridge_enrollment_code_hash"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False, index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_bridge_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("print_bridge_clients.id", ondelete="SET NULL"), nullable=True
    )


class PrintBridgePrinterMapping(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One physical destination owned by one enrolled local bridge.

    A printer device can be routed to only one agent at a time. That removes a
    class of duplicate-ticket failures where two computers both advertise the
    same code and race to print the same kitchen job.
    """

    __tablename__ = "print_bridge_printer_mappings"
    __table_args__ = (
        UniqueConstraint("printer_device_id", name="uq_print_bridge_mapping_device"),
        UniqueConstraint(
            "bridge_id", "printer_device_id", name="uq_print_bridge_mapping_pair"
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bridge_id: Mapped[UUID] = mapped_column(
        ForeignKey("print_bridge_clients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    printer_device_id: Mapped[UUID] = mapped_column(
        ForeignKey("printer_devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    local_printer_name: Mapped[str] = mapped_column(String(255), nullable=False)


class PrintJobAcknowledgement(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Durable idempotency record for a bridge status acknowledgement."""

    __tablename__ = "print_job_acknowledgements"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "idempotency_key", name="uq_print_job_ack_idempotency"
        ),
        UniqueConstraint(
            "print_job_id",
            "bridge_id",
            "attempt_count",
            "status",
            name="uq_print_job_ack_attempt_status",
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    print_job_id: Mapped[UUID] = mapped_column(
        ForeignKey("print_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bridge_id: Mapped[UUID] = mapped_column(
        ForeignKey("print_bridge_clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[PrintJobStatus] = mapped_column(
        enum_column(PrintJobStatus, "print_job_status"), nullable=False
    )
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False)


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
    print_result: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    # A bridge can know that it reached the local spool boundary, yet still be
    # unable to prove whether the paper came out. Those jobs must never return
    # to the ordinary automatic retry pool: a manager explicitly requeues
    # them after checking the physical printer.
    manual_retry_required: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, index=True
    )
    # Set whenever a bridge claims or advances this job; cleared once it reaches
    # a terminal state. A CLAIMED/SENT job whose lease has passed is treated as
    # abandoned (crashed bridge, dropped connection) and becomes reclaimable
    # again — without this, a bridge crash between CLAIMED and PRINTED leaves
    # the job stuck forever with no operator-free way to recover it.
    lease_expires_at: Mapped[datetime | None] = mapped_column(nullable=True, index=True)
