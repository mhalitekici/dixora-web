from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Generic, Literal, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.enums import (
    ApprovalStatus,
    ApprovalType,
    DiscountKind,
    HotelRoomStatus,
    KitchenTicketStatus,
    OrderItemStatus,
    OrderSource,
    OrderStatus,
    PrintJobKind,
    PrintJobStatus,
    QrOrderMode,
    QrRequestStatus,
    StockMovementType,
    TableState,
    TenantState,
)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class Message(BaseModel):
    message: str


class LoginRequest(BaseModel):
    business: str | None = Field(default=None, max_length=100)
    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=4, max_length=256)
    branch_id: UUID | None = None
    device_name: str | None = Field(default=None, max_length=160)
    remember_me: bool = False
    enroll_trusted_device: bool = False
    trusted_device_token: str | None = Field(default=None, max_length=200)


class BusinessRegistrationRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    business_name: str = Field(min_length=2, max_length=140)
    business_type: Literal["RESTAURANT", "CAFE", "BAR", "HOTEL"] = "RESTAURANT"
    owner_name: str = Field(min_length=2, max_length=160)
    email: str = Field(
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
        max_length=255,
    )
    phone: str = Field(pattern=r"^[0-9+()\s.-]{7,32}$", max_length=32)
    password: str = Field(min_length=10, max_length=256)
    terms_accepted: Literal[True]
    contract_version: str = Field(default="unknown", max_length=40)


class BusinessRegistrationStartOut(BaseModel):
    verification_id: UUID
    email: str
    expires_in_seconds: int
    development_code: str | None = None


class BusinessRegistrationConfirm(BaseModel):
    verification_id: UUID
    code: str = Field(min_length=4, max_length=12)


DELIVERY_PLATFORMS = (
    "GETIR",
    "YEMEKSEPETI",
    "TRENDYOL_YEMEK",
    "MIGROS_YEMEK",
    "FUUDY",
    "OTHER",
)

# Meal-card schemes common in Turkey. Answers drive which POS integrations we
# build next, so they are stored as codes rather than free text.
MEAL_CARD_PROVIDERS = (
    "MULTINET",
    "SODEXO",
    "SETCARD",
    "TICKET",
    "METROPOL",
    "PLUXEE",
    "EDENRED",
    "OTHER",
)

PAYMENT_METHODS = ("CASH", "CARD", "MEAL_CARD", "ONLINE", "TRANSFER")


class OnboardingUpdate(BaseModel):
    """Answers from the post-signup questionnaire; every field is optional."""

    offers_delivery: bool | None = None
    delivery_platforms: list[str] = Field(default_factory=list)
    payment_methods: list[str] = Field(default_factory=list)
    accepts_meal_cards: bool | None = None
    meal_card_providers: list[str] = Field(default_factory=list)
    monthly_order_volume: str | None = Field(default=None, max_length=40)
    table_count: int | None = Field(default=None, ge=0, le=10_000)
    heard_from: str | None = Field(default=None, max_length=60)
    completed: bool = False

    @field_validator("delivery_platforms")
    @classmethod
    def known_platforms(cls, value: list[str]) -> list[str]:
        unknown = [item for item in value if item not in DELIVERY_PLATFORMS]
        if unknown:
            raise ValueError(f"Unsupported delivery platforms: {', '.join(unknown)}")
        return value

    @field_validator("meal_card_providers")
    @classmethod
    def known_meal_cards(cls, value: list[str]) -> list[str]:
        unknown = [item for item in value if item not in MEAL_CARD_PROVIDERS]
        if unknown:
            raise ValueError(f"Unsupported meal card providers: {', '.join(unknown)}")
        return value

    @field_validator("payment_methods")
    @classmethod
    def known_payment_methods(cls, value: list[str]) -> list[str]:
        unknown = [item for item in value if item not in PAYMENT_METHODS]
        if unknown:
            raise ValueError(f"Unsupported payment methods: {', '.join(unknown)}")
        return value


class OnboardingOut(BaseModel):
    offers_delivery: bool | None
    delivery_platforms: list[str]
    payment_methods: list[str]
    accepts_meal_cards: bool | None
    meal_card_providers: list[str]
    monthly_order_volume: str | None
    table_count: int | None
    heard_from: str | None
    completed: bool
    # What the answers actually configured, so the wizard can report it back.
    applied: dict[str, Any] | None = None


class BusinessRegistrationOut(BaseModel):
    tenant_id: UUID
    business_name: str
    business_slug: str
    branch_slug: str
    owner_username: str
    trial_ends_at: datetime


class PinLoginRequest(BaseModel):
    business_slug: str = Field(min_length=1, max_length=100)
    branch_slug: str = Field(min_length=1, max_length=100)
    username: str = Field(min_length=1, max_length=100)
    pin: str = Field(min_length=4, max_length=12, pattern=r"^\d{4,12}$")
    device_token: str | None = Field(default=None, max_length=200)


class RefreshRequest(BaseModel):
    refresh_token: str


class SwitchBranchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: str
    branch_id: UUID


class LogoutRequest(BaseModel):
    refresh_token: str | None = None


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_expires_in: int
    remember_me: bool = False


class TenantSessionSummary(BaseModel):
    id: UUID
    name: str
    slug: str
    state: TenantState
    is_active: bool
    default_currency: str


class BranchSessionSummary(BaseModel):
    id: UUID
    name: str
    slug: str
    timezone: str
    is_active: bool


class AccessibleBranchesOut(BaseModel):
    branches: list[BranchSessionSummary]
    current_branch_id: UUID | None
    can_switch: bool


