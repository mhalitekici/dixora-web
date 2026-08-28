"""Owner-defined promotions: "buy this, get that".

Deliberately separate from the loyalty programme. Loyalty is one long-running
rule per business that accumulates progress across visits; a campaign is a
standalone offer the owner writes, there can be many of them at once, and they
are evaluated against the basket in front of the till. Mixing the two into one
table would have forced every campaign to carry loyalty's stamp-card machinery.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import MONEY, Base, TimestampMixin, UUIDPrimaryKeyMixin, ZERO_MONEY
from app.models.enums import CampaignAudience, CampaignRewardKind, enum_column


class Campaign(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "campaigns"
    __table_args__ = (
        CheckConstraint("buy_quantity > 0", name="campaign_buy_quantity_positive"),
        CheckConstraint("reward_quantity > 0", name="campaign_reward_quantity_positive"),
        CheckConstraint(
            "max_uses_per_order > 0", name="campaign_max_uses_positive"
        ),
        CheckConstraint("reward_value >= 0", name="campaign_reward_value_nonnegative"),
        CheckConstraint(
            "minimum_order_amount >= 0", name="campaign_minimum_order_nonnegative"
        ),
        Index("ix_campaigns_active", "tenant_id", "is_active"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(400), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # --- Condition: what the customer has to buy -------------------------
    # Exactly one of product/category is set; enforced in the service layer so
    # the message can name the field the owner actually sees.
    buy_product_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    buy_category_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    buy_quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    minimum_order_amount: Mapped[Decimal] = mapped_column(
        MONEY, default=ZERO_MONEY, nullable=False
    )

    # --- Reward: what they get -------------------------------------------
    reward_kind: Mapped[CampaignRewardKind] = mapped_column(
        enum_column(CampaignRewardKind, "campaign_reward_kind"), nullable=False
    )
    reward_product_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    reward_category_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    reward_quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    # Percentage for PERCENT, lira for AMOUNT, unused for FREE_ITEM.
    reward_value: Mapped[Decimal] = mapped_column(
        MONEY, default=ZERO_MONEY, nullable=False
    )

    audience: Mapped[CampaignAudience] = mapped_column(
        enum_column(CampaignAudience, "campaign_audience"),
        default=CampaignAudience.MEMBERS_ONLY,
        nullable=False,
    )
    max_uses_per_order: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    starts_at: Mapped[datetime | None] = mapped_column(nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(nullable=True)

    # Optimistic concurrency, matching the rest of the admin surfaces.
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    campaign_branches: Mapped[list[CampaignBranch]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan", lazy="selectin"
    )


class CampaignBranch(Base):
    """Which branches run a campaign. No row for a branch means it does not."""

    __tablename__ = "campaign_branches"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    campaign_id: Mapped[UUID] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), primary_key=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), primary_key=True, index=True
    )

    campaign: Mapped[Campaign] = relationship(back_populates="campaign_branches")


class CampaignApplication(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """An audit row: this campaign gave this much off this order.

    Also the idempotency guard — re-running evaluation for an order must not
    stack a second copy of the same offer.
    """

    __tablename__ = "campaign_applications"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "order_id",
            "campaign_id",
            "order_item_id",
            name="uq_campaign_application_line",
        ),
        Index("ix_campaign_applications_order", "tenant_id", "order_id"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    campaign_id: Mapped[UUID] = mapped_column(
        ForeignKey("campaigns.id", ondelete="RESTRICT"), nullable=False, index=True
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
    amount: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    campaign_name_snapshot: Mapped[str] = mapped_column(String(120), nullable=False)
