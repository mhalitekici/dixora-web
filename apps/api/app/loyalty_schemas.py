from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.enums import (
    LoyaltyCampaignType,
    LoyaltyRedemptionStatus,
    LoyaltyRewardStatus,
)


class LoyaltyProgramUpsert(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=2, max_length=160)
    is_active: bool = False
    show_on_qr: bool = False
    campaign_type: LoyaltyCampaignType
    threshold: int = Field(ge=1, le=10_000)
    branch_ids: list[UUID] = Field(default_factory=list, max_length=250)
    qualifying_product_id: UUID | None = None
    qualifying_category_id: UUID | None = None
    reward_product_id: UUID | None = None
    reward_category_id: UUID | None = None
    minimum_order_amount: Decimal = Field(
        default=Decimal("0.00"), ge=0, max_digits=14, decimal_places=2
    )
    allow_multiple_same_day: bool = False
    reward_same_order: bool = False
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    expected_version: int | None = Field(default=None, ge=1)

    @field_validator("branch_ids")
    @classmethod
    def unique_branches(cls, value: list[UUID]) -> list[UUID]:
        if len(value) != len(set(value)):
            raise ValueError("Branch selections must be unique")
        return value

    @model_validator(mode="after")
    def validate_rule(self) -> Self:
        if self.ends_at is not None and self.starts_at is not None:
            if self.ends_at <= self.starts_at:
                raise ValueError("Program end must be after its start")
        reward_targets = [self.reward_product_id, self.reward_category_id]
        if sum(item is not None for item in reward_targets) != 1:
            raise ValueError("Exactly one reward product or category is required")
        qualifying_targets = [
            self.qualifying_product_id,
            self.qualifying_category_id,
        ]
        if self.campaign_type == LoyaltyCampaignType.PRODUCT_QUANTITY:
            if sum(item is not None for item in qualifying_targets) != 1:
                raise ValueError(
                    "Product campaigns require exactly one qualifying product or category"
                )
        elif any(item is not None for item in qualifying_targets):
            raise ValueError("Visit campaigns cannot define a qualifying product or category")
        if self.reward_same_order:
            raise ValueError(
                "Same-order rewards require a payment reservation flow and are not enabled"
            )
        return self


class LoyaltyRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    campaign_type: LoyaltyCampaignType
    threshold: int
    qualifying_product_id: UUID | None
    qualifying_category_id: UUID | None
    reward_product_id: UUID | None
    reward_category_id: UUID | None
    minimum_order_amount: Decimal
    allow_multiple_same_day: bool
    reward_same_order: bool


class LoyaltyProgramStats(BaseModel):
    active_customers: int
    available_rewards: int
    redeemed_rewards: int


class LoyaltyProgramOut(BaseModel):
    id: UUID
    name: str
    is_active: bool
    show_on_qr: bool
    starts_at: datetime | None
    ends_at: datetime | None
    version: int
    branch_ids: list[UUID]
    rule: LoyaltyRuleOut
    stats: LoyaltyProgramStats


class LoyaltyCustomerOut(BaseModel):
    membership_code: str
    display_name: str
    # Masked email for email-enrolled members, masked phone for legacy ones.
    contact_masked: str
    branch_id: UUID
    program_name: str
    progress: Decimal
    available_rewards: int
    joined_at: datetime
    is_active: bool


class LoyaltyAdminRewardOut(BaseModel):
    redemption_code: str
    membership_code: str
    program_name: str
    status: LoyaltyRewardStatus
    issued_at: datetime
    redeemed_at: datetime | None


class LoyaltyPublicOfferOut(BaseModel):
    enabled: bool
    program_name: str | None = None
    campaign_type: LoyaltyCampaignType | None = None
    threshold: int | None = None
    minimum_order_amount: Decimal | None = None
    allow_multiple_same_day: bool | None = None
    qualifying_description: str | None = None
    reward_description: str | None = None
    reward_same_order: bool | None = None
    ends_at: datetime | None = None


class LoyaltyVerificationStart(BaseModel):
    phone: str = Field(min_length=7, max_length=32)
    consent_accepted: Literal[True]


class LoyaltyVerificationOut(BaseModel):
    verification_token: str
    expires_in: int
    mode: Literal["DEVELOPMENT", "PROVIDER"]
    development_code: str | None = None
    message: str


