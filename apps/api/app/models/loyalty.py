from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import (
    MONEY,
    QUANTITY,
    ZERO_MONEY,
    ZERO_QUANTITY,
    Base,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)
from app.models.enums import (
    LoyaltyCampaignType,
    LoyaltyLedgerEntryType,
    LoyaltyRedemptionStatus,
    LoyaltyRewardStatus,
    enum_column,
)


class LoyaltyProgram(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "loyalty_programs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_loyalty_program_tenant_name"),
        Index("ix_loyalty_program_tenant_active", "tenant_id", "is_active"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    show_on_qr: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    starts_at: Mapped[datetime | None] = mapped_column(nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    rule: Mapped[LoyaltyRule | None] = relationship(
        back_populates="program", lazy="selectin", uselist=False
    )
    program_branches: Mapped[list[LoyaltyProgramBranch]] = relationship(
        back_populates="program", lazy="selectin", cascade="all, delete-orphan"
    )


class LoyaltyProgramBranch(Base):
    __tablename__ = "loyalty_program_branches"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    program_id: Mapped[UUID] = mapped_column(
        ForeignKey("loyalty_programs.id", ondelete="CASCADE"), primary_key=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), primary_key=True, index=True
    )

    program: Mapped[LoyaltyProgram] = relationship(back_populates="program_branches")


class LoyaltyRule(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "loyalty_rules"
    __table_args__ = (
        UniqueConstraint("program_id", name="uq_loyalty_rule_program"),
        CheckConstraint("threshold > 0", name="loyalty_rule_threshold_positive"),
        CheckConstraint(
            "minimum_order_amount >= 0",
            name="loyalty_rule_minimum_order_nonnegative",
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    program_id: Mapped[UUID] = mapped_column(
        ForeignKey("loyalty_programs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    campaign_type: Mapped[LoyaltyCampaignType] = mapped_column(
        enum_column(LoyaltyCampaignType, "loyalty_campaign_type"), nullable=False
    )
    threshold: Mapped[int] = mapped_column(Integer, nullable=False)
    qualifying_product_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    qualifying_category_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    reward_product_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    reward_category_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    minimum_order_amount: Mapped[Decimal] = mapped_column(
        MONEY, default=ZERO_MONEY, nullable=False
    )
    allow_multiple_same_day: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    reward_same_order: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    program: Mapped[LoyaltyProgram] = relationship(back_populates="rule")


class LoyaltyCustomer(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "loyalty_customers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "phone_normalized", name="uq_loyalty_customer_phone"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    phone_normalized: Mapped[str] = mapped_column(String(32), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class LoyaltyMembership(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "loyalty_memberships"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "program_id",
            "customer_id",
            name="uq_loyalty_membership_customer_program",
        ),
        UniqueConstraint(
            "tenant_id", "referral_code", name="uq_loyalty_membership_referral"
        ),
        UniqueConstraint(
            "tenant_id", "lookup_code", name="uq_loyalty_membership_lookup_code"
        ),
        UniqueConstraint("public_token_hash", name="uq_loyalty_membership_token"),
        Index(
            "ix_loyalty_membership_tenant_program_active",
            "tenant_id",
            "program_id",
            "is_active",
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    program_id: Mapped[UUID] = mapped_column(
        ForeignKey("loyalty_programs.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    customer_id: Mapped[UUID] = mapped_column(
        ForeignKey("loyalty_customers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    public_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    lookup_code: Mapped[str] = mapped_column(String(32), nullable=False)
    referral_code: Mapped[str] = mapped_column(String(32), nullable=False)
    referred_by_membership_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("loyalty_memberships.id", ondelete="SET NULL"), nullable=True, index=True
    )
    consent_at: Mapped[datetime] = mapped_column(nullable=False)
    consent_text_version: Mapped[str] = mapped_column(String(40), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class LoyaltyLedgerEntry(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "loyalty_ledger_entries"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "idempotency_key", name="uq_loyalty_ledger_idempotency"
        ),
        UniqueConstraint(
            "program_id",
            "order_id",
            "entry_type",
            name="uq_loyalty_ledger_order_program_type",
        ),
        CheckConstraint("progress_delta != 0", name="loyalty_ledger_delta_nonzero"),
        Index(
            "ix_loyalty_ledger_membership_program_created",
            "tenant_id",
            "membership_id",
            "program_id",
            "created_at",
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    program_id: Mapped[UUID] = mapped_column(
        ForeignKey("loyalty_programs.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    membership_id: Mapped[UUID] = mapped_column(
        ForeignKey("loyalty_memberships.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    order_id: Mapped[UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    entry_type: Mapped[LoyaltyLedgerEntryType] = mapped_column(
        enum_column(LoyaltyLedgerEntryType, "loyalty_ledger_entry_type"), nullable=False
    )
    progress_delta: Mapped[Decimal] = mapped_column(
        QUANTITY, default=ZERO_QUANTITY, nullable=False
    )
    source_entry_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("loyalty_ledger_entries.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    actor_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    entry_metadata: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)


class LoyaltyReward(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "loyalty_rewards"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "membership_id",
            "program_id",
            "ordinal",
            name="uq_loyalty_reward_ordinal",
        ),
        UniqueConstraint(
            "tenant_id", "redemption_code", name="uq_loyalty_reward_redemption_code"
        ),
        CheckConstraint("ordinal > 0", name="loyalty_reward_ordinal_positive"),
        Index(
            "ix_loyalty_reward_membership_status",
            "tenant_id",
            "membership_id",
            "status",
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    program_id: Mapped[UUID] = mapped_column(
        ForeignKey("loyalty_programs.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    membership_id: Mapped[UUID] = mapped_column(
        ForeignKey("loyalty_memberships.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    source_ledger_entry_id: Mapped[UUID] = mapped_column(
        ForeignKey("loyalty_ledger_entries.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    reward_product_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    reward_category_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    redemption_code: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[LoyaltyRewardStatus] = mapped_column(
        enum_column(LoyaltyRewardStatus, "loyalty_reward_status"),
        default=LoyaltyRewardStatus.AVAILABLE,
        nullable=False,
        index=True,
    )
    issued_at: Mapped[datetime] = mapped_column(nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(nullable=True)
    redeemed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class LoyaltyRedemption(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "loyalty_redemptions"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "idempotency_key", name="uq_loyalty_redemption_idempotency"
        ),
        UniqueConstraint("reward_id", name="uq_loyalty_redemption_reward"),
        CheckConstraint("amount >= 0", name="loyalty_redemption_amount_nonnegative"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    membership_id: Mapped[UUID] = mapped_column(
        ForeignKey("loyalty_memberships.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    reward_id: Mapped[UUID] = mapped_column(
        ForeignKey("loyalty_rewards.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    order_id: Mapped[UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    order_item_id: Mapped[UUID] = mapped_column(
        ForeignKey("order_items.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    discount_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("discounts.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    actor_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[LoyaltyRedemptionStatus] = mapped_column(
        enum_column(LoyaltyRedemptionStatus, "loyalty_redemption_status"),
        default=LoyaltyRedemptionStatus.APPLIED,
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    reward_snapshot: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)


class LoyaltyVerificationChallenge(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "loyalty_verification_challenges"
    __table_args__ = (
        CheckConstraint(
            "failed_attempts >= 0",
            name="failed_attempts_nonnegative",
        ),
        Index(
            "ix_loyalty_verification_challenge_tenant_branch_expires",
            "tenant_id",
            "branch_id",
            "expires_at",
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    phone_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    request_ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mode: Mapped[str] = mapped_column(String(20), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False, index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class LoyaltyVerificationRateLimit(Base):
    __tablename__ = "loyalty_verification_rate_limits"
    __table_args__ = (
        CheckConstraint(
            "attempts > 0",
            name="attempts_positive",
        ),
    )

    scope_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    bucket_start: Mapped[datetime] = mapped_column(primary_key=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False, index=True)
