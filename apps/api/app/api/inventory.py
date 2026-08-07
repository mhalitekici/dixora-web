from __future__ import annotations

from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.dependencies import (
    DbSession,
    Identity,
    require_branch,
    require_permissions,
    require_tenant,
)
from app.errors import DomainError
from app.models import (
    Branch,
    InventoryItem,
    InventoryLocation,
    Product,
    ProductRecipe,
    ProductRecipeItem,
    StockBalance,
    StockMovement,
)
from app.models.enums import StockMovementType
from app.schemas import (
    InventoryItemCreate,
    InventoryItemOut,
    RecipeCreate,
    RecipeIngredientOut,
    RecipeOut,
    StockMovementCreate,
    StockMovementOut,
)
from app.services.audit import add_audit_log

router = APIRouter(prefix="/inventory", tags=["inventory"])
InventoryReader = Annotated[Identity, Depends(require_permissions("inventory.read"))]
InventoryManager = Annotated[Identity, Depends(require_permissions("inventory.manage"))]


async def _default_location(db: DbSession, tenant_id: UUID, branch_id: UUID) -> InventoryLocation:
    location = (
        await db.execute(
            select(InventoryLocation).where(
                InventoryLocation.tenant_id == tenant_id,
                InventoryLocation.branch_id == branch_id,
                InventoryLocation.is_default.is_(True),
            )
        )
    ).scalar_one_or_none()
    if location is None:
        location = InventoryLocation(
            tenant_id=tenant_id,
            branch_id=branch_id,
            name="Main Stock",
            is_default=True,
        )
        db.add(location)
        await db.flush()
    return location


@router.get("/items", response_model=list[InventoryItemOut])
async def list_inventory_items(
    identity: InventoryReader,
    db: DbSession,
    branch_id: UUID | None = None,
) -> list[InventoryItemOut]:
    tenant_id = require_tenant(identity)
    selected_branch = require_branch(identity, branch_id)
    rows = (
        await db.execute(
            select(InventoryItem, StockBalance.quantity)
            .outerjoin(
                StockBalance,
                (StockBalance.inventory_item_id == InventoryItem.id)
                & (StockBalance.tenant_id == tenant_id)
                & (StockBalance.branch_id == selected_branch),
            )
            .where(
                InventoryItem.tenant_id == tenant_id,
                InventoryItem.branch_id == selected_branch,
                InventoryItem.is_active.is_(True),
            )
            .order_by(InventoryItem.name)
        )
    ).all()
    return [
        InventoryItemOut.model_validate(item).model_copy(
            update={"current_stock": quantity or Decimal("0")},
        )
        for item, quantity in rows
    ]


