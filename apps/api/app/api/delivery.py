from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.dependencies import (
    DbSession,
    Identity,
    require_branch,
    require_permissions,
    require_tenant,
)
from app.errors import DomainError
from app.models import DeliveryOrder, Order, OrderItem
from app.models.enums import DeliveryChannel, DeliveryStatus
from app.schemas import (
    DeliveryAcceptRequest,
    DeliveryCourierAssign,
    DeliveryInboxCounts,
    DeliveryOrderCreate,
    DeliveryOrderItemOut,
    DeliveryOrderOut,
    DeliveryRejectRequest,
    DeliveryStatusUpdate,
    Page,
)
from app.services.audit import add_audit_log
from app.services.delivery import (
    accept_delivery_order,
    advance_delivery_order,
    assign_courier,
    create_delivery_order,
    get_delivery_order,
    reject_delivery_order,
)

router = APIRouter(prefix="/delivery", tags=["delivery"])

DeliveryReader = Annotated[Identity, Depends(require_permissions("orders.read"))]
DeliveryOperator = Annotated[Identity, Depends(require_permissions("orders.manage"))]


def _serialize(delivery: DeliveryOrder, order: Order) -> DeliveryOrderOut:
    return DeliveryOrderOut(
        id=delivery.id,
        order_id=order.id,
        branch_id=delivery.branch_id,
        channel=delivery.channel.value,
        provider=delivery.provider.value if delivery.provider else None,
        delivery_status=delivery.delivery_status.value,
        sync_status=delivery.sync_status.value,
        sync_error=delivery.sync_error,
        external_display_id=delivery.external_display_id,
        customer_name=delivery.customer_name,
        customer_phone=delivery.customer_phone,
        address_line=delivery.address_line,
        district=delivery.district,
        neighbourhood=delivery.neighbourhood,
        address_note=delivery.address_note,
        customer_note=delivery.customer_note,
        payment_method=delivery.payment_method.value,
        payment_status=delivery.payment_status.value,
        courier_name=delivery.courier_name,
        promised_minutes=delivery.promised_minutes,
        total=order.total,
        items=[
            DeliveryOrderItemOut(
                name=item.product_name_snapshot,
                quantity=item.quantity,
                unit_price=item.unit_price,
                line_total=item.line_total,
                note=item.note,
                modifiers=[modifier.name_snapshot for modifier in item.modifiers],
            )
            for item in order.items
        ],
        created_at=delivery.created_at,
        accepted_at=delivery.accepted_at,
        ready_at=delivery.ready_at,
        dispatched_at=delivery.dispatched_at,
        delivered_at=delivery.delivered_at,
        cancelled_at=delivery.cancelled_at,
        rejection_reason=delivery.rejection_reason,
    )


async def _load_with_order(
    db: DbSession, *, tenant_id: UUID, delivery: DeliveryOrder
) -> Order:
    return (
        await db.execute(
            select(Order)
            .where(Order.id == delivery.order_id, Order.tenant_id == tenant_id)
            .options(selectinload(Order.items).selectinload(OrderItem.modifiers))
        )
    ).scalar_one()


