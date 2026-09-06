from __future__ import annotations

from enum import StrEnum
from typing import TypeVar

from sqlalchemy import Enum as SAEnum

EnumT = TypeVar("EnumT", bound=StrEnum)


def enum_column(enum_type: type[EnumT], name: str) -> SAEnum:
    return SAEnum(
        enum_type,
        name=name,
        native_enum=False,
        create_constraint=True,
        validate_strings=True,
        values_callable=lambda items: [item.value for item in items],
    )


class TenantState(StrEnum):
    TRIAL = "TRIAL"
    ACTIVE = "ACTIVE"
    PAST_DUE = "PAST_DUE"
    SUSPENDED = "SUSPENDED"
    CANCELLED = "CANCELLED"
    ARCHIVED = "ARCHIVED"


class ThemeMode(StrEnum):
    """Which colour scheme a business pins for its guest and staff screens.

    SYSTEM keeps the historical behaviour — the device's `prefers-color-scheme`
    decides — and is therefore the default for every existing business.
    """

    LIGHT = "LIGHT"
    DARK = "DARK"
    SYSTEM = "SYSTEM"


class TableState(StrEnum):
    AVAILABLE = "AVAILABLE"
    OCCUPIED = "OCCUPIED"
    ORDER_PENDING = "ORDER_PENDING"
    PREPARING = "PREPARING"
    READY = "READY"
    BILL_REQUESTED = "BILL_REQUESTED"
    PAYMENT_PENDING = "PAYMENT_PENDING"
    CLEANING = "CLEANING"
    DISABLED = "DISABLED"


class HotelRoomStatus(StrEnum):
    VACANT = "VACANT"
    OCCUPIED = "OCCUPIED"