@router.post("/items", response_model=InventoryItemOut, status_code=status.HTTP_201_CREATED)
async def create_inventory_item(
    payload: InventoryItemCreate,
    identity: InventoryManager,
    db: DbSession,
) -> InventoryItemOut:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity, payload.branch_id)
    branch = (
        await db.execute(
            select(Branch.id).where(Branch.id == branch_id, Branch.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if branch is None:
        raise DomainError("branch_not_found", "Branch not found", status_code=404)
    item = InventoryItem(
        tenant_id=tenant_id,
        branch_id=branch_id,
        name=payload.name,
        sku=payload.sku,
        unit=payload.unit,
        minimum_stock=payload.minimum_stock,
    )
    db.add(item)
    await db.flush()
    location = await _default_location(db, tenant_id, branch_id)
    balance = StockBalance(
        tenant_id=tenant_id,
        branch_id=branch_id,
        inventory_item_id=item.id,
        location_id=location.id,
        quantity=payload.opening_quantity,
    )
    db.add(balance)
    await db.flush()
    if payload.opening_quantity:
        db.add(
            StockMovement(
                tenant_id=tenant_id,
                branch_id=branch_id,
                inventory_item_id=item.id,
                location_id=location.id,
                actor_user_id=identity.user_id,
                movement_type=StockMovementType.ADJUSTMENT,
                quantity_delta=payload.opening_quantity,
                balance_after=payload.opening_quantity,
                reason="Opening stock",
                idempotency_key=f"opening:{item.id}",
            )
        )
    add_audit_log(
        db,
        identity=identity,
        action="inventory.item_created",
        resource_type="inventory_item",
        resource_id=item.id,
        new_value={"name": item.name, "opening_quantity": str(payload.opening_quantity)},
    )
    await db.commit()
    output = InventoryItemOut.model_validate(item)
    output.current_stock = balance.quantity
    return output


@router.put("/recipes/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def upsert_recipe(
    product_id: UUID,
    payload: RecipeCreate,
    identity: InventoryManager,
    db: DbSession,
) -> None:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity, payload.branch_id)
    if payload.product_id != product_id:
        raise DomainError(
            "product_mismatch", "Product path and payload do not match", status_code=422
        )
    product = (
        await db.execute(
            select(Product).where(Product.id == product_id, Product.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if product is None:
        raise DomainError("product_not_found", "Product not found", status_code=404)
    ingredient_ids = {item.inventory_item_id for item in payload.items}
    count = (
        (
            await db.execute(
                select(InventoryItem.id).where(
                    InventoryItem.tenant_id == tenant_id,
                    InventoryItem.branch_id == branch_id,
                    InventoryItem.id.in_(ingredient_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    if len(set(count)) != len(ingredient_ids):
        raise DomainError(
            "inventory_item_not_found",
            "One or more inventory items were not found",
            status_code=404,
        )
    recipe = (
        await db.execute(
            select(ProductRecipe)
            .where(
                ProductRecipe.tenant_id == tenant_id,
                ProductRecipe.branch_id == branch_id,
                ProductRecipe.product_id == product_id,
            )
            .options(selectinload(ProductRecipe.items))
        )
    ).scalar_one_or_none()
    if recipe is None:
        recipe = ProductRecipe(
            tenant_id=tenant_id,
            branch_id=branch_id,
            product_id=product_id,
            yield_quantity=payload.yield_quantity,
        )
        db.add(recipe)
        await db.flush()
    else:
        recipe.yield_quantity = payload.yield_quantity
        for old_item in list(recipe.items):
            await db.delete(old_item)
        await db.flush()
    for item in payload.items:
        db.add(
            ProductRecipeItem(
                tenant_id=tenant_id,
                branch_id=branch_id,
                recipe_id=recipe.id,
                inventory_item_id=item.inventory_item_id,
                quantity=item.quantity,
            )
        )
    product.track_inventory = True
    add_audit_log(
        db,
        identity=identity,
        action="inventory.recipe_updated",
        resource_type="product",
        resource_id=product.id,
    )
    await db.commit()


@router.get("/recipes", response_model=list[RecipeOut])
async def list_recipes(
    identity: InventoryReader,
    db: DbSession,
    branch_id: UUID | None = None,
) -> list[RecipeOut]:
    rows = (
        (
            await db.execute(
                select(ProductRecipe)
                .where(
                    ProductRecipe.tenant_id == require_tenant(identity),
                    ProductRecipe.branch_id == require_branch(identity, branch_id),
                    ProductRecipe.is_active.is_(True),
                )
                .options(
                    selectinload(ProductRecipe.product),
                    selectinload(ProductRecipe.items).selectinload(
                        ProductRecipeItem.inventory_item
                    ),
                )
                .order_by(ProductRecipe.created_at)
            )
        )
        .scalars()
        .all()
    )
    return [
        RecipeOut(
            id=recipe.id,
            product_id=recipe.product_id,
            product_name=recipe.product.name,
            yield_quantity=recipe.yield_quantity,
            ingredients=[
                RecipeIngredientOut(
                    inventory_item_id=item.inventory_item_id,
                    name=item.inventory_item.name,
                    unit=item.inventory_item.unit,
                    quantity=item.quantity,
                )
                for item in recipe.items
            ],
        )
        for recipe in rows
    ]


@router.get("/movements", response_model=list[StockMovementOut])
async def list_stock_movements(
    identity: InventoryReader,
    db: DbSession,
    branch_id: UUID | None = None,
    limit: int = 100,
) -> list[StockMovementOut]:
    rows = (
        (
            await db.execute(
                select(StockMovement, InventoryItem.name)
                .join(
                    InventoryItem,
                    (InventoryItem.id == StockMovement.inventory_item_id)
                    & (InventoryItem.tenant_id == StockMovement.tenant_id),
                )
                .where(
                    StockMovement.tenant_id == require_tenant(identity),
                    StockMovement.branch_id == require_branch(identity, branch_id),
                )
                .order_by(StockMovement.created_at.desc())
                .limit(min(max(limit, 1), 250))
            )
        )
        .all()
    )
    return [
        StockMovementOut(
            id=item.id,
            inventory_item_id=item.inventory_item_id,
            item_name=item_name,
            type=item.movement_type,
            quantity_delta=item.quantity_delta,
            balance_after=item.balance_after,
            reason=item.reason,
            actor_user_id=item.actor_user_id,
            created_at=item.created_at,
        )
        for item, item_name in rows
    ]


@router.post(
    "/movements",
    response_model=StockMovementOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_stock_movement(
    payload: StockMovementCreate,
    identity: InventoryManager,
    db: DbSession,
) -> StockMovementOut:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity, payload.branch_id)
    existing = (
        await db.execute(
            select(StockMovement, InventoryItem.name)
            .join(InventoryItem, InventoryItem.id == StockMovement.inventory_item_id)
            .where(
                StockMovement.tenant_id == tenant_id,
                StockMovement.idempotency_key == payload.idempotency_key,
            )
        )
    ).one_or_none()
    if existing is not None:
        movement, item_name = existing
        return StockMovementOut(
            id=movement.id,
            inventory_item_id=movement.inventory_item_id,
            item_name=item_name,
            type=movement.movement_type,
            quantity_delta=movement.quantity_delta,
            balance_after=movement.balance_after,
            reason=movement.reason,
            actor_user_id=movement.actor_user_id,
            created_at=movement.created_at,
        )
    item = (
        await db.execute(
            select(InventoryItem).where(
                InventoryItem.id == payload.inventory_item_id,
                InventoryItem.tenant_id == tenant_id,
                InventoryItem.branch_id == branch_id,
                InventoryItem.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if item is None:
        raise DomainError("inventory_item_not_found", "Inventory item not found", status_code=404)
    positive_types = {
        StockMovementType.PURCHASE,
        StockMovementType.TRANSFER_IN,
        StockMovementType.RETURN,
    }
    negative_types = {
        StockMovementType.SALE,
        StockMovementType.WASTE,
        StockMovementType.TRANSFER_OUT,
    }
    if payload.type in positive_types and payload.quantity_delta < 0:
        raise DomainError(
            "invalid_stock_direction",
            "This movement type requires a positive quantity",
            status_code=422,
        )
    if payload.type in negative_types and payload.quantity_delta > 0:
        raise DomainError(
            "invalid_stock_direction",
            "This movement type requires a negative quantity",
            status_code=422,
        )
    location = await _default_location(db, tenant_id, branch_id)
    balance = (
        await db.execute(
            select(StockBalance)
            .where(
                StockBalance.tenant_id == tenant_id,
                StockBalance.branch_id == branch_id,
                StockBalance.inventory_item_id == item.id,
                StockBalance.location_id == location.id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if balance is None:
        balance = StockBalance(
            tenant_id=tenant_id,
            branch_id=branch_id,
            inventory_item_id=item.id,
            location_id=location.id,
            quantity=Decimal("0"),
        )
        db.add(balance)
        await db.flush()
    next_balance = balance.quantity + payload.quantity_delta
    if next_balance < 0:
        raise DomainError(
            "insufficient_stock",
            "Stock movement would create a negative balance",
            status_code=409,
        )
    balance.quantity = next_balance
    balance.version += 1
    movement = StockMovement(
        tenant_id=tenant_id,
        branch_id=branch_id,
        inventory_item_id=item.id,
        location_id=location.id,
        actor_user_id=identity.user_id,
        movement_type=payload.type,
        quantity_delta=payload.quantity_delta,
        balance_after=next_balance,
        reason=payload.reason,
        idempotency_key=payload.idempotency_key,
    )
    db.add(movement)
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="inventory.movement_created",
        resource_type="inventory_item",
        resource_id=item.id,
        new_value={
            "type": payload.type.value,
            "quantity_delta": str(payload.quantity_delta),
            "balance_after": str(next_balance),
        },
        reason=payload.reason,
    )
    await db.commit()
    return StockMovementOut(
        id=movement.id,
        inventory_item_id=movement.inventory_item_id,
        item_name=item.name,
        type=movement.movement_type,
        quantity_delta=movement.quantity_delta,
        balance_after=movement.balance_after,
        reason=movement.reason,
        actor_user_id=movement.actor_user_id,
        created_at=movement.created_at,
    )