@router.get("", response_model=Page[DeliveryOrderOut])
async def list_delivery_orders(
    identity: DeliveryReader,
    db: DbSession,
    branch_id: UUID | None = None,
    channel: str | None = None,
    delivery_status: str | None = None,
    active_only: bool = True,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[DeliveryOrderOut]:
    """The operational inbox.

    Defaults to active orders only — a busy branch accumulates thousands of
    delivered ones and the till never needs them on screen.
    """
    tenant_id = require_tenant(identity)
    predicates = [DeliveryOrder.tenant_id == tenant_id]
    # require_branch enforces that the requested branch is one this user may see.
    predicates.append(DeliveryOrder.branch_id == require_branch(identity, branch_id))
    if channel:
        predicates.append(DeliveryOrder.channel == channel)
    if delivery_status:
        predicates.append(DeliveryOrder.delivery_status == delivery_status)
    elif active_only:
        predicates.append(
            DeliveryOrder.delivery_status.notin_(
                [
                    DeliveryStatus.DELIVERED,
                    DeliveryStatus.CANCELLED,
                    DeliveryStatus.REJECTED,
                ]
            )
        )

    total = (
        await db.execute(select(func.count(DeliveryOrder.id)).where(*predicates))
    ).scalar_one()
    rows = (
        (
            await db.execute(
                select(DeliveryOrder)
                .where(*predicates)
                .order_by(DeliveryOrder.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return Page(items=[], total=total, limit=limit, offset=offset)

    # One query for every order rather than one per row.
    orders = {
        order.id: order
        for order in (
            (
                await db.execute(
                    select(Order)
                    .where(
                        Order.tenant_id == tenant_id,
                        Order.id.in_([row.order_id for row in rows]),
                    )
                    .options(selectinload(Order.items).selectinload(OrderItem.modifiers))
                )
            )
            .scalars()
            .all()
        )
    }
    items = [
        _serialize(row, orders[row.order_id]) for row in rows if row.order_id in orders
    ]
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.get("/counts", response_model=DeliveryInboxCounts)
async def delivery_counts(
    identity: DeliveryReader,
    db: DbSession,
    branch_id: UUID | None = None,
) -> DeliveryInboxCounts:
    tenant_id = require_tenant(identity)
    rows = (
        await db.execute(
            select(DeliveryOrder.delivery_status, func.count(DeliveryOrder.id))
            .where(
                DeliveryOrder.tenant_id == tenant_id,
                DeliveryOrder.branch_id == require_branch(identity, branch_id),
            )
            .group_by(DeliveryOrder.delivery_status)
        )
    ).all()
    counts = {status_value: count for status_value, count in rows}
    return DeliveryInboxCounts(
        new=counts.get(DeliveryStatus.NEW, 0),
        accepted=counts.get(DeliveryStatus.ACCEPTED, 0),
        preparing=counts.get(DeliveryStatus.PREPARING, 0),
        ready=counts.get(DeliveryStatus.READY, 0),
        dispatched=counts.get(DeliveryStatus.DISPATCHED, 0),
        delivered=counts.get(DeliveryStatus.DELIVERED, 0),
        cancelled=counts.get(DeliveryStatus.CANCELLED, 0)
        + counts.get(DeliveryStatus.REJECTED, 0),
    )


@router.post("", response_model=DeliveryOrderOut, status_code=status.HTTP_201_CREATED)
async def create_manual_delivery_order(
    payload: DeliveryOrderCreate,
    request: Request,
    identity: DeliveryOperator,
    db: DbSession,
) -> DeliveryOrderOut:
    """Phone / counter / own-delivery order entered by staff.

    Works with no marketplace integration at all, which is the point: the
    product must be useful before any provider API exists.
    """
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)

    delivery, order, replayed = await create_delivery_order(
        db,
        tenant_id=tenant_id,
        branch_id=branch_id,
        actor_user_id=identity.user_id,
        channel=DeliveryChannel(payload.channel),
        provider=None,
        items=payload.items,
        idempotency_key=payload.idempotency_key,
        customer_name=payload.customer_name,
        customer_phone=payload.customer_phone,
        address_line=payload.address_line,
        district=payload.district,
        neighbourhood=payload.neighbourhood,
        address_note=payload.address_note,
        customer_note=payload.customer_note,
        payment_method=payload.payment_method,
        payment_status=payload.payment_status,
        auto_accept=payload.auto_accept,
    )
    if not replayed:
        add_audit_log(
            db,
            identity=identity,
            action="delivery.order_created",
            resource_type="delivery_order",
            resource_id=delivery.id,
            branch_id=branch_id,
            new_value={"channel": payload.channel, "total": str(order.total)},
        )
    await db.commit()
    await _broadcast(request, delivery)
    return _serialize(delivery, await _load_with_order(db, tenant_id=tenant_id, delivery=delivery))


@router.post("/{delivery_id}/accept", response_model=DeliveryOrderOut)
async def accept_order_endpoint(
    delivery_id: UUID,
    payload: DeliveryAcceptRequest,
    request: Request,
    identity: DeliveryOperator,
    db: DbSession,
) -> DeliveryOrderOut:
    tenant_id = require_tenant(identity)
    delivery = await get_delivery_order(
        db, tenant_id=tenant_id, delivery_id=delivery_id, lock=True
    )
    _assert_branch(identity, delivery)
    await accept_delivery_order(
        db,
        delivery=delivery,
        actor_user_id=identity.user_id,
        promised_minutes=payload.promised_minutes,
    )
    add_audit_log(
        db,
        identity=identity,
        action="delivery.order_accepted",
        resource_type="delivery_order",
        resource_id=delivery.id,
        branch_id=delivery.branch_id,
        new_value={"promised_minutes": payload.promised_minutes},
    )
    await db.commit()
    await _broadcast(request, delivery)
    return _serialize(delivery, await _load_with_order(db, tenant_id=tenant_id, delivery=delivery))


@router.post("/{delivery_id}/reject", response_model=DeliveryOrderOut)
async def reject_order_endpoint(
    delivery_id: UUID,
    payload: DeliveryRejectRequest,
    request: Request,
    identity: DeliveryOperator,
    db: DbSession,
) -> DeliveryOrderOut:
    tenant_id = require_tenant(identity)
    delivery = await get_delivery_order(
        db, tenant_id=tenant_id, delivery_id=delivery_id, lock=True
    )
    _assert_branch(identity, delivery)
    await reject_delivery_order(db, delivery=delivery, reason=payload.reason)
    add_audit_log(
        db,
        identity=identity,
        action="delivery.order_rejected",
        resource_type="delivery_order",
        resource_id=delivery.id,
        branch_id=delivery.branch_id,
        reason=payload.reason,
    )
    await db.commit()
    await _broadcast(request, delivery)
    return _serialize(delivery, await _load_with_order(db, tenant_id=tenant_id, delivery=delivery))


@router.post("/{delivery_id}/status", response_model=DeliveryOrderOut)
async def update_status_endpoint(
    delivery_id: UUID,
    payload: DeliveryStatusUpdate,
    request: Request,
    identity: DeliveryOperator,
    db: DbSession,
) -> DeliveryOrderOut:
    tenant_id = require_tenant(identity)
    delivery = await get_delivery_order(
        db, tenant_id=tenant_id, delivery_id=delivery_id, lock=True
    )
    _assert_branch(identity, delivery)
    await advance_delivery_order(
        db,
        delivery=delivery,
        target=DeliveryStatus(payload.status),
        reason=payload.reason,
    )
    add_audit_log(
        db,
        identity=identity,
        action=f"delivery.order_{payload.status.lower()}",
        resource_type="delivery_order",
        resource_id=delivery.id,
        branch_id=delivery.branch_id,
        reason=payload.reason,
    )
    await db.commit()
    await _broadcast(request, delivery)
    return _serialize(delivery, await _load_with_order(db, tenant_id=tenant_id, delivery=delivery))


@router.post("/{delivery_id}/courier", response_model=DeliveryOrderOut)
async def assign_courier_endpoint(
    delivery_id: UUID,
    payload: DeliveryCourierAssign,
    identity: DeliveryOperator,
    db: DbSession,
) -> DeliveryOrderOut:
    tenant_id = require_tenant(identity)
    delivery = await get_delivery_order(
        db, tenant_id=tenant_id, delivery_id=delivery_id, lock=True
    )
    _assert_branch(identity, delivery)
    await assign_courier(
        db,
        tenant_id=tenant_id,
        delivery=delivery,
        courier_user_id=payload.courier_user_id,
        courier_name=payload.courier_name,
    )
    add_audit_log(
        db,
        identity=identity,
        action="delivery.courier_assigned",
        resource_type="delivery_order",
        resource_id=delivery.id,
        branch_id=delivery.branch_id,
        new_value={"courier": delivery.courier_name},
    )
    await db.commit()
    return _serialize(delivery, await _load_with_order(db, tenant_id=tenant_id, delivery=delivery))


def _assert_branch(identity: Identity, delivery: DeliveryOrder) -> None:
    """Staff may only act on orders belonging to a branch they can access."""
    if not identity.can_access_branch(delivery.branch_id):
        raise DomainError(
            "branch_forbidden",
            "Bu sipariş başka bir şubeye ait.",
            status_code=403,
        )


async def _broadcast(request: Request, delivery: DeliveryOrder) -> None:
    await request.app.state.realtime.broadcast(
        delivery.tenant_id,
        delivery.branch_id,
        {
            "type": "delivery.updated",
            "delivery_id": str(delivery.id),
            "status": delivery.delivery_status.value,
            "channel": delivery.channel.value,
        },
    )