class LoyaltyEnroll(BaseModel):
    phone: str = Field(min_length=7, max_length=32)
    verification_token: str = Field(min_length=32, max_length=2048)
    verification_code: str = Field(min_length=4, max_length=12)
    consent_accepted: Literal[True]
    consent_text_version: str = Field(default="2026-08", min_length=1, max_length=40)
    referral_code: str | None = Field(default=None, min_length=8, max_length=32)


class LoyaltyEnrollmentOut(BaseModel):
    membership_token: str
    membership_code: str
    referral_code: str
    program_name: str
    verification_mode: Literal["DEVELOPMENT", "PROVIDER"]


class LoyaltyPublicRewardOut(BaseModel):
    redemption_code: str
    description: str
    status: LoyaltyRewardStatus
    issued_at: datetime
    expires_at: datetime | None


class LoyaltyPublicStatusOut(BaseModel):
    program_name: str
    campaign_type: LoyaltyCampaignType
    progress: Decimal
    target: int
    membership_code: str
    referral_code: str
    rewards: list[LoyaltyPublicRewardOut]


class LoyaltyMembershipAttach(BaseModel):
    # Card codes are short by design (e.g. DXR1923) so they can be read aloud
    # at the counter; the old MB-prefixed format was 19 characters.
    membership_code: str = Field(min_length=6, max_length=32)


class LoyaltyMembershipAttachOut(BaseModel):
    order_id: UUID
    membership_code: str
    program_name: str


class LoyaltyOrderRewardOut(BaseModel):
    redemption_code: str
    description: str
    eligible_order_item_ids: list[UUID]
    expires_at: datetime | None


class LoyaltyOrderContextOut(BaseModel):
    order_id: UUID
    membership_code: str | None
    program_name: str | None
    available_rewards: list[LoyaltyOrderRewardOut]


class CampaignApplyIn(BaseModel):
    """One member code typed at the payment screen."""

    member_code: str = Field(min_length=4, max_length=32)
    idempotency_key: str = Field(min_length=8, max_length=160)


class AppliedCampaignOut(BaseModel):
    redemption_code: str
    order_item_id: UUID
    product_name: str
    amount: Decimal


class CampaignApplyOut(BaseModel):
    order_id: UUID
    membership_code: str
    program_name: str
    applied: list[AppliedCampaignOut]
    # Owner-defined campaigns unlocked by the same code, reported separately
    # from stamp-card rewards so the till can tell them apart.
    campaigns: list[AppliedCampaignOut] = []
    total_discount: Decimal
    order_total: Decimal
    # Present when the code was valid but nothing could be granted, so the
    # cashier can explain why instead of seeing a silent no-op.
    unapplied_reason: str | None


class LoyaltyRedemptionCreate(BaseModel):
    order_id: UUID
    order_item_id: UUID
    idempotency_key: str = Field(min_length=8, max_length=160)


class LoyaltyRedemptionOut(BaseModel):
    id: UUID
    redemption_code: str
    order_id: UUID
    order_item_id: UUID
    discount_id: UUID | None
    status: LoyaltyRedemptionStatus
    amount: Decimal
    created_at: datetime


class LoyaltyReversalCreate(BaseModel):
    idempotency_key: str = Field(min_length=8, max_length=160)
    reason: str = Field(min_length=3, max_length=255)


class LoyaltyReversalOut(BaseModel):
    order_id: UUID
    reversed_programs: int
    reversed_progress: Decimal


class LoyaltyEnrollmentStart(BaseModel):
    """What the cashier types in while the customer is at the counter."""

    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=255)
    birth_date: date | None = None


class PublicLoyaltyEmailEnrollmentStart(LoyaltyEnrollmentStart):
    consent_accepted: Literal[True]


class LoyaltyEnrollmentStartOut(BaseModel):
    verification_id: UUID
    email: str
    expires_in_seconds: int
    # Only set by the development email sender so local testing can proceed
    # without a mailbox; always null once a real provider is configured.
    development_code: str | None = None


class LoyaltyEnrollmentConfirm(BaseModel):
    verification_id: UUID
    code: str = Field(min_length=4, max_length=12)


class LoyaltyEnrollmentConfirmOut(BaseModel):
    member_code: str
    display_name: str
    email: str
    program_name: str
    progress: Decimal
    progress_target: int
    card_email_sent: bool


class LoyaltyMemberLookupOut(BaseModel):
    member_code: str
    display_name: str
    program_name: str
    progress: Decimal
    progress_target: int
    available_rewards: int
    is_active: bool
