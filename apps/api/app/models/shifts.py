from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import MONEY, ZERO_MONEY, Base, TimestampMixin, UUIDPrimaryKeyMixin


class CashierShift(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "cashier_shifts"

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
    # The physical person holding the till, typed at open/handoff time. Cafes
    # commonly share one login across staff, so this — not the login's own
    # display name — is the source of truth for "whose shift is this".
    cashier_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="OPEN", nullable=False, index=True)
    opening_cash: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    opening_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    closing_cash: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    cash_sales: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    card_sales: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    total_sales: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    cash_variance: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    opened_at: Mapped[datetime] = mapped_column(nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    closing_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
