from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Date, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import MONEY, ZERO_MONEY, Base, TimestampMixin, UUIDPrimaryKeyMixin


class CashierShift(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "cashier_shifts"
    __table_args__ = (
        Index(
            "uq_cashier_shift_open_cashier",
            "tenant_id",
            "branch_id",
            "user_id",
            unique=True,
            postgresql_where=text("status = 'OPEN'"),
            sqlite_where=text("status = 'OPEN'"),
        ),
        Index(
            "uq_cashier_shift_open_actor",
            "tenant_id",
            "branch_id",
            "opened_by_user_id",
            unique=True,
            postgresql_where=text("status = 'OPEN'"),
            sqlite_where=text("status = 'OPEN'"),
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    predecessor_shift_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("cashier_shifts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    opened_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    closed_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    business_date: Mapped[date] = mapped_column(
        Date, default=date.today, nullable=False, index=True
    )
    # Snapshot the verified employee name so historical reports remain readable
    # after a later display-name change; user_id remains the identity source.
    cashier_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="OPEN", nullable=False, index=True)
    opening_cash: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    opening_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    closing_cash: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    cash_sales: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    card_sales: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    reported_card_total: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    card_variance: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    cash_refunds: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    card_refunds: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    total_sales: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    expected_cash: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    cash_variance: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    opened_at: Mapped[datetime] = mapped_column(nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    closing_note: Mapped[str | None] = mapped_column(String(500), nullable=True)


class BusinessDayClose(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "business_day_closes"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "branch_id", "business_date", name="uq_business_day_close_scope"
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    business_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    closed_by_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    closed_at: Mapped[datetime] = mapped_column(nullable=False)
    opening_cash: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    system_cash_total: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    system_card_total: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    cash_refunds: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    card_refunds: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    expected_cash: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    counted_cash: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    reported_card_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    cash_difference: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    card_difference: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    sales_total: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    discounts_total: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    complimentary_total: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    service_charge_total: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    receipt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