class RoleOut(ORMModel):
    id: UUID
    code: str
    name: str
    permissions: list[str] = []


class MeOut(BaseModel):
    id: UUID
    tenant_id: UUID | None
    branch_id: UUID | None
    username: str
    email: str | None
    display_name: str
    role: str
    permissions: list[str]
    is_super_admin: bool
    tenant: TenantSessionSummary | None = None
    branch: BranchSessionSummary | None = None


class TrustedDeviceEnrollment(BaseModel):
    token: str
    expires_in: int


class AuthResponse(TokenPair):
    user: MeOut
    trusted_device: TrustedDeviceEnrollment | None = None


class RealtimeTicketOut(BaseModel):
    ticket: str
    expires_in: int = 60


class BranchWorkingHours(BaseModel):
    is_closed: bool = False
    opens_at: str | None = Field(default=None, pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    closes_at: str | None = Field(default=None, pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")


WorkingHours = dict[
    Literal["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
    BranchWorkingHours,
]


class BranchCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=100)
    timezone: str = Field(default="Europe/Istanbul", max_length=80)
    address: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, pattern=r"^[0-9+()\s.-]{7,32}$", max_length=32)
    working_hours: WorkingHours = Field(default_factory=dict)


class BranchOut(ORMModel):
    id: UUID
    tenant_id: UUID
    name: str
    slug: str
    timezone: str
    address: str | None
    phone: str | None
    working_hours: WorkingHours
    is_active: bool
    archived_at: datetime | None = None


class BranchPricingOut(BaseModel):
    """What the business is billed for its branches, and what one more costs."""

    currency: str
    base_monthly_price: Decimal
    included_branches: int
    additional_branch_price: Decimal
    active_branches: int
    billable_extra_branches: int
    monthly_total: Decimal
    next_branch_monthly_total: Decimal


class BranchArchiveRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=255)


class UserBranchAccessUpdate(BaseModel):
    """The complete set of branches this user may operate in."""

    branch_ids: list[UUID]


class UserBranchAccessOut(BaseModel):
    user_id: UUID
    primary_branch_id: UUID | None
    branch_ids: list[UUID]
    has_all_branch_access: bool


class BranchUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    timezone: str | None = Field(default=None, max_length=80)
    address: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, pattern=r"^[0-9+()\s.-]{7,32}$", max_length=32)
    working_hours: WorkingHours | None = None
    is_active: bool | None = None


class BranchUsageOut(BaseModel):
    plan_name: str | None
    max_branches: int | None
    active_branches: int
    total_branches: int
    can_create: bool


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    email: str | None = Field(
        default=None,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
        max_length=255,
    )
    display_name: str = Field(min_length=1, max_length=160)
    phone: str | None = Field(default=None, pattern=r"^[0-9+()\s.-]{7,32}$", max_length=32)
    role_id: UUID
    branch_id: UUID | None = None
    preparation_station_id: UUID | None = None
    temporary_password: str = Field(min_length=10, max_length=256)
    pin: str | None = Field(
        default=None,
        min_length=4,
        max_length=12,
        pattern=r"^\d{4,12}$",
    )
    is_active: bool = True


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=160)
    email: str | None = Field(
        default=None,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
        max_length=255,
    )
    phone: str | None = Field(default=None, pattern=r"^[0-9+()\s.-]{7,32}$", max_length=32)
    role_id: UUID | None = None
    branch_id: UUID | None = None
    preparation_station_id: UUID | None = None
    is_active: bool | None = None


class UserOut(BaseModel):
    id: UUID
    tenant_id: UUID
    branch_id: UUID | None
    preparation_station_id: UUID | None
    role_id: UUID
    role: str
    username: str
    email: str | None
    phone: str | None
    display_name: str
    is_active: bool
    has_pin: bool
    permissions: list[str]


class PasswordChange(BaseModel):
    password: str = Field(min_length=10, max_length=256)


class SelfPasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=10, max_length=256)


class AdminPasswordResetRequest(BaseModel):
    """Super-admin initiated reset. The password is never echoed back."""

    new_password: str = Field(min_length=10, max_length=256)
    reason: str | None = Field(default=None, max_length=500)


class AdminPasswordResetOut(BaseModel):
    user_id: UUID
    username: str
    sessions_revoked: int


class BusinessUserOut(BaseModel):
    id: UUID
    username: str
    display_name: str
    email: str | None
    role: str
    is_active: bool


class PinChange(BaseModel):
    pin: str | None = Field(
        default=None,
        min_length=4,
        max_length=12,
        pattern=r"^\d{4,12}$",
    )


class RoleCreate(BaseModel):
    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{2,49}$")
    name: str = Field(min_length=1, max_length=100)
    permission_codes: list[str] = []


class RoleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    permission_codes: list[str] | None = None
    is_active: bool | None = None


class RoleDetailOut(BaseModel):
    id: UUID
    tenant_id: UUID | None
    code: str
    name: str
    is_system: bool
    is_active: bool
    permissions: list[str]


class OwnerCreate(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    email: str | None = Field(
        default=None,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
        max_length=255,
    )
    display_name: str = Field(min_length=1, max_length=160)
    temporary_password: str = Field(min_length=10, max_length=256)


class BusinessCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=100)
    business_type: str = Field(default="RESTAURANT", max_length=50)
    first_branch: BranchCreate
    owner: OwnerCreate
    subscription_plan_code: str = "TRIAL"


class BusinessUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    state: TenantState | None = None
    is_active: bool | None = None
    default_currency: str | None = Field(
        default=None,
        min_length=3,
        max_length=3,
        pattern=r"^[A-Z]{3}$",
    )
    prevent_negative_stock: bool | None = None


