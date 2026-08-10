from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, Boolean, CheckConstraint, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow
from app.models.enums import TableSessionStatus, TableState, enum_column


class Area(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "areas"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "name", name="uq_area_tenant_branch_name"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    tables: Mapped[list[DiningTable]] = relationship(back_populates="area")


class DiningTable(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "dining_tables"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "branch_id", "area_id", "name", name="uq_table_tenant_branch_area_name"
        ),
        CheckConstraint("capacity > 0", name="capacity_positive"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    area_id: Mapped[UUID] = mapped_column(
        ForeignKey("areas.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    # A short free-text note staff attach to the table for the current guests,
    # e.g. "Ahmet" so the floor shows "B1 · Ahmet". Cleared when the table is
    # released; it is a service aid, never an identity record.
    guest_label: Mapped[str | None] = mapped_column(String(60), nullable=True)
    capacity: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    shape: Mapped[str | None] = mapped_column(String(30), nullable=True)
    visual_position: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    qr_token: Mapped[str] = mapped_column(
        String(64), default=lambda: uuid4().hex, unique=True, nullable=False, index=True
    )
    state: Mapped[TableState] = mapped_column(
        enum_column(TableState, "table_state"),
        default=TableState.AVAILABLE,
        nullable=False,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    area: Mapped[Area] = relationship(back_populates="tables")


class TableSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "table_sessions"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    table_id: Mapped[UUID] = mapped_column(
        ForeignKey("dining_tables.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    opened_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[TableSessionStatus] = mapped_column(
        enum_column(TableSessionStatus, "table_session_status"),
        default=TableSessionStatus.OPEN,
        nullable=False,
        index=True,
    )
    customer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(default=utcnow, nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(nullable=True)

    table: Mapped[DiningTable] = relationship()
