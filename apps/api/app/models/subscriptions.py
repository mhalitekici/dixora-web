from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import MONEY, ZERO_MONEY, Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import TenantState, enum_column


class SubscriptionPlan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "subscription_plans"

    code: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Base price, which already covers `included_branches` locations.
    monthly_price: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="TRY", nullable=False)
    # Branch-based pricing: base covers this many branches, each further ACTIVE
    # branch adds `additional_branch_price`. Archived branches never count.
    # server_default matters as much as the Python default: historical migrations
    # insert plan rows without naming these columns, and a fresh database must
    # not reject them. It also keeps the model in step with migration 0017.
    included_branches: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )
    additional_branch_price: Mapped[Decimal] = mapped_column(
        MONEY, default=ZERO_MONEY, server_default="0", nullable=False
    )
    max_branches: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_users: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class SubscriptionFeature(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "subscription_features"
    __table_args__ = (UniqueConstraint("plan_id", "feature_code", name="uq_plan_feature"),)

    plan_id: Mapped[UUID] = mapped_column(
        ForeignKey("subscription_plans.id", ondelete="CASCADE"), nullable=False, index=True
    )
    feature_code: Mapped[str] = mapped_column(String(80), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    limits: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)


class Subscription(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "subscriptions"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, unique=True, index=True
    )
    plan_id: Mapped[UUID] = mapped_column(
        ForeignKey("subscription_plans.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[TenantState] = mapped_column(
        enum_column(TenantState, "subscription_status"), nullable=False
    )
    starts_at: Mapped[datetime] = mapped_column(nullable=False)
    ends_at: Mapped[datetime | None] = mapped_column(nullable=True)


class TenantFeatureOverride(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tenant_feature_overrides"
    __table_args__ = (
        UniqueConstraint("tenant_id", "feature_code", name="uq_tenant_feature_override"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    feature_code: Mapped[str] = mapped_column(String(80), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    limits: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(nullable=True)


class Invoice(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "invoices"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    subscription_id: Mapped[UUID] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="RESTRICT"), nullable=False
    )
    number: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="DRAFT", nullable=False)
    issued_at: Mapped[datetime | None] = mapped_column(nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(nullable=True)