class BusinessReactivateRequest(BaseModel):
    extend_days: int = Field(default=30, ge=1, le=365)
    note: str | None = Field(default=None, max_length=500)


class TenantOut(ORMModel):
    id: UUID
    name: str
    slug: str
    business_type: str
    state: TenantState
    is_active: bool
    default_currency: str
    prevent_negative_stock: bool
    created_at: datetime


class BusinessOverviewOut(BaseModel):
    """Everything platform support needs about one business on a single screen."""

    id: UUID
    name: str
    slug: str
    business_type: str
    state: TenantState
    is_active: bool
    created_at: datetime

    owner_name: str | None
    owner_email: str | None
    owner_phone: str | None

    active_branches: int
    total_branches: int
    user_count: int

    plan_name: str | None
    currency: str
    monthly_total: Decimal
    base_monthly_price: Decimal
    included_branches: int
    additional_branch_price: Decimal
    billable_extra_branches: int
    # Trial end or next renewal, whichever applies to the current state.
    next_payment_at: datetime | None
    trial_ends_at: datetime | None


class SubscriptionPlanCreate(BaseModel):
    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{2,59}$")
    name: str = Field(min_length=1, max_length=120)
    monthly_price: Decimal = Field(default=Decimal("0.00"), ge=0)
    currency: str = Field(default="TRY", min_length=3, max_length=3)
    max_branches: int | None = Field(default=None, ge=1)
    max_users: int | None = Field(default=None, ge=1)
    features: dict[str, bool] = {}


class SubscriptionPlanOut(ORMModel):
    id: UUID
    code: str
    name: str
    monthly_price: Decimal
    currency: str
    max_branches: int | None
    max_users: int | None
    is_active: bool


class SubscriptionAssign(BaseModel):
    tenant_id: UUID
    plan_id: UUID
    status: TenantState = TenantState.ACTIVE
    starts_at: datetime
    ends_at: datetime | None = None


class SubscriptionOut(ORMModel):
    id: UUID
    tenant_id: UUID
    plan_id: UUID
    status: TenantState
    starts_at: datetime
    ends_at: datetime | None


class PlatformSubscriptionOut(BaseModel):
    business: TenantOut
    plan: SubscriptionPlanOut
    status: TenantState
    starts_at: datetime
    ends_at: datetime | None


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    color: str = Field(default="#EC5A20", pattern=r"^#[0-9A-Fa-f]{6}$")
    parent_id: UUID | None = None
    branch_id: UUID | None = None
    sort_order: int = 0
    is_active: bool = True
    translations: dict[str, dict[str, str]] = {}


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    sort_order: int | None = None
    is_active: bool | None = None
    translations: dict[str, dict[str, str]] | None = None


class CategoryOut(ORMModel):
    id: UUID
    tenant_id: UUID
    branch_id: UUID | None
    parent_id: UUID | None
    name: str
    description: str | None
    color: str
    sort_order: int
    is_active: bool
    translations: dict[str, dict[str, str]] = {}


class StationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=1, max_length=50)
    branch_id: UUID | None = None
    sort_order: int = 0


class StationOut(ORMModel):
    id: UUID
    tenant_id: UUID
    branch_id: UUID
    name: str
    code: str
    is_active: bool
    sort_order: int


class ProductCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_id: UUID
    preparation_station_id: UUID | None = None
    name: str = Field(min_length=1, max_length=160)
    internal_name: str | None = Field(default=None, max_length=160)
    description: str | None = None
    sku: str | None = Field(default=None, max_length=80)
    selling_price: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    cost_price: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=14, decimal_places=2)
    tax_rate: Decimal = Field(default=Decimal("0.00"), ge=0, le=100)
    is_active: bool = True
    is_available: bool = True
    qr_visible: bool = True
    waiter_visible: bool = True
    preparation_minutes: int | None = Field(default=None, ge=0, le=1440)
    track_inventory: bool = False
    sort_order: int = 0
    allergens: list[str] = []
    calories: int | None = Field(default=None, ge=0, le=20000)
    tags: list[str] = []
    translations: dict[str, dict[str, str]] = {}
    modifier_group_ids: list[UUID] = []

    @field_validator("sku")
    @classmethod
    def _blank_sku_to_none(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class ProductUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=160)
    internal_name: str | None = Field(default=None, max_length=160)
    description: str | None = None
    sku: str | None = Field(default=None, max_length=80)
    category_id: UUID | None = None
    preparation_station_id: UUID | None = None
    preparation_minutes: int | None = Field(default=None, ge=0, le=1440)
    selling_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    cost_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    tax_rate: Decimal | None = Field(default=None, ge=0, le=100)
    is_active: bool | None = None
    is_available: bool | None = None
    qr_visible: bool | None = None
    waiter_visible: bool | None = None
    track_inventory: bool | None = None
    sort_order: int | None = None
    allergens: list[str] | None = None
    calories: int | None = Field(default=None, ge=0, le=20000)
    tags: list[str] | None = None
    translations: dict[str, dict[str, str]] | None = None
    modifier_group_ids: list[UUID] | None = None

    @field_validator("sku")
    @classmethod
    def _blank_sku_to_none(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class ProductCsvPreviewRow(BaseModel):
    row_number: int
    category: str
    name: str
    selling_price: Decimal
    sku: str | None = None


class ProductCsvImportError(BaseModel):
    row_number: int
    field: str | None = None
    message: str


class ProductCsvImportResult(BaseModel):
    status: Literal["READY", "SUCCESS", "PARTIAL", "FAILED"]
    dry_run: bool
    total_rows: int
    valid_rows: int
    imported_rows: int
    failed_rows: int
    rows: list[ProductCsvPreviewRow] = []
    errors: list[ProductCsvImportError] = []


class ProductOut(ORMModel):
    id: UUID
    tenant_id: UUID
    category_id: UUID
    preparation_station_id: UUID | None
    name: str
    internal_name: str | None
    description: str | None
    sku: str | None
    selling_price: Decimal
    cost_price: Decimal
    tax_rate: Decimal
    image_url: str | None
    is_active: bool
    is_available: bool
    qr_visible: bool
    waiter_visible: bool
    preparation_minutes: int | None
    track_inventory: bool
    sort_order: int
    allergens: list[str]
    calories: int | None
    tags: list[str]
    translations: dict[str, dict[str, str]] = {}


class ModifierGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    is_required: bool = False
    minimum_selection: int = Field(default=0, ge=0)
    maximum_selection: int | None = Field(default=None, ge=1)
    product_ids: list[UUID] = []

    @field_validator("maximum_selection")
    @classmethod
    def maximum_is_valid(cls, value: int | None, info: Any) -> int | None:
        minimum = info.data.get("minimum_selection", 0)
        if value is not None and value < minimum:
            raise ValueError("maximum_selection must be >= minimum_selection")
        return value


class ModifierGroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_required: bool | None = None
    minimum_selection: int | None = Field(default=None, ge=0)
    maximum_selection: int | None = Field(default=None, ge=1)
    sort_order: int | None = None
    is_active: bool | None = None
    product_ids: list[UUID] | None = None

    @field_validator("maximum_selection")
    @classmethod
    def maximum_is_valid(cls, value: int | None, info: Any) -> int | None:
        minimum = info.data.get("minimum_selection")
        if value is not None and minimum is not None and value < minimum:
            raise ValueError("maximum_selection must be >= minimum_selection")
        return value


class ModifierCreate(BaseModel):
    group_id: UUID
    name: str = Field(min_length=1, max_length=120)
    price_delta: Decimal = Field(default=Decimal("0.00"), decimal_places=2)
    sort_order: int = 0


class ModifierUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    price_delta: Decimal | None = Field(default=None, decimal_places=2)
    sort_order: int | None = None
    is_active: bool | None = None


class ModifierOut(ORMModel):
    id: UUID
    tenant_id: UUID
    group_id: UUID
    name: str
    price_delta: Decimal
    is_active: bool
    sort_order: int


class ModifierGroupOut(ORMModel):
    id: UUID
    tenant_id: UUID
    name: str
    is_required: bool
    minimum_selection: int
    maximum_selection: int | None
    sort_order: int
    is_active: bool
    modifiers: list[ModifierOut] = []
    product_ids: list[UUID] = []


class ProductDetailOut(ProductOut):
    modifier_groups: list[ModifierGroupOut] = []


class AreaCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    branch_id: UUID | None = None
    sort_order: int = 0


class AreaUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    sort_order: int | None = None
    is_active: bool | None = None


class AreaOut(ORMModel):
    id: UUID
    tenant_id: UUID
    branch_id: UUID
    name: str
    sort_order: int
    is_active: bool


class TableCreate(BaseModel):
    area_id: UUID
    name: str = Field(min_length=1, max_length=60)
    capacity: int = Field(default=4, gt=0, le=100)
    is_active: bool = True
    sort_order: int = 0
    shape: str | None = None
    visual_position: dict[str, object] | None = None


class TableUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    # Empty string clears the label; None leaves it untouched.
    guest_label: str | None = Field(default=None, max_length=60)
    area_id: UUID | None = None
    capacity: int | None = Field(default=None, gt=0, le=100)
    sort_order: int | None = None
    is_active: bool | None = None
    state: TableState | None = None
    visual_position: dict[str, object] | None = None


class TableOut(ORMModel):
    id: UUID
    tenant_id: UUID
    branch_id: UUID
    area_id: UUID
    name: str
    guest_label: str | None = None
    capacity: int
    sort_order: int
    is_active: bool
    qr_token: str
    state: TableState
    version: int


class TableGuestLabelUpdate(BaseModel):
    """Blank or null clears the label."""

    guest_label: str | None = Field(default=None, max_length=60)


class TableSessionCloseRequest(BaseModel):
    expected_table_version: int = Field(ge=1)


class TableSessionCloseOut(BaseModel):
    table: TableOut
    session_id: UUID
    already_closed: bool
    closed_at: datetime | None


class OrderModifierInput(BaseModel):
    modifier_id: UUID
    quantity: int = Field(default=1, ge=1, le=20)


class OrderItemInput(BaseModel):
    product_id: UUID
    quantity: Decimal = Field(default=Decimal("1.00"), gt=0, max_digits=10, decimal_places=2)
    note: str | None = Field(default=None, max_length=1000)
    modifiers: list[OrderModifierInput] = []


class OrderCreate(BaseModel):
    table_id: UUID | None = None
    source: OrderSource = OrderSource.WAITER
    customer_name: str | None = Field(default=None, max_length=120)
    items: list[OrderItemInput] = Field(min_length=1)
    idempotency_key: str = Field(min_length=8, max_length=160)
    auto_accept: bool = True


class OrderItemsAppend(BaseModel):
    items: list[OrderItemInput] = Field(min_length=1)
    idempotency_key: str = Field(min_length=8, max_length=160)


class OrderItemModifierOut(ORMModel):
    id: UUID
    modifier_id: UUID | None
    name_snapshot: str
    price_delta_snapshot: Decimal
    quantity: int


class OrderItemOut(ORMModel):
    id: UUID
    product_id: UUID
    product_name_snapshot: str
    unit_price: Decimal
    quantity: Decimal
    tax_rate_snapshot: Decimal
    discount_snapshot: Decimal
    line_total: Decimal
    status: OrderItemStatus
    note: str | None
    modifiers: list[OrderItemModifierOut] = []


class PaymentOut(ORMModel):
    id: UUID
    method: str
    amount: Decimal
    status: str
    reference: str | None


class OrderOut(ORMModel):
    id: UUID
    tenant_id: UUID
    branch_id: UUID
    table_session_id: UUID | None
    table_id: UUID | None = None
    table_name: str | None = None
    source: OrderSource
    status: OrderStatus
    customer_name: str | None
    currency: str
    subtotal: Decimal
    discount_total: Decimal
    tax_total: Decimal
    total: Decimal
    version: int
    created_at: datetime
    items: list[OrderItemOut] = []
    payments: list[PaymentOut] = []


class PaymentCreate(BaseModel):
    method: str = Field(pattern=r"^[A-Z][A-Z0-9_]{1,39}$")
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    idempotency_key: str = Field(min_length=8, max_length=160)
    reference: str | None = Field(default=None, max_length=160)


class TranslationFieldsIn(BaseModel):
    """One locale's version of a catalog entry, as typed by the business."""

    name: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class TranslationFieldsOut(BaseModel):
    name: str | None = None
    description: str | None = None
    # True when the Turkish source was edited after this translation was saved,
    # so the panel can nudge the owner to refresh it.
    stale: bool = False


class EntityTranslationsUpdate(BaseModel):
    translations: dict[str, TranslationFieldsIn]


class EntityTranslationsOut(BaseModel):
    entity_type: str
    entity_id: UUID
    source_locale: str
    supported_locales: list[str]
    source: TranslationFieldsOut
    translations: dict[str, TranslationFieldsOut]


class RoomFolioOrderOut(BaseModel):
    order_id: UUID
    reference: str
    table_name: str | None
    created_at: datetime
    items: list[OrderItemOut]
    order_total: Decimal
    room_charge_amount: Decimal


class RoomFolioOut(BaseModel):
    reference: str
    orders: list[RoomFolioOrderOut]
    total: Decimal


class HotelRoomCreate(BaseModel):
    room_number: str = Field(min_length=1, max_length=20)
    notes: str | None = Field(default=None, max_length=500)
    sort_order: int = 0


class HotelRoomUpdate(BaseModel):
    room_number: str | None = Field(default=None, min_length=1, max_length=20)
    notes: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None
    sort_order: int | None = None


class HotelRoomCheckIn(BaseModel):
    guest_name: str = Field(min_length=1, max_length=160)
    expected_version: int = Field(ge=1)


class HotelRoomCheckOut(BaseModel):
    payment_method: str = Field(pattern=r"^[A-Z][A-Z0-9_]{1,39}$")
    expected_version: int = Field(ge=1)


class HotelRoomOut(ORMModel):
    id: UUID
    room_number: str
    status: HotelRoomStatus
    guest_name: str | None
    checked_in_at: datetime | None
    notes: str | None
    is_active: bool
    sort_order: int
    version: int
    folio_reference: str | None


class HotelRoomCheckoutOut(ORMModel):
    id: UUID
    room_id: UUID
    room_number: str
    guest_name: str
    total_amount: Decimal
    payment_method: str
    checked_in_at: datetime | None
    checked_out_at: datetime
    created_at: datetime


class TableTransferRequest(BaseModel):
    destination_table_id: UUID
    reason: str = Field(min_length=3, max_length=255)


class TableMergeRequest(BaseModel):
    destination_table_id: UUID
    idempotency_key: str = Field(min_length=8, max_length=160)
    reason: str = Field(min_length=3, max_length=255)


class ItemCheckSplitRequest(BaseModel):
    item_ids: list[UUID] = Field(min_length=1)
    idempotency_key: str = Field(min_length=8, max_length=160)


class AmountCheckSplitRequest(BaseModel):
    parts: list[Decimal] = Field(min_length=2)
    idempotency_key: str = Field(min_length=8, max_length=160)

    @field_validator("parts")
    @classmethod
    def positive_parts(cls, values: list[Decimal]) -> list[Decimal]:
        if any(value <= 0 for value in values):
            raise ValueError("Every split amount must be positive")
        return values


class AmountCheckSplitOut(BaseModel):
    order_id: UUID
    parts: list[Decimal]
    total: Decimal
    idempotency_key: str


class CancellationRequestCreate(BaseModel):
    order_item_id: UUID | None = None
    reason: str = Field(min_length=3, max_length=255)


class DiscountRequestCreate(BaseModel):
    kind: DiscountKind
    value: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    order_item_id: UUID | None = None
    reason: str = Field(min_length=3, max_length=255)


class ApprovalOut(ORMModel):
    id: UUID
    order_id: UUID | None
    order_item_id: UUID | None
    approval_type: ApprovalType
    status: ApprovalStatus
    payload: dict[str, object]
    reason: str
    requested_by_user_id: UUID
    resolved_by_user_id: UUID | None
    created_at: datetime


class ApprovalRequestAdminOut(BaseModel):
    id: UUID
    order_id: UUID | None
    order_item_id: UUID | None
    approval_type: ApprovalType
    status: ApprovalStatus
    payload: dict[str, object]
    reason: str
    created_at: datetime
    resolved_at: datetime | None
    requested_by_user_id: UUID
    requested_by_name: str | None
    resolved_by_user_id: UUID | None
    resolved_by_name: str | None
    table_name: str | None
    order_item_name: str | None
    order_total: Decimal | None


class ApprovalPendingCountOut(BaseModel):
    pending: int


class InventoryItemCreate(BaseModel):
    branch_id: UUID | None = None
    name: str = Field(min_length=1, max_length=160)
    sku: str | None = Field(default=None, max_length=80)
    unit: str = Field(pattern=r"^(piece|gram|kilogram|milliliter|liter)$")
    minimum_stock: Decimal = Field(default=Decimal("0"), ge=0)
    opening_quantity: Decimal = Field(default=Decimal("0"), ge=0)


class InventoryItemOut(ORMModel):
    id: UUID
    tenant_id: UUID
    branch_id: UUID
    name: str
    sku: str | None
    unit: str
    minimum_stock: Decimal
    average_cost: Decimal
    is_active: bool
    current_stock: Decimal | None = None


class RecipeItemInput(BaseModel):
    inventory_item_id: UUID
    quantity: Decimal = Field(gt=0, max_digits=18, decimal_places=6)


class RecipeCreate(BaseModel):
    branch_id: UUID | None = None
    product_id: UUID
    yield_quantity: Decimal = Field(default=Decimal("1"), gt=0)
    items: list[RecipeItemInput] = Field(min_length=1)


class RecipeIngredientOut(BaseModel):
    inventory_item_id: UUID
    name: str
    unit: str
    quantity: Decimal


class RecipeOut(BaseModel):
    id: UUID
    product_id: UUID
    product_name: str
    yield_quantity: Decimal
    ingredients: list[RecipeIngredientOut]


class StockMovementCreate(BaseModel):
    branch_id: UUID | None = None
    inventory_item_id: UUID
    type: StockMovementType
    quantity_delta: Decimal = Field(max_digits=18, decimal_places=6)
    reason: str = Field(min_length=3, max_length=1000)
    idempotency_key: str = Field(min_length=8, max_length=160)

    @field_validator("quantity_delta")
    @classmethod
    def nonzero_quantity(cls, value: Decimal) -> Decimal:
        if value == 0:
            raise ValueError("Quantity delta must not be zero")
        return value


class StockMovementOut(BaseModel):
    id: UUID
    inventory_item_id: UUID
    item_name: str
    type: StockMovementType
    quantity_delta: Decimal
    balance_after: Decimal
    reason: str | None
    actor_user_id: UUID | None
    created_at: datetime


class QrConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    menu_name: str | None = Field(default=None, min_length=1, max_length=160)
    is_enabled: bool | None = None
    order_mode: QrOrderMode | None = None
    primary_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    language: str | None = Field(default=None, max_length=12)
    customer_notes_enabled: bool | None = None
    allergens_visible: bool | None = None


class QrConfigOut(ORMModel):
    id: UUID
    tenant_id: UUID
    branch_id: UUID
    menu_name: str
    is_enabled: bool
    order_mode: QrOrderMode
    logo_url: str | None
    cover_image_url: str | None
    primary_color: str
    language: str
    currency: str
    customer_notes_enabled: bool
    allergens_visible: bool


class PublicQrConfigOut(BaseModel):
    menu_name: str
    order_mode: QrOrderMode
    logo_url: str | None
    cover_image_url: str | None
    primary_color: str
    language: str
    currency: str
    customer_notes_enabled: bool
    allergens_visible: bool


class PublicMenuCategory(BaseModel):
    id: str = Field(pattern=r"^c_[A-Za-z0-9_-]{24}$", max_length=26)
    name: str
    description: str | None
    color: str
    sort_order: int


class PublicMenuModifier(BaseModel):
    id: str = Field(pattern=r"^m_[A-Za-z0-9_-]{24}$", max_length=26)
    name: str
    price_delta: Decimal


class PublicMenuModifierGroup(BaseModel):
    id: str = Field(pattern=r"^g_[A-Za-z0-9_-]{24}$", max_length=26)
    name: str
    is_required: bool
    minimum_selection: int
    maximum_selection: int | None
    modifiers: list[PublicMenuModifier] = []


class PublicMenuProduct(BaseModel):
    id: str = Field(pattern=r"^p_[A-Za-z0-9_-]{24}$", max_length=26)
    category_id: str = Field(pattern=r"^c_[A-Za-z0-9_-]{24}$", max_length=26)
    name: str
    description: str | None
    selling_price: Decimal
    image_url: str | None
    allergens: list[str]
    calories: int | None = None
    modifier_groups: list[PublicMenuModifierGroup] = []


class PublicBranchOut(BaseModel):
    name: str
    slug: str


class PublicMenuOut(BaseModel):
    business: str
    branch: str
    context_key: str
    table_name: str | None
    config: PublicQrConfigOut
    categories: list[PublicMenuCategory]
    products: list[PublicMenuProduct]
    session_token: str | None = None


class PublicQrOrderModifierInput(BaseModel):
    modifier_id: str = Field(min_length=3, max_length=64)
    quantity: int = Field(default=1, ge=1, le=20)


class PublicQrOrderItemInput(BaseModel):
    product_id: str = Field(min_length=3, max_length=64)
    quantity: Decimal = Field(default=Decimal("1.00"), gt=0, max_digits=10, decimal_places=2)
    note: str | None = Field(default=None, max_length=1000)
    modifiers: list[PublicQrOrderModifierInput] = []


class QrRequestCreate(BaseModel):
    table_token: str = Field(min_length=16, max_length=64)
    session_token: str
    idempotency_key: str = Field(min_length=8, max_length=160)
    items: list[PublicQrOrderItemInput] = Field(min_length=1)
    customer_note: str | None = Field(default=None, max_length=1000)


class QrRequestOut(ORMModel):
    id: UUID
    tenant_id: UUID
    branch_id: UUID
    table_id: UUID
    order_id: UUID | None
    status: QrRequestStatus
    items_payload: list[dict[str, object]]
    customer_note: str | None
    expires_at: datetime
    created_at: datetime


class PublicQrRequestOut(BaseModel):
    reference: str = Field(pattern=r"^r_[A-Za-z0-9_-]{24}$", max_length=26)
    status: QrRequestStatus
    expires_at: datetime
    created_at: datetime


class KitchenTicketItemOut(BaseModel):
    id: UUID
    order_item_id: UUID
    name: str
    quantity: Decimal
    note: str | None
    modifiers: list[str]
    status: OrderItemStatus


class KitchenTicketOut(BaseModel):
    id: UUID
    tenant_id: UUID
    branch_id: UUID
    order_id: UUID
    preparation_station_id: UUID
    station_name: str
    table_name: str | None
    waiter_name: str | None
    order_source: OrderSource
    batch_number: int
    status: KitchenTicketStatus
    created_at: datetime
    items: list[KitchenTicketItemOut]


class KitchenStatusUpdate(BaseModel):
    status: KitchenTicketStatus


class PrintJobCreate(BaseModel):
    preparation_station_id: UUID | None = None
    printer_device_id: UUID | None = None
    order_id: UUID | None = None
    kitchen_ticket_id: UUID | None = None
    payload: dict[str, object]
    kind: PrintJobKind = PrintJobKind.ORIGINAL
    idempotency_key: str = Field(min_length=8, max_length=160)


class PrintJobOut(ORMModel):
    id: UUID
    tenant_id: UUID
    branch_id: UUID
    preparation_station_id: UUID | None
    printer_device_id: UUID | None
    claimed_by_bridge_id: UUID | None
    order_id: UUID | None
    kitchen_ticket_id: UUID | None
    payload: dict[str, object]
    status: PrintJobStatus
    kind: PrintJobKind
    attempt_count: int
    last_error: str | None
    claimed_at: datetime | None
    sent_at: datetime | None
    printed_at: datetime | None
    created_at: datetime


class PrintJobClaimOut(PrintJobOut):
    """Bridge-facing job payload with the configured, non-database printer code."""

    printer_code: str


class PrintBridgeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    branch_id: UUID | None = None


class PrintBridgeCreated(BaseModel):
    id: UUID
    tenant_id: UUID
    branch_id: UUID
    name: str
    token: str
    warning: str = "Store this token securely; it will not be shown again."


class BridgeStatusUpdate(BaseModel):
    status: PrintJobStatus
    error: str | None = Field(default=None, max_length=2000)


class PrinterDeviceCreate(BaseModel):
    branch_id: UUID | None = None
    code: str = Field(pattern=r"^[A-Z][A-Z0-9_-]{1,79}$")
    name: str = Field(min_length=1, max_length=120)
    preparation_station_id: UUID | None = None
    transport: str = Field(default="MOCK", max_length=40)
    settings: dict[str, object] = {}


class PrinterDeviceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    preparation_station_id: UUID | None = None
    transport: str | None = Field(default=None, max_length=40)
    is_active: bool | None = None
    settings: dict[str, object] | None = None


class PrinterDeviceOut(ORMModel):
    id: UUID
    tenant_id: UUID
    branch_id: UUID
    preparation_station_id: UUID | None
    code: str
    name: str
    transport: str
    is_active: bool
    last_seen_at: datetime | None
    settings: dict[str, object]


class ShiftOpen(BaseModel):
    cashier_name: str = Field(min_length=2, max_length=120)
    opening_cash: Decimal = Field(default=Decimal("0.00"), ge=0)
    note: str | None = Field(default=None, max_length=500)


class ShiftClose(BaseModel):
    closing_cash: Decimal = Field(ge=0)
    note: str | None = Field(default=None, max_length=500)


class ShiftHandoff(BaseModel):
    counted_cash: Decimal = Field(ge=0)
    next_cashier_name: str = Field(min_length=2, max_length=120)
    next_opening_cash: Decimal | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=500)


