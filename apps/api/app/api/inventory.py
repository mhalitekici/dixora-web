from __future__ import annotations

from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy import func, or_, select
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
    BranchOut,
    BranchStockCellOut,
    BrandStockItemOut,
    BrandStockOverviewOut,
    InventoryItemCreate,
    InventoryItemOut,
    RecipeCopyRequest,
    RecipeCreate,
    RecipeIngredientOut,
    RecipeOut,
    StockMovementCreate,
    StockMovementOut,
    StockTransferCreate,
    StockTransferOut,
)
from app.services.audit import add_audit_log
from app.services.inventory_units import convert_quantity

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
        category=payload.category,
        minimum_stock=payload.minimum_stock,
        target_stock=payload.target_stock,
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


@router.get("/overview", response_model=BrandStockOverviewOut)
async def brand_stock_overview(
    identity: InventoryReader,
    db: DbSession,
    branch_id: UUID | None = None,
    low_only: bool = False,
    search: str | None = None,
) -> BrandStockOverviewOut:
    tenant_id = require_tenant(identity)
    branch_ids = (
        [require_branch(identity, branch_id)]
        if branch_id is not None
        else sorted(identity.accessible_branch_ids, key=str)
    )
    branches = (
        (
            await db.execute(
                select(Branch)
                .where(
                    Branch.tenant_id == tenant_id,
                    Branch.id.in_(branch_ids),
                    Branch.is_active.is_(True),
                )
                .order_by(Branch.name)
            )
        )
        .scalars()
        .all()
    )
    statement = (
        select(
            InventoryItem,
            Branch.name,
            func.coalesce(func.sum(StockBalance.quantity), 0),
            func.max(StockBalance.updated_at),
        )
        .join(Branch, Branch.id == InventoryItem.branch_id)
        .outerjoin(
            StockBalance,
            (StockBalance.inventory_item_id == InventoryItem.id)
            & (StockBalance.tenant_id == tenant_id)
            & (StockBalance.branch_id == InventoryItem.branch_id),
        )
        .where(
            InventoryItem.tenant_id == tenant_id,
            InventoryItem.branch_id.in_([branch.id for branch in branches]),
            InventoryItem.is_active.is_(True),
        )
        .group_by(InventoryItem.id, Branch.name)
    )
    if search:
        pattern = f"%{search.strip()}%"
        statement = statement.where(
            or_(InventoryItem.name.ilike(pattern), InventoryItem.sku.ilike(pattern))
        )
    rows = (await db.execute(statement.order_by(InventoryItem.name, Branch.name))).all()
    grouped: dict[str, BrandStockItemOut] = {}
    low_count = 0
    out_count = 0
    for item, branch_name, quantity, balance_updated_at in rows:
        stock_status = (
            "OUT_OF_STOCK"
            if quantity <= 0
            else "LOW"
            if quantity <= item.minimum_stock
            else "NORMAL"
        )
        if stock_status == "LOW":
            low_count += 1
        elif stock_status == "OUT_OF_STOCK":
            out_count += 1
        key = item.sku.strip().casefold() if item.sku else f"{item.name.casefold()}:{item.unit}"
        entry = grouped.get(key)
        if entry is None:
            entry = BrandStockItemOut(
                key=key,
                name=item.name,
                sku=item.sku,
                category=item.category,
                unit=item.unit,
                branches=[],
            )
            grouped[key] = entry
        entry.branches.append(
            BranchStockCellOut(
                branch_id=item.branch_id,
                branch_name=branch_name,
                inventory_item_id=item.id,
                quantity=quantity,
                minimum_stock=item.minimum_stock,
                target_stock=item.target_stock,
                status=stock_status,
                updated_at=balance_updated_at or item.updated_at,
            )
        )
    items = list(grouped.values())
    if low_only:
        items = [item for item in items if any(cell.status != "NORMAL" for cell in item.branches)]
    items.sort(
        key=lambda item: (
            not any(cell.status == "OUT_OF_STOCK" for cell in item.branches),
            not any(cell.status == "LOW" for cell in item.branches),
            item.name.casefold(),
        )
    )
    return BrandStockOverviewOut(
        branches=[BranchOut.model_validate(branch) for branch in branches],
        items=items,
        total_items=len(grouped),
        low_count=low_count,
        out_of_stock_count=out_count,
    )


