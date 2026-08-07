from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import MONEY, ZERO_MONEY, Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import (
    ApprovalStatus,
    ApprovalType,
    DiscountKind,
    KitchenTicketStatus,
    OrderItemStatus,
    OrderSource,
    OrderStatus,
    PaymentStatus,
    enum_column,
)

if TYPE_CHECKING:
    from app.models.operations import TableSession


class Order(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_order_tenant_idempotency"),
        Index(
            "ix_orders_tenant_branch_status_created",
            "tenant_id",
            "branch_id",
            "status",
            "created_at",
        ),
        CheckConstraint("subtotal >= 0", name="order_subtotal_nonnegative"),
        CheckConstraint("total >= 0", name="order_total_nonnegative"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    table_session_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("table_sessions.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    loyalty_membership_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("loyalty_memberships.id", ondelete="SET NULL"), nullable=True, index=True
    )
    source: Mapped[OrderSource] = mapped_column(
        enum_column(OrderSource, "order_source"), nullable=False, index=True
    )
    status: Mapped[OrderStatus] = mapped_column(
        enum_column(OrderStatus, "order_status"),
        default=OrderStatus.DRAFT,
        nullable=False,
        index=True,
    )
    customer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="TRY", nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    discount_total: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    tax_total: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    total: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)
    version: Mapped[int] = mapped_column(default=1, nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(nullable=True)

    table_session: Mapped[TableSession | None] = relationship()
    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order", lazy="selectin", cascade="all, delete-orphan"
    )
    payments: Mapped[list[Payment]] = relationship(back_populates="order", lazy="selectin")

    @property
    def table_id(self) -> UUID | None:
        return self.table_session.table_id if self.table_session else None

    @property
    def table_name(self) -> str | None:
        return (
            self.table_session.table.name
            if self.table_session and self.table_session.table
            else None
        )


class OrderItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="order_item_quantity_positive"),
        CheckConstraint("unit_price >= 0", name="order_item_price_nonnegative"),
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
    product_id: Mapped[UUID] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    preparation_station_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("preparation_stations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    product_name_snapshot: Mapped[str] = mapped_column(String(160), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    tax_rate_snapshot: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    discount_snapshot: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    line_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    status: Mapped[OrderItemStatus] = mapped_column(
        enum_column(OrderItemStatus, "order_item_status"),
        default=OrderItemStatus.DRAFT,
        nullable=False,
        index=True,
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(nullable=True)

    order: Mapped[Order] = relationship(back_populates="items")
    modifiers: Mapped[list[OrderItemModifier]] = relationship(
        back_populates="order_item", lazy="selectin", cascade="all, delete-orphan"
    )


class OrderItemModifier(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "order_item_modifiers"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    order_item_id: Mapped[UUID] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    modifier_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("modifiers.id", ondelete="SET NULL"), nullable=True
    )
    name_snapshot: Mapped[str] = mapped_column(String(120), nullable=False)
    price_delta_snapshot: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    quantity: Mapped[int] = mapped_column(default=1, nullable=False)

    order_item: Mapped[OrderItem] = relationship(back_populates="modifiers")


class OrderNote(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "order_notes"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    order_id: Mapped[UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    actor_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)


class KitchenTicket(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "kitchen_tickets"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "order_id",
            "preparation_station_id",
            "batch_number",
            name="uq_ticket_order_station_batch",
        ),
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
    preparation_station_id: Mapped[UUID] = mapped_column(
        ForeignKey("preparation_stations.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    batch_number: Mapped[int] = mapped_column(default=1, nullable=False)
    status: Mapped[KitchenTicketStatus] = mapped_column(
        enum_column(KitchenTicketStatus, "kitchen_ticket_status"),
        default=KitchenTicketStatus.NEW,
        nullable=False,
        index=True,
    )
    accepted_at: Mapped[datetime | None] = mapped_column(nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    ready_at: Mapped[datetime | None] = mapped_column(nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)

    items: Mapped[list[KitchenTicketItem]] = relationship(
        back_populates="ticket", lazy="selectin", cascade="all, delete-orphan"
    )


class KitchenTicketItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "kitchen_ticket_items"
    __table_args__ = (
        UniqueConstraint("tenant_id", "ticket_id", "order_item_id", name="uq_ticket_order_item"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    ticket_id: Mapped[UUID] = mapped_column(
        ForeignKey("kitchen_tickets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_item_id: Mapped[UUID] = mapped_column(
        ForeignKey("order_items.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[OrderItemStatus] = mapped_column(
        enum_column(OrderItemStatus, "kitchen_ticket_item_status"),
        default=OrderItemStatus.SUBMITTED,
        nullable=False,
    )

    ticket: Mapped[KitchenTicket] = relationship(back_populates="items")


class Payment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_payment_tenant_idempotency"),
        CheckConstraint("amount > 0", name="payment_amount_positive"),
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
    recorded_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    method: Mapped[str] = mapped_column(String(40), nullable=False)
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    status: Mapped[PaymentStatus] = mapped_column(
        enum_column(PaymentStatus, "payment_status"),
        default=PaymentStatus.COMPLETED,
        nullable=False,
    )
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(160), nullable=True)

    order: Mapped[Order] = relationship(back_populates="payments")


class Discount(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "discounts"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    order_id: Mapped[UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    order_item_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("order_items.id", ondelete="RESTRICT"), nullable=True
    )
    requested_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[DiscountKind] = mapped_column(
        enum_column(DiscountKind, "discount_kind"), nullable=False
    )
    value: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)


class Cancellation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "cancellations"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    order_id: Mapped[UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    order_item_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("order_items.id", ondelete="RESTRICT"), nullable=True
    )
    actor_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    reversal_completed: Mapped[bool] = mapped_column(default=False, nullable=False)


class ApprovalRequest(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "approval_requests"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    order_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("orders.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    order_item_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("order_items.id", ondelete="RESTRICT"), nullable=True
    )
    requested_by_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    resolved_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approval_type: Mapped[ApprovalType] = mapped_column(
        enum_column(ApprovalType, "approval_type"), nullable=False, index=True
    )
    status: Mapped[ApprovalStatus] = mapped_column(
        enum_column(ApprovalStatus, "approval_status"),
        default=ApprovalStatus.PENDING,
        nullable=False,
        index=True,
    )
    payload: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(nullable=True)


class OrderOperation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "order_operations"
    __table_args__ = (
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_order_operation_idempotency"),
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
    actor_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    operation: Mapped[str] = mapped_column(String(40), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)
    result: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)