class ShiftOut(ORMModel):
    id: UUID
    tenant_id: UUID
    branch_id: UUID
    user_id: UUID
    user_display_name: str | None = None
    cashier_name: str | None
    predecessor_shift_id: UUID | None
    status: str
    opening_cash: Decimal
    opening_note: str | None
    closing_cash: Decimal | None
    cash_sales: Decimal
    card_sales: Decimal
    total_sales: Decimal
    cash_variance: Decimal | None
    opened_at: datetime
    closed_at: datetime | None
    closing_note: str | None


class ShiftHandoffOut(BaseModel):
    closed: ShiftOut
    opened: ShiftOut


class DashboardHourlySaleOut(BaseModel):
    hour: str
    revenue: Decimal
    orders: int


class DashboardTopProductOut(BaseModel):
    product_id: UUID
    name: str
    quantity: Decimal
    revenue: Decimal


class DashboardLowStockOut(BaseModel):
    item_id: UUID
    name: str
    unit: str
    current_stock: Decimal
    minimum_stock: Decimal


class DashboardOut(BaseModel):
    open_tables: int
    total_tables: int
    active_orders: int
    waiting_preparation: int
    ready_orders: int
    sales_today: Decimal
    paid_orders_today: int
    average_order_value: Decimal
    low_stock_items: int
    cancelled_items_today: int
    discounts_today: Decimal
    current_shift_status: Literal["OPEN", "CLOSED"]
    printer_warnings: int
    station_warnings: int
    hourly_sales: list[DashboardHourlySaleOut]
    top_products: list[DashboardTopProductOut]
    low_stock_products: list[DashboardLowStockOut]


