from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CampaignUpsert(BaseModel):
    """The owner's "buy this, get that" form."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=400)
    is_active: bool = True
    branch_ids: list[UUID] = Field(min_length=1)

    buy_product_id: UUID | None = None
    buy_category_id: UUID | None = None
    buy_quantity: int = Field(default=1, ge=1, le=99)
    minimum_order_amount: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=14, decimal_places=2
    )

    reward_kind: Literal["FREE_ITEM", "PERCENT", "AMOUNT"] = "FREE_ITEM"
    reward_product_id: UUID | None = None
    reward_category_id: UUID | None = None
    reward_quantity: int = Field(default=1, ge=1, le=99)
    reward_value: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=14, decimal_places=2
    )

    # Members-only by design: a campaign is a reason to join the programme,
    # so it is unlocked by the member code at the till.
    audience: Literal["MEMBERS_ONLY"] = "MEMBERS_ONLY"
    max_uses_per_order: int = Field(default=1, ge=1, le=20)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    # Absent when creating; required when editing so two managers cannot
    # silently overwrite each other.
    expected_version: int | None = None


class CampaignOut(BaseModel):
    id: UUID
    name: str
    description: str | None
    is_active: bool
    branch_ids: list[UUID]
    buy_product_id: UUID | None
    buy_category_id: UUID | None
    buy_quantity: int
    minimum_order_amount: Decimal
    reward_kind: str
    reward_product_id: UUID | None
    reward_category_id: UUID | None
    reward_quantity: int
    reward_value: Decimal
    audience: str
    max_uses_per_order: int
    starts_at: datetime | None
    ends_at: datetime | None
    version: int
    # Human-readable one-liner, built server-side so every screen phrases the
    # offer identically.
    summary: str


class CampaignGrantOut(BaseModel):
    campaign_id: UUID
    campaign_name: str
    order_item_id: UUID
    product_name: str
    amount: Decimal


class CampaignApplyOut(BaseModel):
    order_id: UUID
    granted: list[CampaignGrantOut]
    total_discount: Decimal
    order_total: Decimal
    # True when a members-only campaign matched the basket but no member code
    # was attached, so the till can prompt for one.
    skipped_members_only: bool
