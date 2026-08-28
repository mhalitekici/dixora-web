from __future__ import annotations

from decimal import Decimal
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
    require_record_branch,
    require_tenant,
)
from app.errors import DomainError
from app.models import DiningTable, Order, OrderItem, Payment, TableSession, User
from app.models.enums import (
    ApprovalStatus,
    ApprovalType,
    OrderSource,
    OrderStatus,
    PaymentStatus,
    TableState,
)
from app.schemas import (
    AmountCheckSplitOut,
    AmountCheckSplitRequest,
    ApprovalOut,
    ApprovalPendingCountOut,
    ApprovalRequestAdminOut,
    CancellationRequestCreate,
    DiscountRequestCreate,
    ItemCheckSplitRequest,
    OrderCreate,
    OrderItemOut,
    OrderItemsAppend,
    OrderOut,
    Page,
    PaymentCreate,
    PaymentOut,
    RoomFolioOrderOut,
    RoomFolioOut,
    TableMergeRequest,
    TableTransferRequest,
)
from app.services.audit import add_audit_log
from app.services.orders import (
    accept_order,
    add_payment,
    append_order_items,
    approve_cancellation,
    approve_discount,
    count_pending_approval_requests,
    create_order,
    list_approval_requests,
    load_order,
    merge_table_order,
    plan_amount_split,
    reject_cancellation,
    reject_discount,
    request_cancellation,
    request_discount,
    split_check_by_items,
    transfer_order_table,
)

router = APIRouter(prefix="/orders", tags=["orders"])
OrderReader = Annotated[Identity, Depends(require_permissions("orders.read"))]
OrderCreator = Annotated[Identity, Depends(require_permissions("orders.create"))]
OrderManager = Annotated[Identity, Depends(require_permissions("orders.manage"))]
PaymentManager = Annotated[Identity, Depends(require_permissions("payments.manage"))]
DiscountRequester = Annotated[Identity, Depends(require_permissions("discounts.request"))]
DiscountApprover = Annotated[Identity, Depends(require_permissions("discounts.approve"))]
TableTransferer = Annotated[Identity, Depends(require_permissions("tables.transfer"))]
ApprovalReader = Annotated[Identity, Depends(require_permissions("orders.manage"))]


async def _broadcast(request: Request, order: Order) -> None:
    await request.app.state.realtime.broadcast(
        order.tenant_id,
        order.branch_id,
        {
            "type": "order.updated",
            "order_id": str(order.id),
            "status": order.status.value,
            "version": order.version,
        },
    )


async def _scoped_order(
    identity: Identity,
    db: DbSession,
    order_id: UUID,
    *,
    lock: bool = False,
) -> Order:
    """Load an order by id, refusing one that belongs to another branch.

    `load_order` is scoped to the business, which is the right scope for the
    services that call it with a branch already in hand. Coming in off a URL the
    caller typed, the branch has to be checked too.
    """
    order = await load_order(db, require_tenant(identity), order_id, lock=lock)
    require_record_branch(identity, order.branch_id)
    return order