class SalesSummaryOut(BaseModel):
    gross_sales: Decimal
    paid_orders: int
    average_order_value: Decimal
    by_payment_method: dict[str, Decimal]


class SalesAnalyticsTimeBucketOut(BaseModel):
    bucket: datetime
    gross_sales: Decimal
    paid_orders: int
    discount_total: Decimal


class SalesAnalyticsProductBreakdownOut(BaseModel):
    product_id: UUID
    product_name: str
    quantity: Decimal
    gross_sales: Decimal
    order_count: int


class SalesAnalyticsCategoryBreakdownOut(BaseModel):
    category_id: UUID
    category_name: str
    quantity: Decimal
    gross_sales: Decimal
    order_count: int


class SalesAnalyticsOrderSourceBreakdownOut(BaseModel):
    source: OrderSource
    gross_sales: Decimal
    order_count: int


class SalesAnalyticsOut(BaseModel):
    date_from: datetime
    date_to: datetime
    granularity: Literal["day", "hour"]
    gross_sales: Decimal
    paid_orders: int
    average_order_value: Decimal
    total_discount: Decimal
    cancelled_items: int
    voided_items: int
    average_preparation_minutes: Decimal | None
    timeseries: list[SalesAnalyticsTimeBucketOut]
    by_product: list[SalesAnalyticsProductBreakdownOut]
    by_category: list[SalesAnalyticsCategoryBreakdownOut]
    by_order_source: list[SalesAnalyticsOrderSourceBreakdownOut]


