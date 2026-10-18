from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    JSON,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class EmailNotification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Small durable outbox for campaign and earned-reward email only."""

    __tablename__ = "email_notifications"
    __table_args__ = (
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_email_notification_key"),
        CheckConstraint("attempts >= 0", name="email_notification_attempts_nonnegative"),
        Index("ix_email_notification_delivery", "status", "next_attempt_at", "created_at"),
        Index("ix_email_notification_campaign", "tenant_id", "campaign_id"),
        Index("ix_email_notification_reward", "tenant_id", "reward_id"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    notification_type: Mapped[str] = mapped_column(String(48), nullable=False)
    customer_id: Mapped[UUID] = mapped_column(
        ForeignKey("loyalty_customers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    campaign_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("campaigns.id", ondelete="RESTRICT"), nullable=True
    )
    reward_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("loyalty_rewards.id", ondelete="RESTRICT"), nullable=True
    )
    recipient_email: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="PENDING", nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(nullable=True)
    next_attempt_at: Mapped[datetime | None] = mapped_column(nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)