@router.get("", response_model=Page[OrderOut])
async def list_orders(
    identity: OrderReader,
    db: DbSession,
    branch_id: UUID | None = None,
    order_status: OrderStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[OrderOut]:
    predicates = [
        Order.tenant_id == require_tenant(identity),
        Order.branch_id == require_branch(identity, branch_id),
    ]
    if order_status:
        predicates.append(Order.status == order_status)
    total = (await db.execute(select(func.count(Order.id)).where(*predicates))).scalar_one()
    rows = (
        (
            await db.execute(
                select(Order)
                .where(*predicates)
                .options(
                    selectinload(Order.table_session).selectinload(TableSession.table),
                    selectinload(Order.items).selectinload(OrderItem.modifiers),
                    selectinload(Order.payments),
                )
                .order_by(Order.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return Page(
        items=[OrderOut.model_validate(item) for item in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
async def create_new_order(
    payload: OrderCreate,
    request: Request,
    identity: OrderCreator,
    db: DbSession,
) -> OrderOut:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)
    source_override = {
        "WAITER": OrderSource.WAITER,
        "CASHIER": OrderSource.CASHIER,
    }.get(identity.role)
    order, replayed = await create_order(
        db,
        tenant_id=tenant_id,
        branch_id=branch_id,
        actor_user_id=identity.user_id,
        payload=payload,
        source_override=source_override,
    )
    if not replayed:
        add_audit_log(
            db,
            identity=identity,
            action="order.created",
            resource_type="order",
            resource_id=order.id,
            new_value={"status": order.status.value, "total": str(order.total)},
        )
    await db.commit()
    order = await load_order(db, tenant_id, order.id)
    await _broadcast(request, order)
    return OrderOut.model_validate(order)


@router.get("/approval-requests", response_model=list[ApprovalRequestAdminOut])
async def list_approval_requests_endpoint(
    identity: ApprovalReader,
    db: DbSession,
    branch_id: UUID | None = None,
    request_status: ApprovalStatus | None = Query(default=None, alias="status"),
    approval_type: ApprovalType | None = None,
) -> list[ApprovalRequestAdminOut]:
    tenant_id = require_tenant(identity)
    approvals = await list_approval_requests(
        db,
        tenant_id=tenant_id,
        branch_id=require_branch(identity, branch_id),
        status=request_status,
        approval_type=approval_type,
    )
    if not approvals:
        return []
    order_ids = {approval.order_id for approval in approvals if approval.order_id}
    orders_by_id: dict[UUID, Order] = {}
    if order_ids:
        rows = (
            (
                await db.execute(
                    select(Order)
                    .where(Order.tenant_id == tenant_id, Order.id.in_(order_ids))
                    .options(
                        selectinload(Order.table_session).selectinload(TableSession.table),
                        selectinload(Order.items),
                    )
                )
            )
            .scalars()
            .all()
        )
        orders_by_id = {order.id: order for order in rows}
    user_ids = {approval.requested_by_user_id for approval in approvals} | {
        approval.resolved_by_user_id for approval in approvals if approval.resolved_by_user_id
    }
    names_by_id: dict[UUID, str] = {}
    if user_ids:
        name_rows = (
            await db.execute(
                select(User.id, User.display_name).where(
                    User.tenant_id == tenant_id, User.id.in_(user_ids)
                )
            )
        ).all()
        names_by_id = {row.id: row.display_name for row in name_rows}
    results: list[ApprovalRequestAdminOut] = []
    for approval in approvals:
        order = orders_by_id.get(approval.order_id) if approval.order_id else None
        order_item_name: str | None = None
        if order is not None and approval.order_item_id is not None:
            item = next((item for item in order.items if item.id == approval.order_item_id), None)
            order_item_name = item.product_name_snapshot if item else None
        results.append(
            ApprovalRequestAdminOut(
                id=approval.id,
                order_id=approval.order_id,
                order_item_id=approval.order_item_id,
                approval_type=approval.approval_type,
                status=approval.status,
                payload=approval.payload,
                reason=approval.reason,
                created_at=approval.created_at,
                resolved_at=approval.resolved_at,
                requested_by_user_id=approval.requested_by_user_id,
                requested_by_name=names_by_id.get(approval.requested_by_user_id),
                resolved_by_user_id=approval.resolved_by_user_id,
                resolved_by_name=(
                    names_by_id.get(approval.resolved_by_user_id)
                    if approval.resolved_by_user_id
                    else None
                ),
                table_name=order.table_name if order else None,
                order_item_name=order_item_name,
                order_total=order.total if order else None,
            )
        )
    return results


@router.get("/approval-requests/pending-count", response_model=ApprovalPendingCountOut)
async def approval_requests_pending_count(
    identity: ApprovalReader,
    db: DbSession,
    branch_id: UUID | None = None,
) -> ApprovalPendingCountOut:
    pending = await count_pending_approval_requests(
        db,
        tenant_id=require_tenant(identity),
        branch_id=require_branch(identity, branch_id),
    )
    return ApprovalPendingCountOut(pending=pending)


@router.get("/room-folio", response_model=RoomFolioOut)
async def get_room_folio(
    identity: OrderReader,
    db: DbSession,
    reference: str = Query(..., min_length=1, max_length=160),
) -> RoomFolioOut:
    """Every order charged to one room/guest reference, for checkout billing.

    Matches the free-text reference cashiers typed into the "Oda" payment
    method as a case-insensitive substring, since staff may search by just
    the room number, just the guest name, or both together. Each matched
    order still shows its exact stored reference so staff can visually
    confirm they're looking at the right room before charging out.
    """
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)
    normalized = reference.strip()
    needle = normalized.lower()

    order_ids = (
        (
            await db.execute(
                select(Payment.order_id)
                .join(Order, Payment.order_id == Order.id)
                .where(
                    Order.tenant_id == tenant_id,
                    Order.branch_id == branch_id,
                    Payment.method == "ROOM_CHARGE",
                    Payment.status == PaymentStatus.COMPLETED,
                    func.lower(Payment.reference).contains(needle),
                )
                .distinct()
            )
        )
        .scalars()
        .all()
    )
    if not order_ids:
        return RoomFolioOut(reference=normalized, orders=[], total=Decimal("0"))

    rows = (
        (
            await db.execute(
                select(Order)
                .where(Order.tenant_id == tenant_id, Order.id.in_(order_ids))
                .options(
                    selectinload(Order.table_session).selectinload(TableSession.table),
                    selectinload(Order.items).selectinload(OrderItem.modifiers),
                    selectinload(Order.payments),
                )
                .order_by(Order.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    orders_out: list[RoomFolioOrderOut] = []
    grand_total = Decimal("0")
    for order in rows:
        matching_payments = [
            payment
            for payment in order.payments
            if payment.method == "ROOM_CHARGE"
            and payment.status == PaymentStatus.COMPLETED
            and needle in (payment.reference or "").strip().lower()
        ]
        room_amount = sum((payment.amount for payment in matching_payments), Decimal("0"))
        matched_reference = matching_payments[0].reference if matching_payments else normalized
        grand_total += room_amount
        orders_out.append(
            RoomFolioOrderOut(
                order_id=order.id,
                reference=matched_reference or normalized,
                table_name=order.table_name,
                created_at=order.created_at,
                items=[OrderItemOut.model_validate(item) for item in order.items],
                order_total=order.total,
                room_charge_amount=room_amount,
            )
        )

    return RoomFolioOut(reference=normalized, orders=orders_out, total=grand_total)


@router.get("/{order_id}", response_model=OrderOut)
async def get_order(
    order_id: UUID,
    identity: OrderReader,
    db: DbSession,
) -> OrderOut:
    return OrderOut.model_validate(await _scoped_order(identity, db, order_id))


@router.post("/{order_id}/items", response_model=OrderOut)
async def append_items(
    order_id: UUID,
    payload: OrderItemsAppend,
    request: Request,
    identity: OrderCreator,
    db: DbSession,
) -> OrderOut:
    await _scoped_order(identity, db, order_id)
    order, replayed = await append_order_items(
        db,
        tenant_id=require_tenant(identity),
        order_id=order_id,
        actor_user_id=identity.user_id,
        items=payload.items,
        idempotency_key=payload.idempotency_key,
    )
    if not replayed:
        add_audit_log(
            db,
            identity=identity,
            action="order.items_appended",
            resource_type="order",
            resource_id=order.id,
            new_value={
                "item_count": len(payload.items),
                "version": order.version,
            },
        )
    await db.commit()
    order = await load_order(db, require_tenant(identity), order.id)
    await _broadcast(request, order)
    return OrderOut.model_validate(order)


@router.post("/{order_id}/accept", response_model=OrderOut)
async def accept_existing_order(
    order_id: UUID,
    request: Request,
    identity: OrderManager,
    db: DbSession,
) -> OrderOut:
    order = await _scoped_order(identity, db, order_id, lock=True)
    await accept_order(db, order, actor_user_id=identity.user_id)
    add_audit_log(
        db,
        identity=identity,
        action="order.accepted",
        resource_type="order",
        resource_id=order.id,
    )
    await db.commit()
    order = await load_order(db, order.tenant_id, order.id)
    await _broadcast(request, order)
    return OrderOut.model_validate(order)


@router.post("/{order_id}/bill-request", response_model=OrderOut)
async def request_bill(
    order_id: UUID,
    request: Request,
    identity: OrderCreator,
    db: DbSession,
) -> OrderOut:
    order = await _scoped_order(identity, db, order_id, lock=True)
    if order.status not in {
        OrderStatus.ACCEPTED,
        OrderStatus.PREPARING,
        OrderStatus.PARTIALLY_READY,
        OrderStatus.READY,
        OrderStatus.SERVED,
    }:
        raise DomainError(
            "invalid_order_transition", "Bill cannot be requested now", status_code=409
        )
    order.status = OrderStatus.BILL_REQUESTED
    order.version += 1
    if order.table_session_id:
        table_session = await db.get(TableSession, order.table_session_id)
        if table_session:
            table = await db.get(DiningTable, table_session.table_id)
            if table:
                table.state = TableState.BILL_REQUESTED
                table.version += 1
    add_audit_log(
        db,
        identity=identity,
        action="order.bill_requested",
        resource_type="order",
        resource_id=order.id,
    )
    await db.commit()
    order = await load_order(db, order.tenant_id, order.id)
    await _broadcast(request, order)
    return OrderOut.model_validate(order)


@router.post("/{order_id}/payments", response_model=PaymentOut, status_code=status.HTTP_201_CREATED)
async def record_payment(
    order_id: UUID,
    payload: PaymentCreate,
    request: Request,
    identity: PaymentManager,
    db: DbSession,
) -> PaymentOut:
    order = await _scoped_order(identity, db, order_id, lock=True)
    payment = await add_payment(
        db,
        order=order,
        payload=payload,
        actor_user_id=identity.user_id,
    )
    add_audit_log(
        db,
        identity=identity,
        action="payment.recorded",
        resource_type="payment",
        resource_id=payment.id,
        new_value={
            "order_id": str(order.id),
            "amount": str(payment.amount),
            "method": payment.method,
        },
    )
    await db.commit()
    await _broadcast(request, order)
    return PaymentOut.model_validate(payment)


@router.post("/{order_id}/transfer", response_model=OrderOut)
async def transfer_table(
    order_id: UUID,
    payload: TableTransferRequest,
    request: Request,
    identity: TableTransferer,
    db: DbSession,
) -> OrderOut:
    order = await _scoped_order(identity, db, order_id, lock=True)
    await transfer_order_table(
        db,
        order=order,
        destination_table_id=payload.destination_table_id,
        reason=payload.reason,
        identity=identity,
    )
    await db.commit()
    order = await load_order(db, order.tenant_id, order.id)
    await _broadcast(request, order)
    return OrderOut.model_validate(order)


@router.post("/{order_id}/merge", response_model=OrderOut)
async def merge_table(
    order_id: UUID,
    payload: TableMergeRequest,
    request: Request,
    identity: TableTransferer,
    db: DbSession,
) -> OrderOut:
    source_order = await _scoped_order(identity, db, order_id, lock=True)
    destination_order = await merge_table_order(
        db,
        source_order=source_order,
        destination_table_id=payload.destination_table_id,
        idempotency_key=payload.idempotency_key,
        reason=payload.reason,
        identity=identity,
    )
    await db.commit()
    destination_order = await load_order(db, require_tenant(identity), destination_order.id)
    await _broadcast(request, destination_order)
    return OrderOut.model_validate(destination_order)


@router.post("/{order_id}/split/items", response_model=OrderOut)
async def split_order_items(
    order_id: UUID,
    payload: ItemCheckSplitRequest,
    request: Request,
    identity: PaymentManager,
    db: DbSession,
) -> OrderOut:
    order = await _scoped_order(identity, db, order_id, lock=True)
    split_order = await split_check_by_items(
        db,
        order=order,
        item_ids=payload.item_ids,
        idempotency_key=payload.idempotency_key,
        identity=identity,
    )
    await db.commit()
    split_order = await load_order(db, require_tenant(identity), split_order.id)
    await _broadcast(request, split_order)
    return OrderOut.model_validate(split_order)


@router.post("/{order_id}/split/amount", response_model=AmountCheckSplitOut)
async def split_order_amount(
    order_id: UUID,
    payload: AmountCheckSplitRequest,
    identity: PaymentManager,
    db: DbSession,
) -> AmountCheckSplitOut:
    order = await _scoped_order(identity, db, order_id, lock=True)
    parts = await plan_amount_split(
        db,
        order=order,
        parts=payload.parts,
        idempotency_key=payload.idempotency_key,
        identity=identity,
    )
    await db.commit()
    return AmountCheckSplitOut(
        order_id=order.id,
        parts=parts,
        total=sum(parts, Decimal("0")),
        idempotency_key=payload.idempotency_key,
    )


@router.post(
    "/{order_id}/discount-requests",
    response_model=ApprovalOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_discount_request(
    order_id: UUID,
    payload: DiscountRequestCreate,
    identity: DiscountRequester,
    db: DbSession,
) -> ApprovalOut:
    order = await _scoped_order(identity, db, order_id)
    approval = await request_discount(db, order=order, payload=payload, identity=identity)
    await db.commit()
    await db.refresh(approval)
    return ApprovalOut.model_validate(approval)


@router.post(
    "/{order_id}/cancellation-requests",
    response_model=ApprovalOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_cancellation_request(
    order_id: UUID,
    payload: CancellationRequestCreate,
    identity: OrderCreator,
    db: DbSession,
) -> ApprovalOut:
    order = await _scoped_order(identity, db, order_id)
    approval = await request_cancellation(
        db,
        order=order,
        order_item_id=payload.order_item_id,
        reason=payload.reason,
        identity=identity,
    )
    await db.commit()
    await db.refresh(approval)
    return ApprovalOut.model_validate(approval)


@router.post(
    "/cancellation-requests/{approval_id}/approve",
    response_model=ApprovalOut,
)
async def approve_cancellation_request(
    approval_id: UUID,
    request: Request,
    identity: OrderManager,
    db: DbSession,
) -> ApprovalOut:
    approval = await approve_cancellation(
        db,
        approval_id=approval_id,
        identity=identity,
    )
    await db.commit()
    await db.refresh(approval)
    if approval.order_id:
        order = await load_order(db, require_tenant(identity), approval.order_id)
        await _broadcast(request, order)
    return ApprovalOut.model_validate(approval)


@router.post("/discount-requests/{approval_id}/approve", response_model=ApprovalOut)
async def approve_discount_request(
    approval_id: UUID,
    request: Request,
    identity: DiscountApprover,
    db: DbSession,
) -> ApprovalOut:
    approval = await approve_discount(db, approval_id=approval_id, identity=identity)
    await db.commit()
    await db.refresh(approval)
    if approval.order_id:
        order = await load_order(db, require_tenant(identity), approval.order_id)
        await _broadcast(request, order)
    return ApprovalOut.model_validate(approval)


@router.post("/discount-requests/{approval_id}/reject", response_model=ApprovalOut)
async def reject_discount_request(
    approval_id: UUID,
    identity: DiscountApprover,
    db: DbSession,
) -> ApprovalOut:
    approval = await reject_discount(db, approval_id=approval_id, identity=identity)
    await db.commit()
    await db.refresh(approval)
    return ApprovalOut.model_validate(approval)


@router.post("/cancellation-requests/{approval_id}/reject", response_model=ApprovalOut)
async def reject_cancellation_request(
    approval_id: UUID,
    identity: OrderManager,
    db: DbSession,
) -> ApprovalOut:
    approval = await reject_cancellation(db, approval_id=approval_id, identity=identity)
    await db.commit()
    await db.refresh(approval)
    return ApprovalOut.model_validate(approval)