def _recipe_out(recipe: ProductRecipe) -> RecipeOut:
    return RecipeOut(
        id=recipe.id,
        product_id=recipe.product_id,
        product_name=recipe.product.name,
        yield_quantity=recipe.yield_quantity,
        ingredients=[
            RecipeIngredientOut(
                inventory_item_id=item.inventory_item_id,
                name=item.inventory_item.name,
                unit=item.unit,
                quantity=item.quantity,
            )
            for item in recipe.items
        ],
    )


@router.post("/recipes/copy", response_model=RecipeOut, status_code=status.HTTP_201_CREATED)
async def copy_recipe(
    payload: RecipeCopyRequest,
    identity: InventoryManager,
    db: DbSession,
) -> RecipeOut:
    tenant_id = require_tenant(identity)
    source_branch_id = require_branch(identity, payload.source_branch_id)
    target_branch_id = require_branch(identity, payload.target_branch_id)
    if source_branch_id == target_branch_id:
        raise DomainError(
            "same_branch_recipe_copy",
            "Source and target branches must be different",
            status_code=409,
        )

    source_recipe = (
        await db.execute(
            select(ProductRecipe)
            .where(
                ProductRecipe.tenant_id == tenant_id,
                ProductRecipe.branch_id == source_branch_id,
                ProductRecipe.product_id == payload.source_product_id,
                ProductRecipe.is_active.is_(True),
            )
            .options(
                selectinload(ProductRecipe.product),
                selectinload(ProductRecipe.items).selectinload(ProductRecipeItem.inventory_item),
            )
        )
    ).scalar_one_or_none()
    if source_recipe is None:
        raise DomainError("recipe_not_found", "Source recipe not found", status_code=404)

    target_product = (
        await db.execute(
            select(Product).where(
                Product.id == payload.target_product_id,
                Product.tenant_id == tenant_id,
                Product.branch_id == target_branch_id,
            )
        )
    ).scalar_one_or_none()
    if target_product is None:
        raise DomainError("product_not_found", "Target product not found", status_code=404)

    mappings = {
        mapping.source_inventory_item_id: mapping.target_inventory_item_id
        for mapping in payload.ingredient_mappings
    }
    if len(mappings) != len(payload.ingredient_mappings):
        raise DomainError(
            "duplicate_recipe_mapping",
            "Each source ingredient can only be mapped once",
            status_code=422,
        )
    if len(set(mappings.values())) != len(mappings):
        raise DomainError(
            "duplicate_target_recipe_mapping",
            "Each target ingredient can only be used once",
            status_code=422,
        )
    source_item_ids = {item.inventory_item_id for item in source_recipe.items}
    if set(mappings) != source_item_ids:
        raise DomainError(
            "recipe_mapping_incomplete",
            "Every source ingredient must be mapped explicitly",
            status_code=422,
            details={
                "missing_source_inventory_item_ids": [
                    str(item_id) for item_id in sorted(source_item_ids - set(mappings), key=str)
                ]
            },
        )

    target_items = (
        (
            await db.execute(
                select(InventoryItem).where(
                    InventoryItem.tenant_id == tenant_id,
                    InventoryItem.branch_id == target_branch_id,
                    InventoryItem.id.in_(set(mappings.values())),
                    InventoryItem.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    target_item_map = {item.id: item for item in target_items}
    if len(target_item_map) != len(set(mappings.values())):
        raise DomainError(
            "inventory_item_not_found",
            "One or more target inventory items were not found",
            status_code=404,
        )
    for source_item in source_recipe.items:
        target_item = target_item_map[mappings[source_item.inventory_item_id]]
        convert_quantity(
            source_item.quantity,
            source_unit=source_item.unit,
            target_unit=target_item.unit,
        )

    target_recipe = (
        await db.execute(
            select(ProductRecipe)
            .where(
                ProductRecipe.tenant_id == tenant_id,
                ProductRecipe.branch_id == target_branch_id,
                ProductRecipe.product_id == target_product.id,
            )
            .options(selectinload(ProductRecipe.items))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if target_recipe is None:
        target_recipe = ProductRecipe(
            tenant_id=tenant_id,
            branch_id=target_branch_id,
            product_id=target_product.id,
            yield_quantity=source_recipe.yield_quantity,
            is_active=True,
        )
        db.add(target_recipe)
        await db.flush()
    else:
        target_recipe.yield_quantity = source_recipe.yield_quantity
        target_recipe.is_active = True
        for old_item in list(target_recipe.items):
            await db.delete(old_item)
        await db.flush()

    for source_item in source_recipe.items:
        db.add(
            ProductRecipeItem(
                tenant_id=tenant_id,
                branch_id=target_branch_id,
                recipe_id=target_recipe.id,
                inventory_item_id=mappings[source_item.inventory_item_id],
                quantity=source_item.quantity,
                unit=source_item.unit,
            )
        )
    target_product.track_inventory = True
    add_audit_log(
        db,
        identity=identity,
        action="inventory.recipe_copied",
        resource_type="product",
        resource_id=target_product.id,
        new_value={
            "source_branch_id": str(source_branch_id),
            "source_product_id": str(source_recipe.product_id),
            "target_branch_id": str(target_branch_id),
            "ingredient_count": len(source_recipe.items),
            "stock_copied": False,
        },
    )
    await db.commit()
    copied = (
        await db.execute(
            select(ProductRecipe)
            .where(ProductRecipe.id == target_recipe.id, ProductRecipe.tenant_id == tenant_id)
            .options(
                selectinload(ProductRecipe.product),
                selectinload(ProductRecipe.items).selectinload(ProductRecipeItem.inventory_item),
            )
        )
    ).scalar_one()
    return _recipe_out(copied)


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
            select(Product).where(
                Product.id == product_id,
                Product.tenant_id == tenant_id,
                Product.branch_id == branch_id,
            )
        )
    ).scalar_one_or_none()
    if product is None:
        raise DomainError("product_not_found", "Product not found", status_code=404)
    ingredient_ids = {item.inventory_item_id for item in payload.items}
    if len(ingredient_ids) != len(payload.items):
        raise DomainError(
            "duplicate_recipe_ingredient",
            "Each inventory item can only appear once in a recipe",
            status_code=422,
        )
    ingredients = (
        (
            await db.execute(
                select(InventoryItem).where(
                    InventoryItem.tenant_id == tenant_id,
                    InventoryItem.branch_id == branch_id,
                    InventoryItem.id.in_(ingredient_ids),
                    InventoryItem.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    ingredient_map = {item.id: item for item in ingredients}
    if len(ingredient_map) != len(ingredient_ids):
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
        inventory_item = ingredient_map[item.inventory_item_id]
        recipe_unit = item.unit or inventory_item.unit
        convert_quantity(
            item.quantity,
            source_unit=recipe_unit,
            target_unit=inventory_item.unit,
        )
        db.add(
            ProductRecipeItem(
                tenant_id=tenant_id,
                branch_id=branch_id,
                recipe_id=recipe.id,
                inventory_item_id=item.inventory_item_id,
                quantity=item.quantity,
                unit=recipe_unit,
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
    return [_recipe_out(recipe) for recipe in rows]


@router.get("/movements", response_model=list[StockMovementOut])
async def list_stock_movements(
    identity: InventoryReader,
    db: DbSession,
    branch_id: UUID | None = None,
    limit: int = 100,
) -> list[StockMovementOut]:
    rows = (
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
    ).all()
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


@router.post("/transfers", response_model=StockTransferOut, status_code=status.HTTP_201_CREATED)
async def transfer_stock(
    payload: StockTransferCreate,
    identity: InventoryManager,
    db: DbSession,
) -> StockTransferOut:
    tenant_id = require_tenant(identity)
    source_branch_id = require_branch(identity, payload.source_branch_id)
    target_branch_id = require_branch(identity, payload.target_branch_id)
    if source_branch_id == target_branch_id:
        raise DomainError(
            "same_branch_transfer", "Source and target branches must differ", status_code=422
        )

    source_key = f"transfer:{payload.idempotency_key}:out"
    target_key = f"transfer:{payload.idempotency_key}:in"
    existing = (
        (
            await db.execute(
                select(StockMovement).where(
                    StockMovement.tenant_id == tenant_id,
                    StockMovement.idempotency_key.in_([source_key, target_key]),
                )
            )
        )
        .scalars()
        .all()
    )
    if existing:
        by_key = {movement.idempotency_key: movement for movement in existing}
        if source_key in by_key and target_key in by_key:
            source_item = await db.get(InventoryItem, by_key[source_key].inventory_item_id)
            target_item = await db.get(InventoryItem, by_key[target_key].inventory_item_id)
            assert source_item is not None and target_item is not None
            return StockTransferOut(
                transfer_id=payload.idempotency_key,
                source=_movement_out(by_key[source_key], source_item.name),
                target=_movement_out(by_key[target_key], target_item.name),
            )
        raise DomainError(
            "stock_transfer_incomplete",
            "A previous transfer attempt is incomplete",
            status_code=409,
        )

    inventory_items = (
        (
            await db.execute(
                select(InventoryItem).where(
                    InventoryItem.tenant_id == tenant_id,
                    InventoryItem.id.in_(
                        [payload.source_inventory_item_id, payload.target_inventory_item_id]
                    ),
                    InventoryItem.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    by_id = {item.id: item for item in inventory_items}
    source_item = by_id.get(payload.source_inventory_item_id)
    target_item = by_id.get(payload.target_inventory_item_id)
    if (
        source_item is None
        or target_item is None
        or source_item.branch_id != source_branch_id
        or target_item.branch_id != target_branch_id
    ):
        raise DomainError(
            "inventory_item_not_found", "A transfer inventory item was not found", status_code=404
        )
    if source_item.unit != target_item.unit:
        raise DomainError(
            "stock_unit_mismatch", "Transfer items must use the same unit", status_code=422
        )

    source_location = await _default_location(db, tenant_id, source_branch_id)
    target_location = await _default_location(db, tenant_id, target_branch_id)
    balance_rows = (
        (
            await db.execute(
                select(StockBalance)
                .where(
                    StockBalance.tenant_id == tenant_id,
                    or_(
                        (StockBalance.inventory_item_id == source_item.id)
                        & (StockBalance.location_id == source_location.id),
                        (StockBalance.inventory_item_id == target_item.id)
                        & (StockBalance.location_id == target_location.id),
                    ),
                )
                .order_by(StockBalance.branch_id, StockBalance.inventory_item_id)
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    balance_by_item = {row.inventory_item_id: row for row in balance_rows}
    source_balance = balance_by_item.get(source_item.id)
    if source_balance is None or source_balance.quantity < payload.quantity:
        raise DomainError("insufficient_stock", "Insufficient stock for transfer", status_code=409)
    target_balance = balance_by_item.get(target_item.id)
    if target_balance is None:
        target_balance = StockBalance(
            tenant_id=tenant_id,
            branch_id=target_branch_id,
            inventory_item_id=target_item.id,
            location_id=target_location.id,
            quantity=Decimal("0"),
        )
        db.add(target_balance)
        await db.flush()

    source_balance.quantity -= payload.quantity
    target_balance.quantity += payload.quantity
    source_balance.version += 1
    target_balance.version += 1
    source_movement = StockMovement(
        tenant_id=tenant_id,
        branch_id=source_branch_id,
        inventory_item_id=source_item.id,
        location_id=source_location.id,
        actor_user_id=identity.user_id,
        movement_type=StockMovementType.TRANSFER_OUT,
        quantity_delta=-payload.quantity,
        balance_after=source_balance.quantity,
        reason=payload.reason,
        idempotency_key=source_key,
    )
    target_movement = StockMovement(
        tenant_id=tenant_id,
        branch_id=target_branch_id,
        inventory_item_id=target_item.id,
        location_id=target_location.id,
        actor_user_id=identity.user_id,
        movement_type=StockMovementType.TRANSFER_IN,
        quantity_delta=payload.quantity,
        balance_after=target_balance.quantity,
        reason=payload.reason,
        idempotency_key=target_key,
    )
    db.add_all([source_movement, target_movement])
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="inventory.stock_transferred",
        resource_type="stock_transfer",
        resource_id=source_movement.id,
        new_value={
            "transfer_id": payload.idempotency_key,
            "source_branch_id": str(source_branch_id),
            "target_branch_id": str(target_branch_id),
            "quantity": str(payload.quantity),
            "unit": source_item.unit,
        },
        reason=payload.reason,
    )
    await db.commit()
    return StockTransferOut(
        transfer_id=payload.idempotency_key,
        source=_movement_out(source_movement, source_item.name),
        target=_movement_out(target_movement, target_item.name),
    )


def _movement_out(movement: StockMovement, item_name: str) -> StockMovementOut:
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
