"""Stored payment instruments for subscription billing.

The card number never reaches this system. The provider returns an opaque pair
of tokens and a masked descriptor; that is all that is kept, which keeps the
application out of PCI DSS scope.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class SavedCard(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "saved_cards"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "provider", "card_token", name="uq_saved_card_token"
        ),
        Index("ix_saved_cards_tenant_default", "tenant_id", "is_default"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(30), nullable=False)

    # Opaque provider handles. Together they identify the card for a charge.
    card_token: Mapped[str] = mapped_column(String(255), nullable=False)
    card_user_key: Mapped[str] = mapped_column(String(255), nullable=False)

    # For display only — enough for an owner to recognise their own card.
    masked_number: Mapped[str] = mapped_column(String(30), nullable=False)
    card_association: Mapped[str | None] = mapped_column(String(40), nullable=True)
    card_family: Mapped[str | None] = mapped_column(String(60), nullable=True)
    holder_name: Mapped[str | None] = mapped_column(String(120), nullable=True)

    is_default: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(nullable=True)


class PaymentAttempt(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One charge against one invoice.

    Kept even when it fails: dunning decisions and any dispute later depend on
    knowing exactly what was tried and what the provider said.
    """

    __tablename__ = "payment_attempts"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "idempotency_key", name="uq_payment_attempt_idempotency"
        ),
        Index("ix_payment_attempts_invoice", "tenant_id", "invoice_id"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    invoice_id: Mapped[UUID] = mapped_column(
        ForeignKey("invoices.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    saved_card_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("saved_cards.id", ondelete="SET NULL"), nullable=True
    )
    provider: Mapped[str] = mapped_column(String(30), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    provider_payment_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(400), nullable=True)
