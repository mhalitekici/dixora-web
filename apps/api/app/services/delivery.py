from __future__ import annotations

import logging
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import DomainError
from app.models import DeliveryOrder, Order, User
from app.models.enums import (
    DeliveryChannel,
    DeliveryPaymentMethod,
    DeliveryPaymentStatus,
    DeliveryStatus,
    MarketplaceProvider,
    OrderSource,
    OrderStatus,
    ProviderSyncStatus,
)
from app.schemas import OrderCreate, OrderItemInput
from app.security import utcnow
from app.services.orders import accept_order, create_order

logger = logging.getLogger(__name__)

# Which delivery states may follow which. Encoded once so every entry point
# (staff action, provider webhook, admin correction) enforces the same rules
# instead of each re-deriving them.
ALLOWED_TRANSITIONS: dict[DeliveryStatus, frozenset[DeliveryStatus]] = {
    DeliveryStatus.NEW: frozenset(
        {DeliveryStatus.ACCEPTED, DeliveryStatus.REJECTED, DeliveryStatus.CANCELLED}
    ),
    DeliveryStatus.ACCEPTED: frozenset(
        {DeliveryStatus.PREPARING, DeliveryStatus.READY, DeliveryStatus.CANCELLED}
    ),
    DeliveryStatus.PREPARING: frozenset(
        {DeliveryStatus.READY, DeliveryStatus.CANCELLED}
    ),
    DeliveryStatus.READY: frozenset(
        {DeliveryStatus.DISPATCHED, DeliveryStatus.DELIVERED, DeliveryStatus.CANCELLED}
    ),
    DeliveryStatus.DISPATCHED: frozenset(
        {DeliveryStatus.DELIVERED, DeliveryStatus.CANCELLED}
    ),
    # Terminal.
    DeliveryStatus.DELIVERED: frozenset(),
    DeliveryStatus.CANCELLED: frozenset(),
    DeliveryStatus.REJECTED: frozenset(),
}

TERMINAL_STATUSES = frozenset(
    {DeliveryStatus.DELIVERED, DeliveryStatus.CANCELLED, DeliveryStatus.REJECTED}
)


def assert_transition(current: DeliveryStatus, target: DeliveryStatus) -> None:
    if target not in ALLOWED_TRANSITIONS.get(current, frozenset()):
        raise DomainError(
            "delivery_invalid_transition",
            f"Bu sipariş '{current.value}' durumundan '{target.value}' durumuna geçemez.",
            status_code=409,
            details={"current": current.value, "requested": target.value},
        )


async def get_delivery_order(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    delivery_id: UUID,
    lock: bool = False,
) -> DeliveryOrder:
    """Always tenant-scoped: a leaked id from another business must not resolve."""
    query = select(DeliveryOrder).where(
        DeliveryOrder.id == delivery_id,
        DeliveryOrder.tenant_id == tenant_id,
    )
    if lock:
        query = query.with_for_update()
    record = (await db.execute(query)).scalar_one_or_none()
    if record is None:
        raise DomainError("delivery_order_not_found", "Sipariş bulunamadı.", status_code=404)
    return record


async def find_by_external_id(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    provider: MarketplaceProvider,
    external_order_id: str,
) -> DeliveryOrder | None:
    """The idempotency lookup for provider ingestion."""
    return (
        await db.execute(
            select(DeliveryOrder).where(
                DeliveryOrder.tenant_id == tenant_id,
                DeliveryOrder.provider == provider,
                DeliveryOrder.external_order_id == external_order_id,
            )
        )
    ).scalar_one_or_none()


