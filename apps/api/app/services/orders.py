from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import cast
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.sql.elements import ColumnElement

from app.dependencies import Identity, require_branch
from app.errors import DomainError
from app.models import (
    ApprovalRequest,
    Cancellation,
    DiningTable,
    Discount,
    InventoryLocation,
    KitchenTicket,
    KitchenTicketItem,
    Modifier,
    Order,
    OrderItem,
    OrderItemModifier,
    OrderOperation,
    Payment,
    PreparationStation,
    PrinterDevice,
    PrintJob,
    Product,
    ProductModifierGroup,
    ProductRecipe,
    StockBalance,
    StockMovement,
    TableSession,
    Tenant,
)
from app.models.enums import (
    ApprovalStatus,
    ApprovalType,
    DiscountKind,
    KitchenTicketStatus,
    OrderItemStatus,
    OrderSource,
    OrderStatus,
    PaymentStatus,
    PrintJobKind,
    PrintJobStatus,
    StockMovementType,
    TableSessionStatus,
    TableState,
)
from app.schemas import DiscountRequestCreate, OrderCreate, OrderItemInput, PaymentCreate
from app.services.audit import add_audit_log
from app.services.loyalty import accrue_paid_order, reverse_order_redemptions

CENT = Decimal("0.01")


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


async def _station_printer_id(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    station_id: UUID,
) -> UUID | None:
    """Resolve the active device explicitly routed to a preparation station."""

    return (
        await db.execute(
            select(PrinterDevice.id)
            .where(
                PrinterDevice.tenant_id == tenant_id,
                PrinterDevice.branch_id == branch_id,
                PrinterDevice.preparation_station_id == station_id,
                PrinterDevice.is_active.is_(True),
            )
            .order_by(PrinterDevice.created_at)
            .limit(1)
        )
    ).scalar_one_or_none()


def _sellable_here(tenant_id: UUID, branch_id: UUID) -> ColumnElement[bool]:
    """Products a given branch is allowed to sell.

    Every product is owned by exactly one branch, so a till can never ring up a
    product that belongs to another location.
    """
    return Product.branch_id == branch_id


def _require_active_branch(identity: Identity, branch_id: UUID) -> None:
    """Block cross-branch approval actions until the operator switches branch."""
    if branch_id != require_branch(identity):
        raise DomainError("approval_not_found", "Approval request not found", status_code=404)