class TableSessionStatus(StrEnum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"
    CANCELLED = "CANCELLED"


class OrderSource(StrEnum):
    WAITER = "WAITER"
    CASHIER = "CASHIER"
    QR = "QR"
    TAKEAWAY = "TAKEAWAY"
    DELIVERY = "DELIVERY"
    KIOSK = "KIOSK"
    API = "API"


class OrderStatus(StrEnum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    ACCEPTED = "ACCEPTED"
    PREPARING = "PREPARING"
    PARTIALLY_READY = "PARTIALLY_READY"
    READY = "READY"
    SERVED = "SERVED"
    BILL_REQUESTED = "BILL_REQUESTED"
    PAYMENT_PENDING = "PAYMENT_PENDING"
    PAID = "PAID"
    CANCELLED = "CANCELLED"
    VOIDED = "VOIDED"


class OrderItemStatus(StrEnum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    ACCEPTED = "ACCEPTED"
    PREPARING = "PREPARING"
    READY = "READY"
    SERVED = "SERVED"
    CANCELLED = "CANCELLED"
    VOIDED = "VOIDED"


class KitchenTicketStatus(StrEnum):
    NEW = "NEW"
    ACCEPTED = "ACCEPTED"
    PREPARING = "PREPARING"
    READY = "READY"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class PaymentStatus(StrEnum):
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"
    REFUNDED = "REFUNDED"
    VOIDED = "VOIDED"


class ApprovalStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class ApprovalType(StrEnum):
    DISCOUNT = "DISCOUNT"
    ITEM_CANCELLATION = "ITEM_CANCELLATION"
    ORDER_VOID = "ORDER_VOID"
    STOCK_OVERRIDE = "STOCK_OVERRIDE"
    TABLE_TRANSFER = "TABLE_TRANSFER"


class StockMovementType(StrEnum):
    PURCHASE = "PURCHASE"
    SALE = "SALE"
    WASTE = "WASTE"
    ADJUSTMENT = "ADJUSTMENT"
    TRANSFER_IN = "TRANSFER_IN"
    TRANSFER_OUT = "TRANSFER_OUT"
    RETURN = "RETURN"
    COUNT_CORRECTION = "COUNT_CORRECTION"


class QrOrderMode(StrEnum):
    MENU_ONLY = "MENU_ONLY"
    WAITER_APPROVAL = "WAITER_APPROVAL"
    AUTOMATIC_ACCEPTANCE = "AUTOMATIC_ACCEPTANCE"
    DISABLED = "DISABLED"


class QrRequestStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class PrintJobStatus(StrEnum):
    PENDING = "PENDING"
    CLAIMED = "CLAIMED"
    SENT = "SENT"
    PRINTED = "PRINTED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class PrintJobKind(StrEnum):
    ORIGINAL = "ORIGINAL"
    COPY = "COPY"
    REPRINT = "REPRINT"


class DiscountKind(StrEnum):
    PERCENTAGE = "PERCENTAGE"
    FIXED = "FIXED"


class LoyaltyCampaignType(StrEnum):
    VISIT_COUNT = "VISIT_COUNT"
    PRODUCT_QUANTITY = "PRODUCT_QUANTITY"


class LoyaltyLedgerEntryType(StrEnum):
    ACCRUAL = "ACCRUAL"
    REVERSAL = "REVERSAL"


class LoyaltyRewardStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    REDEEMED = "REDEEMED"
    REVERSED = "REVERSED"


class LoyaltyRedemptionStatus(StrEnum):
    APPLIED = "APPLIED"
    REVERSED = "REVERSED"


class DeliveryChannel(StrEnum):
    """Where a delivery/takeaway order came from.

    Separate from `OrderSource`, which records the internal entry point
    (waiter, cashier, QR). A phone order is entered by a CASHIER *and* belongs
    to the PHONE channel; conflating the two would lose one of them.
    """

    PHONE = "PHONE"
    TAKEAWAY = "TAKEAWAY"
    OWN_DELIVERY = "OWN_DELIVERY"
    MARKETPLACE = "MARKETPLACE"


class MarketplaceProvider(StrEnum):
    GETIR = "GETIR"
    YEMEKSEPETI = "YEMEKSEPETI"
    TRENDYOL = "TRENDYOL"
    MIGROS = "MIGROS"
    OTHER = "OTHER"


class DeliveryStatus(StrEnum):
    """Fulfilment state of a delivery order, alongside the order's own status.

    Kept distinct from OrderStatus because "kitchen finished cooking" and
    "courier handed it over" are different facts that staff act on separately.
    """

    NEW = "NEW"
    ACCEPTED = "ACCEPTED"
    PREPARING = "PREPARING"
    READY = "READY"
    DISPATCHED = "DISPATCHED"
    DELIVERED = "DELIVERED"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"


class DeliveryPaymentMethod(StrEnum):
    ONLINE = "ONLINE"
    CASH_ON_DELIVERY = "CASH_ON_DELIVERY"
    CARD_ON_DELIVERY = "CARD_ON_DELIVERY"
    MEAL_CARD = "MEAL_CARD"
    OTHER = "OTHER"


class DeliveryPaymentStatus(StrEnum):
    UNPAID = "UNPAID"
    PAID = "PAID"
    PROVIDER_COLLECTED = "PROVIDER_COLLECTED"
    REFUNDED = "REFUNDED"
    PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED"


class ProviderSyncStatus(StrEnum):
    """Whether the external provider knows about our local decision.

    Never conflated with the local status: an order can be accepted in Dixora
    while the provider call failed, and staff must be able to see that.
    """

    NOT_APPLICABLE = "NOT_APPLICABLE"
    PENDING = "PENDING"
    SYNCED = "SYNCED"
    FAILED = "FAILED"


class CampaignRewardKind(StrEnum):
    """What a campaign gives away once its condition is met."""

    FREE_ITEM = "FREE_ITEM"
    PERCENT = "PERCENT"
    AMOUNT = "AMOUNT"


class CampaignAudience(StrEnum):
    """Who a campaign is for.

    Kept separate from the loyalty programme: a campaign can be a plain public
    offer that needs no membership at all.
    """

    EVERYONE = "EVERYONE"
    MEMBERS_ONLY = "MEMBERS_ONLY"
