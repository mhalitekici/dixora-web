from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    JSON,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import MONEY, Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import (
    DeliveryChannel,
    DeliveryPaymentMethod,
    DeliveryPaymentStatus,
    DeliveryStatus,
    MarketplaceProvider,
    ProviderSyncStatus,
    enum_column,
)


class DeliveryOrder(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Delivery/takeaway facts attached to an existing Order.

    Deliberately a companion table rather than fifteen nullable columns on
    `orders`: dine-in orders vastly outnumber delivery ones and should not carry
    address and courier fields they never use. The two columns the operational
    inbox filters on (channel, provider) are duplicated onto the order itself
    so the hot query needs no join.
    """

    __tablename__ = "delivery_orders"
    __table_args__ = (
        UniqueConstraint("order_id", name="uq_delivery_order_order"),
        # The idempotency guarantee for marketplace ingestion: the same webhook
        # delivered twice can never create a second order.
        UniqueConstraint(
            "tenant_id",
            "provider",
            "external_order_id",
            name="uq_delivery_order_external",
        ),
        Index(
            "ix_delivery_orders_inbox",
            "tenant_id",
            "branch_id",
            "delivery_status",
            "created_at",
        ),
        Index("ix_delivery_orders_channel", "tenant_id", "branch_id", "channel"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    order_id: Mapped[UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    channel: Mapped[DeliveryChannel] = mapped_column(
        enum_column(DeliveryChannel, "delivery_channel"), nullable=False
    )
    provider: Mapped[MarketplaceProvider | None] = mapped_column(
        enum_column(MarketplaceProvider, "marketplace_provider"), nullable=True
    )
    delivery_status: Mapped[DeliveryStatus] = mapped_column(
        enum_column(DeliveryStatus, "delivery_status"),
        default=DeliveryStatus.NEW,
        nullable=False,
        index=True,
    )

    # External identity. NULL for orders the restaurant entered itself.
    external_order_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    external_display_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    external_status: Mapped[str | None] = mapped_column(String(60), nullable=True)
    external_created_at: Mapped[datetime | None] = mapped_column(nullable=True)
    sync_status: Mapped[ProviderSyncStatus] = mapped_column(
        enum_column(ProviderSyncStatus, "provider_sync_status"),
        default=ProviderSyncStatus.NOT_APPLICABLE,
        nullable=False,
    )
    sync_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(nullable=True)

    customer_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    address_line: Mapped[str | None] = mapped_column(Text, nullable=True)
    district: Mapped[str | None] = mapped_column(String(120), nullable=True)
    neighbourhood: Mapped[str | None] = mapped_column(String(120), nullable=True)
    address_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    customer_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    payment_method: Mapped[DeliveryPaymentMethod] = mapped_column(
        enum_column(DeliveryPaymentMethod, "delivery_payment_method"),
        default=DeliveryPaymentMethod.CASH_ON_DELIVERY,
        nullable=False,
    )
    payment_status: Mapped[DeliveryPaymentStatus] = mapped_column(
        enum_column(DeliveryPaymentStatus, "delivery_payment_status"),
        default=DeliveryPaymentStatus.UNPAID,
        nullable=False,
    )

    # Commission/settlement figures stay NULL until a provider actually reports
    # them; inventing numbers here would corrupt the business's accounting.
    delivery_fee: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    provider_discount: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    restaurant_discount: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    provider_commission: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    net_expected_amount: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)

    courier_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    courier_name: Mapped[str | None] = mapped_column(String(160), nullable=True)

    promised_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(nullable=True)
    ready_at: Mapped[datetime | None] = mapped_column(nullable=True)
    dispatched_at: Mapped[datetime | None] = mapped_column(nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)


class MarketplaceIntegration(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Per-branch connection to one marketplace.

    Branch-scoped on purpose: a chain usually holds a separate store account per
    location, so one credential must never be assumed to cover every branch.
    Secrets are not stored here — `credential_ref` points at whatever secret
    store the deployment uses, so nothing sensitive is readable from this row.
    """

    __tablename__ = "marketplace_integrations"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "branch_id", "provider", name="uq_marketplace_integration_scope"
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[MarketplaceProvider] = mapped_column(
        enum_column(MarketplaceProvider, "marketplace_provider"), nullable=False
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    external_store_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    credential_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Non-sensitive settings only (auto-accept, print behaviour, ...).
    settings: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)
    last_sync_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_error_at: Mapped[datetime | None] = mapped_column(nullable=True)


class MarketplaceProductMapping(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Links a Dixora product to its counterpart in a provider's menu."""

    __tablename__ = "marketplace_product_mappings"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "branch_id",
            "provider",
            "product_id",
            name="uq_marketplace_mapping_product",
        ),
        UniqueConstraint(
            "tenant_id",
            "branch_id",
            "provider",
            "external_product_id",
            name="uq_marketplace_mapping_external",
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[MarketplaceProvider] = mapped_column(
        enum_column(MarketplaceProvider, "marketplace_provider"), nullable=False
    )
    product_id: Mapped[UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    external_product_id: Mapped[str] = mapped_column(String(120), nullable=False)
    external_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    sync_status: Mapped[ProviderSyncStatus] = mapped_column(
        enum_column(ProviderSyncStatus, "provider_sync_status"),
        default=ProviderSyncStatus.NOT_APPLICABLE,
        nullable=False,
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(nullable=True)