async def create_delivery_order(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    actor_user_id: UUID | None,
    channel: DeliveryChannel,
    provider: MarketplaceProvider | None,
    items: list[OrderItemInput],
    idempotency_key: str,
    customer_name: str | None,
    customer_phone: str | None,
    address_line: str | None = None,
    district: str | None = None,
    neighbourhood: str | None = None,
    address_note: str | None = None,
    customer_note: str | None = None,
    payment_method: DeliveryPaymentMethod | str,
    payment_status: DeliveryPaymentStatus | str,
    external_order_id: str | None = None,
    external_display_id: str | None = None,
    external_created_at: datetime | None = None,
    auto_accept: bool = False,
) -> tuple[DeliveryOrder, Order, bool]:
    """Create a delivery order, reusing the normal order pipeline.

    Returns (delivery, order, replayed). `replayed` is True when this call hit an
    existing external order, which is how duplicate provider webhooks stay
    harmless.
    """
    if provider is not None and external_order_id:
        existing = await find_by_external_id(
            db,
            tenant_id=tenant_id,
            provider=provider,
            external_order_id=external_order_id,
        )
        if existing is not None:
            order = (
                await db.execute(select(Order).where(Order.id == existing.order_id))
            ).scalar_one()
            return existing, order, True

    # Delivery orders have no table; the existing pipeline already supports that,
    # so stock deduction, kitchen tickets and totals behave exactly as in-house.
    order, replayed = await create_order(
        db,
        tenant_id=tenant_id,
        branch_id=branch_id,
        actor_user_id=actor_user_id,
        payload=OrderCreate(
            table_id=None,
            source=(
                OrderSource.TAKEAWAY
                if channel == DeliveryChannel.TAKEAWAY
                else OrderSource.DELIVERY
            ),
            customer_name=customer_name,
            items=items,
            idempotency_key=idempotency_key,
            auto_accept=auto_accept,
        ),
    )

    if replayed:
        # The idempotency key matched an existing order, so its delivery row
        # already exists. Creating a second one would violate the one-to-one
        # constraint and turn a harmless retry into a 409.
        existing_delivery = (
            await db.execute(
                select(DeliveryOrder).where(DeliveryOrder.order_id == order.id)
            )
        ).scalar_one_or_none()
        if existing_delivery is not None:
            return existing_delivery, order, True

    delivery = DeliveryOrder(
        tenant_id=tenant_id,
        branch_id=branch_id,
        order_id=order.id,
        channel=channel,
        provider=provider,
        delivery_status=DeliveryStatus.ACCEPTED if auto_accept else DeliveryStatus.NEW,
        accepted_at=utcnow() if auto_accept else None,
        external_order_id=external_order_id,
        external_display_id=external_display_id,
        external_created_at=external_created_at,
        # Nothing has been pushed to a provider yet; own-channel orders never will be.
        sync_status=(
            ProviderSyncStatus.PENDING
            if provider is not None
            else ProviderSyncStatus.NOT_APPLICABLE
        ),
        customer_name=customer_name,
        customer_phone=customer_phone,
        address_line=address_line,
        district=district,
        neighbourhood=neighbourhood,
        address_note=address_note,
        customer_note=customer_note,
        # Coerced at the boundary so the model attribute is always an enum,
        # never a bare string that later fails on `.value`.
        payment_method=DeliveryPaymentMethod(payment_method),
        payment_status=DeliveryPaymentStatus(payment_status),
    )
    db.add(delivery)
    await db.flush()
    return delivery, order, replayed


async def accept_delivery_order(
    db: AsyncSession,
    *,
    delivery: DeliveryOrder,
    actor_user_id: UUID | None,
    promised_minutes: int | None,
) -> DeliveryOrder:
    assert_transition(delivery.delivery_status, DeliveryStatus.ACCEPTED)
    delivery.delivery_status = DeliveryStatus.ACCEPTED
    delivery.accepted_at = utcnow()
    delivery.promised_minutes = promised_minutes

    order = (
        await db.execute(select(Order).where(Order.id == delivery.order_id))
    ).scalar_one()
    if order.status in {OrderStatus.DRAFT, OrderStatus.SUBMITTED}:
        # Route it into the kitchen through the existing acceptance path so
        # tickets and stock behave identically to an in-house order.
        await accept_order(db, order=order, actor_user_id=actor_user_id)
    return delivery


async def reject_delivery_order(
    db: AsyncSession, *, delivery: DeliveryOrder, reason: str
) -> DeliveryOrder:
    assert_transition(delivery.delivery_status, DeliveryStatus.REJECTED)
    delivery.delivery_status = DeliveryStatus.REJECTED
    delivery.rejection_reason = reason
    delivery.cancelled_at = utcnow()
    return delivery


async def advance_delivery_order(
    db: AsyncSession,
    *,
    delivery: DeliveryOrder,
    target: DeliveryStatus,
    reason: str | None = None,
) -> DeliveryOrder:
    assert_transition(delivery.delivery_status, target)
    delivery.delivery_status = target
    now = utcnow()
    if target == DeliveryStatus.READY:
        delivery.ready_at = now
    elif target == DeliveryStatus.DISPATCHED:
        delivery.dispatched_at = now
    elif target == DeliveryStatus.DELIVERED:
        delivery.delivered_at = now
    elif target == DeliveryStatus.CANCELLED:
        delivery.cancelled_at = now
        delivery.rejection_reason = reason
    return delivery


async def assign_courier(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    delivery: DeliveryOrder,
    courier_user_id: UUID | None,
    courier_name: str | None,
) -> DeliveryOrder:
    """Assign a staff member as courier, or clear the assignment."""
    if courier_user_id is not None:
        courier = (
            await db.execute(
                select(User).where(User.id == courier_user_id, User.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if courier is None:
            raise DomainError("courier_not_found", "Kurye bulunamadı.", status_code=404)
        delivery.courier_user_id = courier.id
        delivery.courier_name = courier.display_name
    else:
        delivery.courier_user_id = None
        delivery.courier_name = courier_name
    return delivery