async def branch_station_map(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    station_ids: set[UUID],
) -> dict[UUID | None, UUID | None]:
    """Translate the catalogue's stations into this branch's own.

    A product belongs to the whole business but a preparation station belongs to
    one branch, so `Product.preparation_station_id` can only ever name one
    branch's grill. Left as-is, an order taken in Beşiktaş would carry Kadıköy's
    station id: its ticket would still surface on the right board (tickets are
    filtered by branch) but the station filter would never match it, and the
    printer lookup — which asks for a device in *this* branch routed to *that*
    station — would come back empty and the ticket would never print.

    The catalogue entry is therefore read as a template and matched to the local
    station by code, so "GRILL" means the grill of whichever branch is cooking.
    Falling back to the name covers stations created before codes were used.
    A station with no counterpart here resolves to None, exactly as an unset one
    does, which leaves the line off the kitchen board rather than on a stranger's.
    """
    # A product with no station of its own keeps having none here.
    resolved: dict[UUID | None, UUID | None] = {None: None}
    if not station_ids:
        return resolved
    sources = (
        (
            await db.execute(
                select(PreparationStation).where(
                    PreparationStation.tenant_id == tenant_id,
                    PreparationStation.id.in_(station_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    foreign = [station for station in sources if station.branch_id != branch_id]
    resolved.update(
        {station.id: station.id for station in sources if station.branch_id == branch_id}
    )
    if not foreign:
        return resolved

    local = (
        (
            await db.execute(
                select(PreparationStation).where(
                    PreparationStation.tenant_id == tenant_id,
                    PreparationStation.branch_id == branch_id,
                    PreparationStation.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    by_code = {station.code.casefold(): station.id for station in local}
    by_name = {station.name.casefold(): station.id for station in local}
    for station in foreign:
        resolved[station.id] = by_code.get(station.code.casefold()) or by_name.get(
            station.name.casefold()
        )
    return resolved


async def load_order(
    db: AsyncSession,
    tenant_id: UUID,
    order_id: UUID,
    *,
    lock: bool = False,
) -> Order:
    statement = (
        select(Order)
        .where(Order.id == order_id, Order.tenant_id == tenant_id)
        .options(
            selectinload(Order.table_session).selectinload(TableSession.table),
            selectinload(Order.items).selectinload(OrderItem.modifiers),
            selectinload(Order.payments),
        )
    )
    if lock:
        statement = statement.with_for_update()
    order = (await db.execute(statement)).scalar_one_or_none()
    if order is None:
        raise DomainError("order_not_found", "Order not found", status_code=404)
    return order


async def _get_or_create_table_session(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    table_id: UUID,
    actor_user_id: UUID | None,
    customer_name: str | None,
) -> TableSession:
    table = (
        await db.execute(
            select(DiningTable)
            .where(
                DiningTable.id == table_id,
                DiningTable.tenant_id == tenant_id,
                DiningTable.branch_id == branch_id,
                DiningTable.is_active.is_(True),
                DiningTable.state != TableState.DISABLED,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if table is None:
        raise DomainError("table_not_found", "Table not found", status_code=404)
    table_session = (
        await db.execute(
            select(TableSession).where(
                TableSession.tenant_id == tenant_id,
                TableSession.table_id == table.id,
                TableSession.status == TableSessionStatus.OPEN,
            )
        )
    ).scalar_one_or_none()
    if table_session is None:
        table_session = TableSession(
            tenant_id=tenant_id,
            branch_id=branch_id,
            table_id=table.id,
            opened_by_user_id=actor_user_id,
            customer_name=customer_name,
        )
        db.add(table_session)
        await db.flush()
    elif customer_name and not table_session.customer_name:
        table_session.customer_name = customer_name
    table.state = TableState.ORDER_PENDING
    table.version += 1
    return table_session


async def create_order(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    actor_user_id: UUID | None,
    payload: OrderCreate,
    source_override: OrderSource | None = None,
) -> tuple[Order, bool]:
    existing = (
        await db.execute(
            select(Order).where(
                Order.tenant_id == tenant_id,
                Order.idempotency_key == payload.idempotency_key,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return await load_order(db, tenant_id, existing.id), True

    table_session: TableSession | None = None
    if payload.table_id is not None:
        table_session = await _get_or_create_table_session(
            db,
            tenant_id=tenant_id,
            branch_id=branch_id,
            table_id=payload.table_id,
            actor_user_id=actor_user_id,
            customer_name=payload.customer_name,
        )
        active_order = (
            await db.execute(
                select(Order.id)
                .where(
                    Order.tenant_id == tenant_id,
                    Order.table_session_id == table_session.id,
                    Order.status.notin_(
                        [
                            OrderStatus.PAID,
                            OrderStatus.CANCELLED,
                            OrderStatus.VOIDED,
                        ]
                    ),
                )
                .order_by(Order.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if active_order is not None:
            order, _ = await append_order_items(
                db,
                tenant_id=tenant_id,
                order_id=active_order,
                actor_user_id=actor_user_id,
                items=payload.items,
                idempotency_key=payload.idempotency_key,
            )
            return order, False

    product_ids = {item.product_id for item in payload.items}
    products = (
        (
            await db.execute(
                select(Product).where(
                    Product.tenant_id == tenant_id,
                    Product.id.in_(product_ids),
                    Product.is_active.is_(True),
                    Product.is_available.is_(True),
                    _sellable_here(tenant_id, branch_id),
                )
            )
        )
        .scalars()
        .all()
    )
    product_map = {product.id: product for product in products}
    if len(product_map) != len(product_ids):
        raise DomainError(
            "product_not_available",
            "One or more products are unavailable",
            status_code=409,
        )

    modifier_ids = {modifier.modifier_id for item in payload.items for modifier in item.modifiers}
    modifiers = (
        (
            await db.execute(
                select(Modifier).where(
                    Modifier.tenant_id == tenant_id,
                    Modifier.id.in_(modifier_ids),
                    Modifier.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
        if modifier_ids
        else []
    )
    modifier_map = {modifier.id: modifier for modifier in modifiers}
    if len(modifier_map) != len(modifier_ids):
        raise DomainError(
            "modifier_not_found", "One or more modifiers were not found", status_code=404
        )

    if modifier_ids:
        group_links = (
            await db.execute(
                select(
                    ProductModifierGroup.product_id, ProductModifierGroup.modifier_group_id
                ).where(
                    ProductModifierGroup.tenant_id == tenant_id,
                    ProductModifierGroup.product_id.in_(product_ids),
                )
            )
        ).all()
        allowed_groups: dict[UUID, set[UUID]] = defaultdict(set)
        for product_id, group_id in group_links:
            allowed_groups[product_id].add(group_id)
        for item in payload.items:
            for selected in item.modifiers:
                modifier = modifier_map[selected.modifier_id]
                if modifier.group_id not in allowed_groups[item.product_id]:
                    raise DomainError(
                        "modifier_not_allowed",
                        "A selected modifier is not available for this product",
                        status_code=409,
                    )

    tenant = await db.get(Tenant, tenant_id)
    if tenant is None:
        raise DomainError("tenant_not_found", "Business not found", status_code=404)
    order = Order(
        tenant_id=tenant_id,
        branch_id=branch_id,
        table_session_id=table_session.id if table_session else None,
        created_by_user_id=actor_user_id,
        source=source_override or payload.source,
        status=OrderStatus.DRAFT,
        customer_name=payload.customer_name,
        currency=tenant.default_currency,
        idempotency_key=payload.idempotency_key,
    )
    db.add(order)
    await db.flush()

    station_map = await branch_station_map(
        db,
        tenant_id=tenant_id,
        branch_id=branch_id,
        station_ids={
            product.preparation_station_id
            for product in product_map.values()
            if product.preparation_station_id is not None
        },
    )

    subtotal = Decimal("0.00")
    for input_item in payload.items:
        product = product_map[input_item.product_id]
        modifier_total = sum(
            (
                modifier_map[selected.modifier_id].price_delta * selected.quantity
                for selected in input_item.modifiers
            ),
            Decimal("0.00"),
        )
        unit_price = money(product.selling_price + modifier_total)
        line_total = money(unit_price * input_item.quantity)
        order_item = OrderItem(
            tenant_id=tenant_id,
            branch_id=branch_id,
            order_id=order.id,
            product_id=product.id,
            preparation_station_id=station_map.get(product.preparation_station_id),
            product_name_snapshot=product.name,
            unit_price=unit_price,
            quantity=input_item.quantity,
            tax_rate_snapshot=product.tax_rate,
            line_total=line_total,
            status=OrderItemStatus.DRAFT,
            note=input_item.note,
        )
        db.add(order_item)
        await db.flush()
        for selected in input_item.modifiers:
            modifier = modifier_map[selected.modifier_id]
            db.add(
                OrderItemModifier(
                    tenant_id=tenant_id,
                    order_item_id=order_item.id,
                    modifier_id=modifier.id,
                    name_snapshot=modifier.name,
                    price_delta_snapshot=modifier.price_delta,
                    quantity=selected.quantity,
                )
            )
        subtotal += line_total
    order.subtotal = money(subtotal)
    order.total = money(subtotal)
    await db.flush()
    order = await load_order(db, tenant_id, order.id, lock=True)
    await submit_order(db, order)
    if payload.auto_accept:
        await accept_order(db, order, actor_user_id=actor_user_id)
    return await load_order(db, tenant_id, order.id), False


async def submit_order(db: AsyncSession, order: Order) -> Order:
    if order.status == OrderStatus.DRAFT:
        order.status = OrderStatus.SUBMITTED
        order.submitted_at = datetime.now(UTC)
        for item in order.items:
            if item.status == OrderItemStatus.DRAFT:
                item.status = OrderItemStatus.SUBMITTED
                item.submitted_at = order.submitted_at
        order.version += 1
        await db.flush()
    elif order.status != OrderStatus.SUBMITTED:
        raise DomainError(
            "invalid_order_transition",
            f"Order cannot be submitted from {order.status.value}",
            status_code=409,
        )
    return order


async def append_order_items(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    order_id: UUID,
    actor_user_id: UUID | None,
    items: list[OrderItemInput],
    idempotency_key: str,
) -> tuple[Order, bool]:
    operation = (
        await db.execute(
            select(OrderOperation).where(
                OrderOperation.tenant_id == tenant_id,
                OrderOperation.idempotency_key == idempotency_key,
            )
        )
    ).scalar_one_or_none()
    if operation is not None:
        if operation.order_id != order_id:
            raise DomainError(
                "idempotency_conflict",
                "Idempotency key was used for a different order",
                status_code=409,
            )
        return await load_order(db, tenant_id, order_id), True
    order = await load_order(db, tenant_id, order_id, lock=True)
    if order.status not in {
        OrderStatus.SUBMITTED,
        OrderStatus.ACCEPTED,
        OrderStatus.PREPARING,
        OrderStatus.PARTIALLY_READY,
        OrderStatus.READY,
        OrderStatus.SERVED,
    }:
        raise DomainError(
            "order_not_editable",
            f"Items cannot be added while order is {order.status.value}",
            status_code=409,
        )
    product_ids = {item.product_id for item in items}
    products = (
        (
            await db.execute(
                select(Product).where(
                    Product.tenant_id == tenant_id,
                    Product.id.in_(product_ids),
                    Product.is_active.is_(True),
                    Product.is_available.is_(True),
                    _sellable_here(tenant_id, order.branch_id),
                )
            )
        )
        .scalars()
        .all()
    )
    product_map = {product.id: product for product in products}
    if len(product_map) != len(product_ids):
        raise DomainError(
            "product_not_available",
            "One or more products are unavailable",
            status_code=409,
        )
    modifier_ids = {selected.modifier_id for item in items for selected in item.modifiers}
    modifier_map: dict[UUID, Modifier] = {}
    if modifier_ids:
        modifiers = (
            (
                await db.execute(
                    select(Modifier).where(
                        Modifier.tenant_id == tenant_id,
                        Modifier.id.in_(modifier_ids),
                        Modifier.is_active.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )
        modifier_map = {modifier.id: modifier for modifier in modifiers}
        if len(modifier_map) != len(modifier_ids):
            raise DomainError(
                "modifier_not_found",
                "One or more modifiers were not found",
                status_code=404,
            )
        links = (
            await db.execute(
                select(
                    ProductModifierGroup.product_id,
                    ProductModifierGroup.modifier_group_id,
                ).where(
                    ProductModifierGroup.tenant_id == tenant_id,
                    ProductModifierGroup.product_id.in_(product_ids),
                )
            )
        ).all()
        allowed: dict[UUID, set[UUID]] = defaultdict(set)
        for product_id, group_id in links:
            allowed[product_id].add(group_id)
        for item in items:
            for selected in item.modifiers:
                if modifier_map[selected.modifier_id].group_id not in allowed[item.product_id]:
                    raise DomainError(
                        "modifier_not_allowed",
                        "A selected modifier is not available for this product",
                        status_code=409,
                    )

    station_map = await branch_station_map(
        db,
        tenant_id=tenant_id,
        branch_id=order.branch_id,
        station_ids={
            product.preparation_station_id
            for product in product_map.values()
            if product.preparation_station_id is not None
        },
    )

    new_items: list[OrderItem] = []
    subtotal_delta = Decimal("0.00")
    now = datetime.now(UTC)
    for input_item in items:
        product = product_map[input_item.product_id]
        modifier_total = sum(
            (
                modifier_map[selected.modifier_id].price_delta * selected.quantity
                for selected in input_item.modifiers
            ),
            Decimal("0.00"),
        )
        unit_price = money(product.selling_price + modifier_total)
        line_total = money(unit_price * input_item.quantity)
        order_item = OrderItem(
            tenant_id=tenant_id,
            branch_id=order.branch_id,
            order=order,
            product_id=product.id,
            preparation_station_id=station_map.get(product.preparation_station_id),
            product_name_snapshot=product.name,
            unit_price=unit_price,
            quantity=input_item.quantity,
            tax_rate_snapshot=product.tax_rate,
            line_total=line_total,
            status=OrderItemStatus.SUBMITTED,
            note=input_item.note,
            submitted_at=now,
        )
        db.add(order_item)
        await db.flush()
        for selected in input_item.modifiers:
            modifier = modifier_map[selected.modifier_id]
            selected_modifier = OrderItemModifier(
                tenant_id=tenant_id,
                order_item=order_item,
                modifier_id=modifier.id,
                name_snapshot=modifier.name,
                price_delta_snapshot=modifier.price_delta,
                quantity=selected.quantity,
            )
            db.add(selected_modifier)
        new_items.append(order_item)
        subtotal_delta += line_total
    order.subtotal = money(order.subtotal + subtotal_delta)
    order.total = money(order.subtotal - order.discount_total + order.tax_total)
    await db.flush()

    # Existing movement keys make this safe for every previously accepted item.
    await _deduct_inventory(db, order=order, actor_user_id=actor_user_id)
    by_station: dict[UUID, list[OrderItem]] = defaultdict(list)
    for order_item in new_items:
        order_item.status = OrderItemStatus.ACCEPTED
        if order_item.preparation_station_id:
            by_station[order_item.preparation_station_id].append(order_item)
    for station_id, station_items in by_station.items():
        highest_batch = (
            await db.execute(
                select(func.coalesce(func.max(KitchenTicket.batch_number), 0)).where(
                    KitchenTicket.tenant_id == tenant_id,
                    KitchenTicket.order_id == order.id,
                    KitchenTicket.preparation_station_id == station_id,
                )
            )
        ).scalar_one()
        ticket = KitchenTicket(
            tenant_id=tenant_id,
            branch_id=order.branch_id,
            order_id=order.id,
            preparation_station_id=station_id,
            batch_number=int(highest_batch) + 1,
            status=KitchenTicketStatus.NEW,
        )
        db.add(ticket)
        await db.flush()
        for order_item in station_items:
            db.add(
                KitchenTicketItem(
                    tenant_id=tenant_id,
                    branch_id=order.branch_id,
                    ticket_id=ticket.id,
                    order_item_id=order_item.id,
                    status=OrderItemStatus.ACCEPTED,
                )
            )
        print_key = f"order-append:{idempotency_key}:station:{station_id}"
        printer_device_id = await _station_printer_id(
            db,
            tenant_id=tenant_id,
            branch_id=order.branch_id,
            station_id=station_id,
        )
        db.add(
            PrintJob(
                tenant_id=tenant_id,
                branch_id=order.branch_id,
                preparation_station_id=station_id,
                printer_device_id=printer_device_id,
                order_id=order.id,
                kitchen_ticket_id=ticket.id,
                payload={
                    "order_id": str(order.id),
                    "ticket_id": str(ticket.id),
                    "batch_number": ticket.batch_number,
                    "new_items_only": True,
                    "items": [
                        {
                            "name": order_item.product_name_snapshot,
                            "quantity": str(order_item.quantity),
                            "note": order_item.note,
                        }
                        for order_item in station_items
                    ],
                },
                status=PrintJobStatus.PENDING,
                kind=PrintJobKind.ORIGINAL,
                idempotency_key=print_key,
            )
        )
    operation = OrderOperation(
        tenant_id=tenant_id,
        branch_id=order.branch_id,
        order_id=order.id,
        actor_user_id=actor_user_id,
        operation="APPEND_ITEMS",
        idempotency_key=idempotency_key,
        result={"item_ids": [str(item.id) for item in new_items]},
    )
    db.add(operation)
    order.status = OrderStatus.ACCEPTED
    order.version += 1
    operation.result["order_version"] = order.version
    if order.table_session_id:
        table_session = await db.get(TableSession, order.table_session_id)
        if table_session:
            table = await db.get(DiningTable, table_session.table_id)
            if table:
                table.state = TableState.PREPARING
                table.version += 1
    await db.flush()
    return await load_order(db, tenant_id, order.id), False


async def _deduct_inventory(
    db: AsyncSession,
    *,
    order: Order,
    actor_user_id: UUID | None,
) -> None:
    tenant = await db.get(Tenant, order.tenant_id)
    assert tenant is not None
    location = (
        await db.execute(
            select(InventoryLocation).where(
                InventoryLocation.tenant_id == order.tenant_id,
                InventoryLocation.branch_id == order.branch_id,
                InventoryLocation.is_default.is_(True),
                InventoryLocation.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()

    for order_item in order.items:
        product = await db.get(Product, order_item.product_id)
        if product is None or not product.track_inventory:
            continue
        recipe = (
            await db.execute(
                select(ProductRecipe)
                .where(
                    ProductRecipe.tenant_id == order.tenant_id,
                    ProductRecipe.branch_id == order.branch_id,
                    ProductRecipe.product_id == order_item.product_id,
                    ProductRecipe.is_active.is_(True),
                )
                .options(selectinload(ProductRecipe.items))
            )
        ).scalar_one_or_none()
        if recipe is None:
            raise DomainError(
                "recipe_missing",
                f"Inventory-tracked product '{order_item.product_name_snapshot}' has no recipe",
                status_code=409,
            )
        if location is None:
            raise DomainError(
                "inventory_location_missing",
                "No default inventory location is configured",
                status_code=409,
            )
        for recipe_item in recipe.items:
            idempotency_key = (
                f"order:{order.id}:item:{order_item.id}:ingredient:{recipe_item.inventory_item_id}"
            )
            existing = (
                await db.execute(
                    select(StockMovement.id).where(
                        StockMovement.tenant_id == order.tenant_id,
                        StockMovement.idempotency_key == idempotency_key,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                continue
            required = (
                recipe_item.quantity * order_item.quantity / recipe.yield_quantity
            ).quantize(Decimal("0.000001"))
            balance = (
                await db.execute(
                    select(StockBalance)
                    .where(
                        StockBalance.tenant_id == order.tenant_id,
                        StockBalance.branch_id == order.branch_id,
                        StockBalance.inventory_item_id == recipe_item.inventory_item_id,
                        StockBalance.location_id == location.id,
                    )
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if balance is None:
                raise DomainError(
                    "stock_balance_missing",
                    "A recipe ingredient has no stock balance",
                    status_code=409,
                )
            new_balance = balance.quantity - required
            if tenant.prevent_negative_stock and new_balance < 0:
                raise DomainError(
                    "insufficient_stock",
                    "Insufficient stock for this order",
                    status_code=409,
                    details={"inventory_item_id": str(recipe_item.inventory_item_id)},
                )
            balance.quantity = new_balance
            balance.version += 1
            db.add(
                StockMovement(
                    tenant_id=order.tenant_id,
                    branch_id=order.branch_id,
                    inventory_item_id=recipe_item.inventory_item_id,
                    location_id=location.id,
                    order_item_id=order_item.id,
                    actor_user_id=actor_user_id,
                    movement_type=StockMovementType.SALE,
                    quantity_delta=-required,
                    balance_after=new_balance,
                    idempotency_key=idempotency_key,
                    reason=f"Order {order.id}",
                )
            )


async def accept_order(
    db: AsyncSession,
    order: Order,
    *,
    actor_user_id: UUID | None,
) -> Order:
    if order.status in {
        OrderStatus.ACCEPTED,
        OrderStatus.PREPARING,
        OrderStatus.PARTIALLY_READY,
        OrderStatus.READY,
        OrderStatus.SERVED,
        OrderStatus.BILL_REQUESTED,
        OrderStatus.PAYMENT_PENDING,
        OrderStatus.PAID,
    }:
        return order
    if order.status not in {OrderStatus.SUBMITTED, OrderStatus.AWAITING_APPROVAL}:
        raise DomainError(
            "invalid_order_transition",
            f"Order cannot be accepted from {order.status.value}",
            status_code=409,
        )
    await _deduct_inventory(db, order=order, actor_user_id=actor_user_id)
    tickets_by_station: dict[UUID, list[OrderItem]] = defaultdict(list)
    for item in order.items:
        item.status = OrderItemStatus.ACCEPTED
        if item.preparation_station_id is not None:
            tickets_by_station[item.preparation_station_id].append(item)
    for station_id, items in tickets_by_station.items():
        ticket = (
            await db.execute(
                select(KitchenTicket).where(
                    KitchenTicket.tenant_id == order.tenant_id,
                    KitchenTicket.order_id == order.id,
                    KitchenTicket.preparation_station_id == station_id,
                )
            )
        ).scalar_one_or_none()
        if ticket is None:
            ticket = KitchenTicket(
                tenant_id=order.tenant_id,
                branch_id=order.branch_id,
                order_id=order.id,
                preparation_station_id=station_id,
                status=KitchenTicketStatus.NEW,
            )
            db.add(ticket)
            await db.flush()
        for item in items:
            existing_item = (
                await db.execute(
                    select(KitchenTicketItem.id).where(
                        KitchenTicketItem.ticket_id == ticket.id,
                        KitchenTicketItem.order_item_id == item.id,
                    )
                )
            ).scalar_one_or_none()
            if existing_item is None:
                db.add(
                    KitchenTicketItem(
                        tenant_id=order.tenant_id,
                        branch_id=order.branch_id,
                        ticket_id=ticket.id,
                        order_item_id=item.id,
                        status=OrderItemStatus.ACCEPTED,
                    )
                )
        print_key = f"kitchen-ticket:{ticket.id}:original"
        existing_job = (
            await db.execute(
                select(PrintJob.id).where(
                    PrintJob.tenant_id == order.tenant_id,
                    PrintJob.idempotency_key == print_key,
                )
            )
        ).scalar_one_or_none()
        if existing_job is None:
            printer_device_id = await _station_printer_id(
                db,
                tenant_id=order.tenant_id,
                branch_id=order.branch_id,
                station_id=station_id,
            )
            db.add(
                PrintJob(
                    tenant_id=order.tenant_id,
                    branch_id=order.branch_id,
                    preparation_station_id=station_id,
                    printer_device_id=printer_device_id,
                    order_id=order.id,
                    kitchen_ticket_id=ticket.id,
                    payload={
                        "order_id": str(order.id),
                        "ticket_id": str(ticket.id),
                        "items": [
                            {
                                "name": item.product_name_snapshot,
                                "quantity": str(item.quantity),
                                "note": item.note,
                            }
                            for item in items
                        ],
                    },
                    status=PrintJobStatus.PENDING,
                    kind=PrintJobKind.ORIGINAL,
                    idempotency_key=print_key,
                )
            )
    order.status = OrderStatus.ACCEPTED
    order.accepted_at = datetime.now(UTC)
    order.version += 1
    if order.table_session_id:
        table_session = await db.get(TableSession, order.table_session_id)
        if table_session:
            table = await db.get(DiningTable, table_session.table_id)
            if table:
                table.state = TableState.PREPARING
                table.version += 1
    await db.flush()
    return order


async def add_payment(
    db: AsyncSession,
    *,
    order: Order,
    payload: PaymentCreate,
    actor_user_id: UUID,
) -> Payment:
    existing = (
        await db.execute(
            select(Payment).where(
                Payment.tenant_id == order.tenant_id,
                Payment.idempotency_key == payload.idempotency_key,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    if order.status in {OrderStatus.CANCELLED, OrderStatus.VOIDED}:
        raise DomainError("order_not_payable", "Order cannot be paid", status_code=409)
    paid = (
        await db.execute(
            select(func.coalesce(func.sum(Payment.amount), 0)).where(
                Payment.tenant_id == order.tenant_id,
                Payment.order_id == order.id,
                Payment.status == PaymentStatus.COMPLETED,
            )
        )
    ).scalar_one()
    remaining = money(order.total - Decimal(paid))
    if payload.amount > remaining:
        raise DomainError(
            "payment_exceeds_balance",
            "Payment exceeds the remaining balance",
            status_code=409,
            details={"remaining": str(remaining)},
        )
    payment = Payment(
        tenant_id=order.tenant_id,
        branch_id=order.branch_id,
        order_id=order.id,
        recorded_by_user_id=actor_user_id,
        method=payload.method,
        amount=payload.amount,
        status=PaymentStatus.COMPLETED,
        idempotency_key=payload.idempotency_key,
        reference=payload.reference,
    )
    db.add(payment)
    await db.flush()
    if money(Decimal(paid) + payload.amount) >= order.total:
        order.status = OrderStatus.PAID
        order.paid_at = datetime.now(UTC)
        if order.table_session_id:
            table_session = await db.get(TableSession, order.table_session_id)
            other_open_checks = (
                await db.execute(
                    select(func.count(Order.id)).where(
                        Order.tenant_id == order.tenant_id,
                        Order.table_session_id == order.table_session_id,
                        Order.id != order.id,
                        Order.status.notin_(
                            [
                                OrderStatus.PAID,
                                OrderStatus.CANCELLED,
                                OrderStatus.VOIDED,
                            ]
                        ),
                    )
                )
            ).scalar_one()
            if (
                table_session
                and table_session.status == TableSessionStatus.OPEN
                and not other_open_checks
            ):
                table = await db.get(DiningTable, table_session.table_id)
                if table:
                    # The check is settled, but the physical table is released
                    # only after an operator explicitly closes this session.
                    table.state = TableState.CLEANING
                    table.version += 1
        await accrue_paid_order(
            db,
            order=order,
            actor_user_id=actor_user_id,
        )
    else:
        order.status = OrderStatus.PAYMENT_PENDING
    order.version += 1
    return payment


async def list_approval_requests(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    status: ApprovalStatus | None = None,
    approval_type: ApprovalType | None = None,
    limit: int = 200,
) -> list[ApprovalRequest]:
    predicates = [
        ApprovalRequest.tenant_id == tenant_id,
        ApprovalRequest.branch_id == branch_id,
    ]
    if status is not None:
        predicates.append(ApprovalRequest.status == status)
    if approval_type is not None:
        predicates.append(ApprovalRequest.approval_type == approval_type)
    rows = (
        (
            await db.execute(
                select(ApprovalRequest)
                .where(*predicates)
                .order_by(ApprovalRequest.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def count_pending_approval_requests(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
) -> int:
    return (
        await db.execute(
            select(func.count(ApprovalRequest.id)).where(
                ApprovalRequest.tenant_id == tenant_id,
                ApprovalRequest.branch_id == branch_id,
                ApprovalRequest.status == ApprovalStatus.PENDING,
            )
        )
    ).scalar_one()


async def request_discount(
    db: AsyncSession,
    *,
    order: Order,
    payload: DiscountRequestCreate,
    identity: Identity,
) -> ApprovalRequest:
    if payload.order_item_id is not None and all(
        item.id != payload.order_item_id for item in order.items
    ):
        raise DomainError("order_item_not_found", "Order item not found", status_code=404)
    if payload.kind == DiscountKind.PERCENTAGE and payload.value > 100:
        raise DomainError("invalid_discount", "Percentage cannot exceed 100", status_code=422)
    approval = ApprovalRequest(
        tenant_id=order.tenant_id,
        branch_id=order.branch_id,
        order_id=order.id,
        order_item_id=payload.order_item_id,
        requested_by_user_id=identity.user_id,
        approval_type=ApprovalType.DISCOUNT,
        status=ApprovalStatus.PENDING,
        payload={"kind": payload.kind.value, "value": str(payload.value)},
        reason=payload.reason,
    )
    db.add(approval)
    add_audit_log(
        db,
        identity=identity,
        action="discount.requested",
        resource_type="approval_request",
        resource_id=approval.id,
        reason=payload.reason,
    )
    await db.flush()
    return approval


async def approve_discount(
    db: AsyncSession,
    *,
    approval_id: UUID,
    identity: Identity,
) -> ApprovalRequest:
    approval = (
        await db.execute(
            select(ApprovalRequest)
            .where(
                ApprovalRequest.id == approval_id,
                ApprovalRequest.tenant_id == identity.tenant_id,
                ApprovalRequest.approval_type == ApprovalType.DISCOUNT,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if approval is None:
        raise DomainError("approval_not_found", "Approval request not found", status_code=404)
    _require_active_branch(identity, approval.branch_id)
    if approval.status != ApprovalStatus.PENDING:
        return approval
    if approval.order_id is None:
        raise DomainError("invalid_approval", "Approval has no order", status_code=409)
    order = await load_order(db, approval.tenant_id, approval.order_id, lock=True)
    kind = DiscountKind(str(approval.payload["kind"]))
    value = Decimal(str(approval.payload["value"]))
    if approval.order_item_id:
        item = next((item for item in order.items if item.id == approval.order_item_id), None)
        if item is None:
            raise DomainError("order_item_not_found", "Order item not found", status_code=404)
        base = item.line_total
    else:
        base = order.subtotal
    amount = (
        money(base * value / Decimal("100")) if kind == DiscountKind.PERCENTAGE else money(value)
    )
    amount = min(amount, base)
    db.add(
        Discount(
            tenant_id=order.tenant_id,
            branch_id=order.branch_id,
            order_id=order.id,
            order_item_id=approval.order_item_id,
            requested_by_user_id=approval.requested_by_user_id,
            approved_by_user_id=identity.user_id,
            kind=kind,
            value=value,
            amount=amount,
            reason=approval.reason,
        )
    )
    order.discount_total = money(order.discount_total + amount)
    order.total = money(max(Decimal("0"), order.subtotal - order.discount_total + order.tax_total))
    order.version += 1
    approval.status = ApprovalStatus.APPROVED
    approval.resolved_by_user_id = identity.user_id
    approval.resolved_at = datetime.now(UTC)
    add_audit_log(
        db,
        identity=identity,
        action="discount.approved",
        resource_type="order",
        resource_id=order.id,
        new_value={"discount_amount": str(amount), "total": str(order.total)},
        reason=approval.reason,
    )
    return approval


async def reject_cancellation(
    db: AsyncSession,
    *,
    approval_id: UUID,
    identity: Identity,
) -> ApprovalRequest:
    approval = (
        await db.execute(
            select(ApprovalRequest)
            .where(
                ApprovalRequest.id == approval_id,
                ApprovalRequest.tenant_id == identity.tenant_id,
                ApprovalRequest.approval_type.in_(
                    [ApprovalType.ITEM_CANCELLATION, ApprovalType.ORDER_VOID]
                ),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if approval is None:
        raise DomainError("approval_not_found", "Approval request not found", status_code=404)
    _require_active_branch(identity, approval.branch_id)
    if approval.status != ApprovalStatus.PENDING:
        return approval
    approval.status = ApprovalStatus.REJECTED
    approval.resolved_by_user_id = identity.user_id
    approval.resolved_at = datetime.now(UTC)
    add_audit_log(
        db,
        identity=identity,
        action="cancellation.rejected",
        resource_type="approval_request",
        resource_id=approval.id,
        reason=approval.reason,
    )
    return approval


async def reject_discount(
    db: AsyncSession,
    *,
    approval_id: UUID,
    identity: Identity,
) -> ApprovalRequest:
    approval = (
        await db.execute(
            select(ApprovalRequest)
            .where(
                ApprovalRequest.id == approval_id,
                ApprovalRequest.tenant_id == identity.tenant_id,
                ApprovalRequest.approval_type == ApprovalType.DISCOUNT,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if approval is None:
        raise DomainError("approval_not_found", "Approval request not found", status_code=404)
    _require_active_branch(identity, approval.branch_id)
    if approval.status != ApprovalStatus.PENDING:
        return approval
    approval.status = ApprovalStatus.REJECTED
    approval.resolved_by_user_id = identity.user_id
    approval.resolved_at = datetime.now(UTC)
    add_audit_log(
        db,
        identity=identity,
        action="discount.rejected",
        resource_type="approval_request",
        resource_id=approval.id,
        reason=approval.reason,
    )
    return approval


async def transfer_order_table(
    db: AsyncSession,
    *,
    order: Order,
    destination_table_id: UUID,
    reason: str,
    identity: Identity,
) -> Order:
    if order.table_session_id is None:
        raise DomainError(
            "table_session_missing", "Order is not assigned to a table", status_code=409
        )
    table_session = await db.get(TableSession, order.table_session_id)
    if table_session is None or table_session.status != TableSessionStatus.OPEN:
        raise DomainError("table_session_closed", "Table session is not open", status_code=409)
    source_table = await db.get(DiningTable, table_session.table_id)
    destination = (
        await db.execute(
            select(DiningTable)
            .where(
                DiningTable.id == destination_table_id,
                DiningTable.tenant_id == order.tenant_id,
                DiningTable.branch_id == order.branch_id,
                DiningTable.is_active.is_(True),
                DiningTable.state == TableState.AVAILABLE,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if source_table is None or destination is None:
        raise DomainError(
            "destination_table_unavailable", "Destination table is unavailable", status_code=409
        )
    previous_table_id = table_session.table_id
    table_session.table_id = destination.id
    source_table.state = TableState.AVAILABLE
    source_table.version += 1
    destination.state = (
        TableState.READY
        if order.status in {OrderStatus.READY, OrderStatus.PARTIALLY_READY}
        else TableState.PREPARING
    )
    destination.version += 1
    order.version += 1
    add_audit_log(
        db,
        identity=identity,
        action="table.transferred",
        resource_type="order",
        resource_id=order.id,
        previous_value={"table_id": str(previous_table_id)},
        new_value={"table_id": str(destination.id)},
        reason=reason,
    )
    return order


async def merge_table_order(
    db: AsyncSession,
    *,
    source_order: Order,
    destination_table_id: UUID,
    idempotency_key: str,
    reason: str,
    identity: Identity,
) -> Order:
    existing_operation = (
        await db.execute(
            select(OrderOperation).where(
                OrderOperation.tenant_id == source_order.tenant_id,
                OrderOperation.idempotency_key == idempotency_key,
            )
        )
    ).scalar_one_or_none()
    if existing_operation is not None:
        destination_id = UUID(str(existing_operation.result["destination_order_id"]))
        return await load_order(db, source_order.tenant_id, destination_id)
    destination_table = (
        await db.execute(
            select(DiningTable).where(
                DiningTable.id == destination_table_id,
                DiningTable.tenant_id == source_order.tenant_id,
                DiningTable.branch_id == source_order.branch_id,
                DiningTable.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if destination_table is None:
        raise DomainError(
            "destination_table_not_found", "Destination table not found", status_code=404
        )
    destination_session = (
        await db.execute(
            select(TableSession).where(
                TableSession.tenant_id == source_order.tenant_id,
                TableSession.table_id == destination_table.id,
                TableSession.status == TableSessionStatus.OPEN,
            )
        )
    ).scalar_one_or_none()
    if destination_session is None:
        await transfer_order_table(
            db,
            order=source_order,
            destination_table_id=destination_table_id,
            reason=reason,
            identity=identity,
        )
        db.add(
            OrderOperation(
                tenant_id=source_order.tenant_id,
                branch_id=source_order.branch_id,
                order_id=source_order.id,
                actor_user_id=identity.user_id,
                operation="TABLE_MERGE_AS_TRANSFER",
                idempotency_key=idempotency_key,
                result={"destination_order_id": str(source_order.id)},
            )
        )
        return source_order
    destination_order_id = (
        await db.execute(
            select(Order.id)
            .where(
                Order.tenant_id == source_order.tenant_id,
                Order.table_session_id == destination_session.id,
                Order.status.notin_([OrderStatus.PAID, OrderStatus.CANCELLED, OrderStatus.VOIDED]),
            )
            .order_by(Order.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if destination_order_id is None:
        raise DomainError(
            "destination_order_missing",
            "Destination table has no active order",
            status_code=409,
        )
    if destination_order_id == source_order.id:
        raise DomainError("same_order_merge", "Order is already on this table", status_code=409)
    destination_order = await load_order(
        db, source_order.tenant_id, destination_order_id, lock=True
    )
    paid_count = (
        await db.execute(
            select(func.count(Payment.id)).where(
                Payment.tenant_id == source_order.tenant_id,
                Payment.order_id.in_([source_order.id, destination_order.id]),
                Payment.status == PaymentStatus.COMPLETED,
            )
        )
    ).scalar_one()
    if paid_count or source_order.discount_total:
        raise DomainError(
            "merge_financial_conflict",
            "Orders with payments or source discounts cannot be merged",
            status_code=409,
        )
    transferred_total = Decimal("0.00")
    for item in source_order.items:
        if item.status in {OrderItemStatus.CANCELLED, OrderItemStatus.VOIDED}:
            continue
        clone = OrderItem(
            tenant_id=item.tenant_id,
            branch_id=item.branch_id,
            order_id=destination_order.id,
            product_id=item.product_id,
            preparation_station_id=item.preparation_station_id,
            product_name_snapshot=item.product_name_snapshot,
            unit_price=item.unit_price,
            quantity=item.quantity,
            tax_rate_snapshot=item.tax_rate_snapshot,
            discount_snapshot=item.discount_snapshot,
            line_total=item.line_total,
            status=item.status,
            note=item.note,
            submitted_at=item.submitted_at,
        )
        db.add(clone)
        await db.flush()
        for modifier in item.modifiers:
            db.add(
                OrderItemModifier(
                    tenant_id=modifier.tenant_id,
                    order_item_id=clone.id,
                    modifier_id=modifier.modifier_id,
                    name_snapshot=modifier.name_snapshot,
                    price_delta_snapshot=modifier.price_delta_snapshot,
                    quantity=modifier.quantity,
                )
            )
        item.status = OrderItemStatus.VOIDED
        transferred_total += item.line_total
    destination_order.subtotal = money(destination_order.subtotal + transferred_total)
    destination_order.total = money(
        destination_order.subtotal - destination_order.discount_total + destination_order.tax_total
    )
    destination_order.version += 1
    source_order.status = OrderStatus.VOIDED
    source_order.version += 1
    if source_order.table_session_id:
        source_session = await db.get(TableSession, source_order.table_session_id)
        if source_session:
            source_session.status = TableSessionStatus.CLOSED
            source_session.closed_at = datetime.now(UTC)
            source_table = await db.get(DiningTable, source_session.table_id)
            if source_table:
                source_table.state = TableState.AVAILABLE
                source_table.version += 1
    destination_table.state = TableState.PREPARING
    destination_table.version += 1
    db.add(
        OrderOperation(
            tenant_id=source_order.tenant_id,
            branch_id=source_order.branch_id,
            order_id=source_order.id,
            actor_user_id=identity.user_id,
            operation="TABLE_MERGE",
            idempotency_key=idempotency_key,
            result={"destination_order_id": str(destination_order.id)},
        )
    )
    add_audit_log(
        db,
        identity=identity,
        action="table.merged",
        resource_type="order",
        resource_id=source_order.id,
        new_value={"destination_order_id": str(destination_order.id)},
        reason=reason,
    )
    await db.flush()
    return await load_order(db, source_order.tenant_id, destination_order.id)


async def split_check_by_items(
    db: AsyncSession,
    *,
    order: Order,
    item_ids: list[UUID],
    idempotency_key: str,
    identity: Identity,
) -> Order:
    existing_operation = (
        await db.execute(
            select(OrderOperation).where(
                OrderOperation.tenant_id == order.tenant_id,
                OrderOperation.idempotency_key == idempotency_key,
            )
        )
    ).scalar_one_or_none()
    if existing_operation is not None:
        split_order_id = UUID(str(existing_operation.result["split_order_id"]))
        return await load_order(db, order.tenant_id, split_order_id)
    selected_ids = set(item_ids)
    selected_items = [item for item in order.items if item.id in selected_ids]
    if len(selected_items) != len(selected_ids):
        raise DomainError(
            "order_item_not_found", "One or more order items were not found", status_code=404
        )
    active_items = [
        item
        for item in order.items
        if item.status not in {OrderItemStatus.CANCELLED, OrderItemStatus.VOIDED}
    ]
    if len(selected_items) >= len(active_items):
        raise DomainError(
            "invalid_check_split",
            "At least one item must remain on the original check",
            status_code=409,
        )
    payment_count = (
        await db.execute(
            select(func.count(Payment.id)).where(
                Payment.order_id == order.id,
                Payment.status == PaymentStatus.COMPLETED,
            )
        )
    ).scalar_one()
    if payment_count or order.discount_total:
        raise DomainError(
            "split_financial_conflict",
            "Checks with payments or discounts cannot be split by item",
            status_code=409,
        )
    split_subtotal = money(sum((item.line_total for item in selected_items), Decimal("0")))
    split_order = Order(
        tenant_id=order.tenant_id,
        branch_id=order.branch_id,
        table_session_id=order.table_session_id,
        created_by_user_id=identity.user_id,
        source=order.source,
        status=order.status,
        customer_name=order.customer_name,
        currency=order.currency,
        subtotal=split_subtotal,
        total=split_subtotal,
        idempotency_key=f"item-split:{idempotency_key}",
        submitted_at=order.submitted_at,
        accepted_at=order.accepted_at,
    )
    db.add(split_order)
    await db.flush()
    for item in selected_items:
        item.order_id = split_order.id
    order.subtotal = money(order.subtotal - split_subtotal)
    order.total = money(order.subtotal - order.discount_total + order.tax_total)
    order.version += 1
    db.add(
        OrderOperation(
            tenant_id=order.tenant_id,
            branch_id=order.branch_id,
            order_id=order.id,
            actor_user_id=identity.user_id,
            operation="CHECK_SPLIT_ITEMS",
            idempotency_key=idempotency_key,
            result={"split_order_id": str(split_order.id)},
        )
    )
    add_audit_log(
        db,
        identity=identity,
        action="check.split_by_items",
        resource_type="order",
        resource_id=order.id,
        new_value={
            "split_order_id": str(split_order.id),
            "item_ids": [str(item_id) for item_id in selected_ids],
        },
    )
    await db.flush()
    return await load_order(db, order.tenant_id, split_order.id)


async def plan_amount_split(
    db: AsyncSession,
    *,
    order: Order,
    parts: list[Decimal],
    idempotency_key: str,
    identity: Identity,
) -> list[Decimal]:
    existing = (
        await db.execute(
            select(OrderOperation).where(
                OrderOperation.tenant_id == order.tenant_id,
                OrderOperation.idempotency_key == idempotency_key,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        stored_parts = cast(list[object], existing.result["parts"])
        return [Decimal(str(part)) for part in stored_parts]
    paid = (
        await db.execute(
            select(func.coalesce(func.sum(Payment.amount), 0)).where(
                Payment.order_id == order.id,
                Payment.status == PaymentStatus.COMPLETED,
            )
        )
    ).scalar_one()
    remaining = money(order.total - Decimal(paid))
    normalized = [money(part) for part in parts]
    if money(sum(normalized, Decimal("0"))) != remaining:
        raise DomainError(
            "invalid_amount_split",
            "Split amounts must equal the remaining order balance",
            status_code=409,
            details={"remaining": str(remaining)},
        )
    db.add(
        OrderOperation(
            tenant_id=order.tenant_id,
            branch_id=order.branch_id,
            order_id=order.id,
            actor_user_id=identity.user_id,
            operation="CHECK_SPLIT_AMOUNT",
            idempotency_key=idempotency_key,
            result={"parts": [str(part) for part in normalized]},
        )
    )
    add_audit_log(
        db,
        identity=identity,
        action="check.split_by_amount",
        resource_type="order",
        resource_id=order.id,
        new_value={"parts": [str(part) for part in normalized]},
    )
    return normalized


async def request_cancellation(
    db: AsyncSession,
    *,
    order: Order,
    order_item_id: UUID | None,
    reason: str,
    identity: Identity,
) -> ApprovalRequest:
    if order_item_id is not None and all(item.id != order_item_id for item in order.items):
        raise DomainError("order_item_not_found", "Order item not found", status_code=404)
    approval = ApprovalRequest(
        tenant_id=order.tenant_id,
        branch_id=order.branch_id,
        order_id=order.id,
        order_item_id=order_item_id,
        requested_by_user_id=identity.user_id,
        approval_type=(
            ApprovalType.ITEM_CANCELLATION if order_item_id is not None else ApprovalType.ORDER_VOID
        ),
        status=ApprovalStatus.PENDING,
        payload={},
        reason=reason,
    )
    db.add(approval)
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="cancellation.requested",
        resource_type="approval_request",
        resource_id=approval.id,
        reason=reason,
    )
    return approval


async def _release_table_if_no_open_checks(db: AsyncSession, order: Order) -> None:
    """Move the table to CLEANING once its last live check goes away.

    Without this a voided or fully cancelled order leaves the table parked in
    whatever state the kitchen last set (PREPARING, READY, ...) with nothing
    open on it, so the floor shows a busy table that no longer exists. Mirrors
    what settling a check already does, and stops short of closing the session:
    releasing the physical table stays an explicit operator action.
    """
    if not order.table_session_id:
        return
    table_session = await db.get(TableSession, order.table_session_id)
    if table_session is None or table_session.status != TableSessionStatus.OPEN:
        return
    other_open_checks = (
        await db.execute(
            select(func.count(Order.id)).where(
                Order.tenant_id == order.tenant_id,
                Order.table_session_id == order.table_session_id,
                Order.id != order.id,
                Order.status.notin_(
                    [OrderStatus.PAID, OrderStatus.CANCELLED, OrderStatus.VOIDED]
                ),
            )
        )
    ).scalar_one()
    if other_open_checks:
        return
    table = await db.get(DiningTable, table_session.table_id)
    if table is None or table.state in {TableState.AVAILABLE, TableState.DISABLED}:
        return
    table.state = TableState.CLEANING
    table.version += 1


async def approve_cancellation(
    db: AsyncSession,
    *,
    approval_id: UUID,
    identity: Identity,
) -> ApprovalRequest:
    approval = (
        await db.execute(
            select(ApprovalRequest)
            .where(
                ApprovalRequest.id == approval_id,
                ApprovalRequest.tenant_id == identity.tenant_id,
                ApprovalRequest.approval_type.in_(
                    [ApprovalType.ITEM_CANCELLATION, ApprovalType.ORDER_VOID]
                ),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if approval is None:
        raise DomainError("approval_not_found", "Approval request not found", status_code=404)
    _require_active_branch(identity, approval.branch_id)
    if approval.status != ApprovalStatus.PENDING:
        return approval
    assert approval.order_id is not None
    order = await load_order(db, approval.tenant_id, approval.order_id, lock=True)
    paid_count = (
        await db.execute(
            select(func.count(Payment.id)).where(
                Payment.order_id == order.id,
                Payment.status == PaymentStatus.COMPLETED,
            )
        )
    ).scalar_one()
    if paid_count:
        raise DomainError(
            "cancellation_payment_conflict",
            "Paid orders require a refund workflow before cancellation",
            status_code=409,
        )
    target_items = (
        [item for item in order.items if item.id == approval.order_item_id]
        if approval.order_item_id
        else [
            item
            for item in order.items
            if item.status not in {OrderItemStatus.CANCELLED, OrderItemStatus.VOIDED}
        ]
    )
    await reverse_order_redemptions(
        db,
        order=order,
        identity=identity,
        reason=approval.reason,
        order_item_ids={item.id for item in target_items},
    )
    for item in target_items:
        movements = (
            (
                await db.execute(
                    select(StockMovement).where(
                        StockMovement.tenant_id == order.tenant_id,
                        StockMovement.order_item_id == item.id,
                        StockMovement.movement_type == StockMovementType.SALE,
                    )
                )
            )
            .scalars()
            .all()
        )
        for movement in movements:
            reversal_key = f"cancellation:{approval.id}:movement:{movement.id}"
            reversal_exists = (
                await db.execute(
                    select(StockMovement.id).where(
                        StockMovement.tenant_id == order.tenant_id,
                        StockMovement.idempotency_key == reversal_key,
                    )
                )
            ).scalar_one_or_none()
            if reversal_exists:
                continue
            balance = (
                await db.execute(
                    select(StockBalance)
                    .where(
                        StockBalance.tenant_id == order.tenant_id,
                        StockBalance.inventory_item_id == movement.inventory_item_id,
                        StockBalance.location_id == movement.location_id,
                    )
                    .with_for_update()
                )
            ).scalar_one()
            quantity = -movement.quantity_delta
            balance.quantity += quantity
            balance.version += 1
            db.add(
                StockMovement(
                    tenant_id=order.tenant_id,
                    branch_id=order.branch_id,
                    inventory_item_id=movement.inventory_item_id,
                    location_id=movement.location_id,
                    order_item_id=item.id,
                    actor_user_id=identity.user_id,
                    movement_type=StockMovementType.RETURN,
                    quantity_delta=quantity,
                    balance_after=balance.quantity,
                    reason=approval.reason,
                    idempotency_key=reversal_key,
                )
            )
        item.status = (
            OrderItemStatus.CANCELLED
            if approval.approval_type == ApprovalType.ITEM_CANCELLATION
            else OrderItemStatus.VOIDED
        )
        db.add(
            Cancellation(
                tenant_id=order.tenant_id,
                branch_id=order.branch_id,
                order_id=order.id,
                order_item_id=item.id,
                actor_user_id=identity.user_id,
                reason=approval.reason,
                reversal_completed=True,
            )
        )
        ticket_items = (
            (
                await db.execute(
                    select(KitchenTicketItem).where(KitchenTicketItem.order_item_id == item.id)
                )
            )
            .scalars()
            .all()
        )
        for ticket_item in ticket_items:
            ticket_item.status = item.status
    if approval.approval_type == ApprovalType.ORDER_VOID:
        order.status = OrderStatus.VOIDED
        await _release_table_if_no_open_checks(db, order)
    else:
        cancelled_amount = sum((item.line_total for item in target_items), Decimal("0"))
        order.subtotal = money(max(Decimal("0"), order.subtotal - cancelled_amount))
        order.total = money(
            max(
                Decimal("0"),
                order.subtotal - order.discount_total + order.tax_total,
            )
        )
        if all(
            item.status in {OrderItemStatus.CANCELLED, OrderItemStatus.VOIDED}
            for item in order.items
        ):
            order.status = OrderStatus.CANCELLED
            await _release_table_if_no_open_checks(db, order)
    order.version += 1
    approval.status = ApprovalStatus.APPROVED
    approval.resolved_by_user_id = identity.user_id
    approval.resolved_at = datetime.now(UTC)
    add_audit_log(
        db,
        identity=identity,
        action=(
            "order.item_cancelled"
            if approval.approval_type == ApprovalType.ITEM_CANCELLATION
            else "order.voided"
        ),
        resource_type="order",
        resource_id=order.id,
        reason=approval.reason,
    )
    return approval
