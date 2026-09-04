"""Explicit, non-destructive catalogue copies from the centre branch."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import DomainError
from app.models import Branch, Category, PreparationStation, Product, ProductRecipe
from app.security import utcnow


@dataclass
class CatalogSyncOutcome:
    categories_created: int = 0
    categories_updated: int = 0
    products_created: int = 0
    products_updated: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "categories_created": self.categories_created,
            "categories_updated": self.categories_updated,
            "products_created": self.products_created,
            "products_updated": self.products_updated,
        }


async def centre_catalog_status(
    db: AsyncSession, *, tenant_id: UUID, branch_id: UUID
) -> dict[str, object]:
    branch = (
        await db.execute(
            select(Branch).where(Branch.id == branch_id, Branch.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if branch is None:
        raise DomainError("branch_not_found", "Branch not found", status_code=404)
    centre = (
        await db.execute(
            select(Branch).where(
                Branch.tenant_id == tenant_id,
                Branch.slug == "merkez",
                Branch.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    return {
        "is_centre": branch.slug == "merkez",
        "can_import": centre is not None
        and branch.id != centre.id
        and branch.catalog_imported_at is None,
        "imported_at": branch.catalog_imported_at,
        "source_name": centre.name if centre else None,
    }


async def sync_centre_catalog(
    db: AsyncSession, *, tenant_id: UUID, target_branch_id: UUID, initial_import: bool
) -> CatalogSyncOutcome:
    target = (
        await db.execute(
            select(Branch).where(Branch.id == target_branch_id, Branch.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if target is None:
        raise DomainError("branch_not_found", "Branch not found", status_code=404)
    centre = (
        await db.execute(
            select(Branch).where(
                Branch.tenant_id == tenant_id,
                Branch.slug == "merkez",
                Branch.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if centre is None:
        raise DomainError("centre_branch_not_found", "Centre branch not found", status_code=404)
    if target.id == centre.id:
        raise DomainError(
            "centre_branch_cannot_import", "Centre branch cannot import itself", status_code=400
        )
    if initial_import and target.catalog_imported_at is not None:
        raise DomainError(
            "catalog_already_imported", "Centre catalogue was already imported", status_code=409
        )
    if not initial_import and target.catalog_imported_at is None:
        raise DomainError(
            "catalog_not_imported", "Import the centre catalogue first", status_code=409
        )

    outcome = CatalogSyncOutcome()
    source_categories = (
        (
            await db.execute(
                select(Category).where(
                    Category.tenant_id == tenant_id, Category.branch_id == centre.id
                )
            )
        )
        .scalars()
        .all()
    )
    local_categories = (
        (
            await db.execute(
                select(Category).where(
                    Category.tenant_id == tenant_id, Category.branch_id == target.id
                )
            )
        )
        .scalars()
        .all()
    )
    category_by_source = {
        item.source_category_id: item for item in local_categories if item.source_category_id
    }
    category_map: dict[UUID, Category] = {}

    # First copy the category data. Parent links are set below once every local
    # category has an ID, which also handles arbitrarily nested categories.
    for source in source_categories:
        local = category_by_source.get(source.id)
        if local is None:
            local = Category(
                tenant_id=tenant_id,
                branch_id=target.id,
                source_category_id=source.id,
                name=source.name,
                description=source.description,
                color=source.color,
                image_url=source.image_url,
                translations=source.translations,
                sort_order=source.sort_order,
                is_active=source.is_active,
            )
            db.add(local)
            outcome.categories_created += 1
        else:
            local.name = source.name
            local.description = source.description
            local.color = source.color
            local.image_url = source.image_url
            local.translations = source.translations
            local.sort_order = source.sort_order
            local.is_active = source.is_active
            outcome.categories_updated += 1
        category_map[source.id] = local
    await db.flush()
    for source in source_categories:
        category_map[source.id].parent_id = (
            category_map[source.parent_id].id if source.parent_id in category_map else None
        )

    source_stations = (
        (
            await db.execute(
                select(PreparationStation).where(
                    PreparationStation.tenant_id == tenant_id,
                    PreparationStation.branch_id == centre.id,
                )
            )
        )
        .scalars()
        .all()
    )
    target_stations = (
        (
            await db.execute(
                select(PreparationStation).where(
                    PreparationStation.tenant_id == tenant_id,
                    PreparationStation.branch_id == target.id,
                )
            )
        )
        .scalars()
        .all()
    )
    station_by_code = {item.code.casefold(): item.id for item in target_stations}
    station_map = {item.id: station_by_code.get(item.code.casefold()) for item in source_stations}

    source_products = (
        (
            await db.execute(
                select(Product).where(
                    Product.tenant_id == tenant_id, Product.branch_id == centre.id
                )
            )
        )
        .scalars()
        .all()
    )
    local_products = (
        (
            await db.execute(
                select(Product).where(
                    Product.tenant_id == tenant_id, Product.branch_id == target.id
                )
            )
        )
        .scalars()
        .all()
    )
    product_by_source = {
        item.source_product_id: item for item in local_products if item.source_product_id
    }
    copied_fields = (
        "name",
        "internal_name",
        "description",
        "sku",
        "barcode",
        "selling_price",
        "cost_price",
        "tax_rate",
        "image_url",
        "is_active",
        "is_available",
        "qr_visible",
        "waiter_visible",
        "preparation_minutes",
        "track_inventory",
        "out_of_stock_behavior",
        "sort_order",
        "allergens",
        "calories",
        "tags",
        "translations",
    )
    for source_product in source_products:
        # Deliberately not the name used for categories above: reusing it made
        # every product line read as a Category to anyone (and anything)
        # checking types.
        local_product = product_by_source.get(source_product.id)
        values = {field: getattr(source_product, field) for field in copied_fields}
        values["category_id"] = category_map[source_product.category_id].id
        # A product with no station keeps none; only a named one is translated
        # to this branch's equivalent.
        values["preparation_station_id"] = (
            station_map.get(source_product.preparation_station_id)
            if source_product.preparation_station_id is not None
            else None
        )
        if local_product is None:
            db.add(
                Product(
                    tenant_id=tenant_id,
                    branch_id=target.id,
                    source_product_id=source_product.id,
                    **values,
                )
            )
            outcome.products_created += 1
        else:
            for field, value in values.items():
                setattr(local_product, field, value)
            outcome.products_updated += 1

    await db.flush()
    await _repoint_recipes(db, tenant_id=tenant_id, target_branch_id=target.id)

    if initial_import:
        target.catalog_imported_at = utcnow()
        target.catalog_source_branch_id = centre.id
    await db.flush()
    return outcome


async def _repoint_recipes(
    db: AsyncSession, *, tenant_id: UUID, target_branch_id: UUID
) -> None:
    """Point this branch's recipes at this branch's own products.

    Opening a branch copies the operational blueprint — stations, ingredients
    and the recipes that consume them — before there is any catalogue to attach
    them to, so those recipes still name the source branch's product rows. The
    import creates local copies of those products with new ids, and a recipe is
    looked up by (branch, product): without this step every inventory-tracked
    product is refused at the till with `recipe_missing`, which reads as a bug
    rather than as the setup step it is.
    """
    local_products = (
        (
            await db.execute(
                select(Product).where(
                    Product.tenant_id == tenant_id,
                    Product.branch_id == target_branch_id,
                    Product.source_product_id.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    if not local_products:
        return
    local_by_source = {item.source_product_id: item.id for item in local_products}
    recipes = (
        (
            await db.execute(
                select(ProductRecipe).where(
                    ProductRecipe.tenant_id == tenant_id,
                    ProductRecipe.branch_id == target_branch_id,
                )
            )
        )
        .scalars()
        .all()
    )
    # One recipe per (branch, product) is a database constraint, so a stale row
    # is only moved when the local product has none of its own.
    taken = {recipe.product_id for recipe in recipes}
    for recipe in recipes:
        local_product_id = local_by_source.get(recipe.product_id)
        if local_product_id is None or local_product_id in taken:
            continue
        recipe.product_id = local_product_id
        for line in recipe.items:
            line.branch_id = target_branch_id
        taken.add(local_product_id)