class DeliveryOrderCreate(BaseModel):
    """A delivery/takeaway order the restaurant enters itself (phone, counter)."""

    channel: Literal["PHONE", "TAKEAWAY", "OWN_DELIVERY"]
    items: list[OrderItemInput] = Field(min_length=1)
    idempotency_key: str = Field(min_length=8, max_length=160)
    customer_name: str | None = Field(default=None, max_length=160)
    customer_phone: str | None = Field(
        default=None, pattern=r"^[0-9+()\s.-]{7,32}$", max_length=32
    )
    address_line: str | None = Field(default=None, max_length=500)
    district: str | None = Field(default=None, max_length=120)
    neighbourhood: str | None = Field(default=None, max_length=120)
    address_note: str | None = Field(default=None, max_length=500)
    customer_note: str | None = Field(default=None, max_length=500)
    payment_method: Literal[
        "ONLINE", "CASH_ON_DELIVERY", "CARD_ON_DELIVERY", "MEAL_CARD", "OTHER"
    ] = "CASH_ON_DELIVERY"
    payment_status: Literal[
        "UNPAID", "PAID", "PROVIDER_COLLECTED", "REFUNDED", "PARTIALLY_REFUNDED"
    ] = "UNPAID"
    auto_accept: bool = True

    @model_validator(mode="after")
    def delivery_needs_an_address(self) -> DeliveryOrderCreate:
        # Must be a model validator: a field validator never fires when the
        # field is simply absent, so an address-less delivery slipped through.
        if self.channel == "OWN_DELIVERY" and not (self.address_line or "").strip():
            raise ValueError("Paket servis siparişi için adres gerekli")
        return self


