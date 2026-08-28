"""Giving a newly opened branch the setup it needs to take an order.

A branch created through the API used to arrive empty: no preparation stations,
no inventory location, no recipes. Nothing about that is visible until service
starts, and then it fails in two ways at once. Orders are accepted but produce no
kitchen ticket, because a ticket is grouped by station and there is no station to
group by; and any inventory-tracked product is refused outright with
`recipe_missing`, because recipes are per branch while `track_inventory` is a
property of the business-wide product.

So the operational blueprint is copied from a branch that already works. What is
copied is the shape of the operation — stations, the ingredients the kitchen
uses, the recipes that consume them. What is deliberately not copied is anything
that belongs to the other branch's day: stock quantities start at zero, and the
floor plan is left to the owner, who is the only one who knows how many tables
fit in the new room.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import (
    Branch,
    InventoryItem,
    InventoryLocation,
    PreparationStation,
    ProductRecipe,
    ProductRecipeItem,
    StockBalance,
)

logger = logging.getLogger(__name__)

DEFAULT_LOCATION_NAME = "Ana Depo"


@dataclass
class BranchSetupOutcome:
    """What the new branch was given, so the owner can be told rather than surprised."""

    source_branch_id: UUID | None = None
    stations_created: int = 0
    inventory_items_created: int = 0
    recipes_created: int = 0
    location_created: bool = False

    def as_dict(self) -> dict[str, object]:
        return {
            "source_branch_id": str(self.source_branch_id) if self.source_branch_id else None,
            "stations_created": self.stations_created,
            "inventory_items_created": self.inventory_items_created,
            "recipes_created": self.recipes_created,
            "location_created": self.location_created,
        }


async def _source_branch(
    db: AsyncSession, *, tenant_id: UUID, exclude_id: UUID
) -> Branch | None:
    """The oldest active branch — the one most likely to be fully configured."""
    return (
        await db.execute(
            select(Branch)
            .where(
                Branch.tenant_id == tenant_id,
                Branch.id != exclude_id,
                Branch.is_active.is_(True),
            )
            .order_by(Branch.created_at)
            .limit(1)
        )
    ).scalar_one_or_none()


async def provision_branch(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    branch: Branch,
) -> BranchSetupOutcome:
    """Copy the operational blueprint of an existing branch onto a new one.

    Safe to call on a branch that already has some of this: every step fills a
    gap rather than replacing what is there, so re-running it never disturbs
    setup the owner has since edited by hand.
    """
    outcome = BranchSetupOutcome()
    source = await _source_branch(db, tenant_id=tenant_id, exclude_id=branch.id)
    if source is None:
        # The first branch of a business has nothing to copy from.
        return outcome
    outcome.source_branch_id = source.id

    # --- preparation stations -------------------------------------------
    source_stations = (
        (
            await db.execute(
                select(PreparationStation).where(
                    PreparationStation.tenant_id == tenant_id,
                    PreparationStation.branch_id == source.id,
                    PreparationStation.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    existing_codes = {
        code.casefold()
        for code in (
            (
                await db.execute(
                    select(PreparationStation.code).where(
                        PreparationStation.tenant_id == tenant_id,
                        PreparationStation.branch_id == branch.id,
                    )
                )
            )
            .scalars()
            .all()
        )
    }
    for station in source_stations:
        if station.code.casefold() in existing_codes:
            continue
        db.add(
            PreparationStation(
                tenant_id=tenant_id,
                branch_id=branch.id,
                name=station.name,
                code=station.code,
                sort_order=station.sort_order,
                is_active=True,
            )
        )
        outcome.stations_created += 1

    # --- inventory location ----------------------------------------------
    location = (
        await db.execute(
            select(InventoryLocation).where(
                InventoryLocation.tenant_id == tenant_id,
                InventoryLocation.branch_id == branch.id,
            )
        )
    ).scalars().first()
    if location is None:
        source_location = (
            await db.execute(
                select(InventoryLocation).where(
                    InventoryLocation.tenant_id == tenant_id,
                    InventoryLocation.branch_id == source.id,
                    InventoryLocation.is_default.is_(True),
                )
            )
        ).scalar_one_or_none()
        location = InventoryLocation(
            tenant_id=tenant_id,
            branch_id=branch.id,
            name=source_location.name if source_location else DEFAULT_LOCATION_NAME,
            is_default=True,
            is_active=True,
        )
        db.add(location)
        outcome.location_created = True
    await db.flush()

    # --- inventory items, at zero ------------------------------------------
    source_items = (
        (
            await db.execute(
                select(InventoryItem).where(
                    InventoryItem.tenant_id == tenant_id,
                    InventoryItem.branch_id == source.id,
                    InventoryItem.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    local_items = {
        item.name.casefold(): item
        for item in (
            (
                await db.execute(
                    select(InventoryItem).where(
                        InventoryItem.tenant_id == tenant_id,
                        InventoryItem.branch_id == branch.id,
                    )
                )
            )
            .scalars()
            .all()
        )
    }
    for item in source_items:
        if item.name.casefold() in local_items:
            continue
        copy = InventoryItem(
            tenant_id=tenant_id,
            branch_id=branch.id,
            name=item.name,
            sku=item.sku,
            unit=item.unit,
            minimum_stock=item.minimum_stock,
            average_cost=item.average_cost,
            is_active=True,
        )
        db.add(copy)
        await db.flush()
        local_items[item.name.casefold()] = copy
        outcome.inventory_items_created += 1
        # A balance row has to exist before stock can be counted in; the
        # deduction path treats a missing one as a hard error, not as zero.
        db.add(
            StockBalance(
                tenant_id=tenant_id,
                branch_id=branch.id,
                inventory_item_id=copy.id,
                location_id=location.id,
                quantity=Decimal("0"),
            )
        )

    # --- recipes, rewired to the local ingredients --------------------------
    source_recipes = (
        (
            await db.execute(
                select(ProductRecipe)
                .where(
                    ProductRecipe.tenant_id == tenant_id,
                    ProductRecipe.branch_id == source.id,
                    ProductRecipe.is_active.is_(True),
                )
                .options(selectinload(ProductRecipe.items))
            )
        )
        .scalars()
        .all()
    )
    existing_recipe_products = set(
        (
            await db.execute(
                select(ProductRecipe.product_id).where(
                    ProductRecipe.tenant_id == tenant_id,
                    ProductRecipe.branch_id == branch.id,
                )
            )
        )
        .scalars()
        .all()
    )
    source_item_names = {item.id: item.name.casefold() for item in source_items}
    for recipe in source_recipes:
        if recipe.product_id in existing_recipe_products:
            continue
        ingredients: list[tuple[UUID, Decimal]] = []
        for line in recipe.items:
            name = source_item_names.get(line.inventory_item_id)
            local = local_items.get(name) if name else None
            if local is None:
                # An ingredient with no counterpart here would make the recipe
                # deduct from nothing. Skip the whole recipe rather than copy a
                # half of one that silently under-counts stock.
                ingredients = []
                break
            ingredients.append((local.id, line.quantity))
        if not ingredients:
            continue
        local_recipe = ProductRecipe(
            tenant_id=tenant_id,
            branch_id=branch.id,
            product_id=recipe.product_id,
            yield_quantity=recipe.yield_quantity,
            is_active=True,
        )
        db.add(local_recipe)
        await db.flush()
        for inventory_item_id, quantity in ingredients:
            db.add(
                ProductRecipeItem(
                    tenant_id=tenant_id,
                    branch_id=branch.id,
                    recipe_id=local_recipe.id,
                    inventory_item_id=inventory_item_id,
                    quantity=quantity,
                )
            )
        outcome.recipes_created += 1

    await db.flush()
    logger.info(
        "branch provisioned from %s: %s", source.slug, outcome.as_dict()
    )
    return outcome