class DeliveryAcceptRequest(BaseModel):
    promised_minutes: int | None = Field(default=None, ge=1, le=240)


class DeliveryRejectRequest(BaseModel):
    reason: str = Field(min_length=2, max_length=255)


class DeliveryStatusUpdate(BaseModel):
    status: Literal["PREPARING", "READY", "DISPATCHED", "DELIVERED", "CANCELLED"]
    reason: str | None = Field(default=None, max_length=255)


class DeliveryCourierAssign(BaseModel):
    courier_user_id: UUID | None = None
    courier_name: str | None = Field(default=None, max_length=160)


class DeliveryOrderItemOut(BaseModel):
    name: str
    quantity: Decimal
    unit_price: Decimal
    line_total: Decimal
    note: str | None
    modifiers: list[str]


class DeliveryOrderOut(BaseModel):
    id: UUID
    order_id: UUID
    branch_id: UUID
    channel: str
    provider: str | None
    delivery_status: str
    # Provider sync is reported separately from the local status on purpose: an
    # order can be accepted here while the provider call failed.
    sync_status: str
    sync_error: str | None
    external_display_id: str | None
    customer_name: str | None
    customer_phone: str | None
    address_line: str | None
    district: str | None
    neighbourhood: str | None
    address_note: str | None
    customer_note: str | None
    payment_method: str
    payment_status: str
    courier_name: str | None
    promised_minutes: int | None
    total: Decimal
    items: list[DeliveryOrderItemOut]
    created_at: datetime
    accepted_at: datetime | None
    ready_at: datetime | None
    dispatched_at: datetime | None
    delivered_at: datetime | None
    cancelled_at: datetime | None
    rejection_reason: str | None


class DeliveryInboxCounts(BaseModel):
    new: int
    accepted: int
    preparing: int
    ready: int
    dispatched: int
    delivered: int
    cancelled: int


class OrderActivityOut(BaseModel):
    """One line of the "who did what" feed in the admin order report."""

    order_id: UUID
    created_at: datetime
    branch_id: UUID
    status: str
    source: str
    table_name: str | None
    # Null for QR orders — nobody on staff entered them, which is the point.
    staff_name: str | None
    member_code: str | None
    delivery_channel: str | None
    customer_name: str | None
    total: Decimal
