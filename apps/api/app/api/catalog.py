from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload, with_loader_criteria

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
    Category,
    ContentTranslation,
    Modifier,
    ModifierGroup,
    PreparationStation,
    Product,
    ProductModifierGroup,
)
from app.schemas import (
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    EntityTranslationsOut,
    EntityTranslationsUpdate,
    ModifierCreate,
    ModifierGroupCreate,
    ModifierGroupOut,
    ModifierGroupUpdate,
    ModifierOut,
    ModifierUpdate,
    Page,
    ProductCreate,
    ProductCsvImportError,
    ProductCsvImportResult,
    ProductCsvPreviewRow,
    ProductDetailOut,
    ProductOut,
    ProductUpdate,
    StationCreate,
    StationOut,
    TranslationFieldsOut,
)
from app.services.audit import add_audit_log
from app.services.product_csv import (
    MAX_PRODUCT_CSV_BYTES,
    MAX_PRODUCT_XLSX_BYTES,
    ParsedProductCsvRow,
    build_product_csv_template,
    build_product_xlsx_template,
    normalize_lookup_name,
    parse_product_import,
)
from app.services.translation import (
    SOURCE_LOCALE,
    SUPPORTED_LOCALES,
    is_supported_locale,
    save_translation,
    source_fingerprint,
)

router = APIRouter(prefix="/catalog", tags=["catalog"])
CatalogReader = Annotated[Identity, Depends(require_permissions("catalog.read"))]
CatalogManager = Annotated[Identity, Depends(require_permissions("catalog.manage"))]


async def _validate_branch(db: DbSession, tenant_id: UUID, branch_id: UUID) -> None:
    branch = (
        await db.execute(
            select(Branch.id).where(Branch.id == branch_id, Branch.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if branch is None:
        raise DomainError("branch_not_found", "Branch not found", status_code=404)


async def _validate_product_ids(
    db: DbSession,
    *,
    tenant_id: UUID,
    product_ids: list[UUID],
) -> None:
    unique_ids = set(product_ids)
    if not unique_ids:
        return
    found = (
        (
            await db.execute(
                select(Product.id).where(
                    Product.tenant_id == tenant_id,
                    Product.id.in_(unique_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    if set(found) != unique_ids:
        raise DomainError(
            "product_not_found",
            "One or more products were not found",
            status_code=404,
        )


@router.get("/categories", response_model=Page[CategoryOut])
async def list_categories(
    identity: CatalogReader,
    db: DbSession,
    branch_id: UUID | None = None,
    limit: int = Query(default=100, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
) -> Page[CategoryOut]:
    tenant_id = require_tenant(identity)
    predicates = [Category.tenant_id == tenant_id]
    if branch_id:
        predicates.append(or_(Category.branch_id == branch_id, Category.branch_id.is_(None)))
    total = (await db.execute(select(func.count(Category.id)).where(*predicates))).scalar_one()
    items = (
        (
            await db.execute(
                select(Category)
                .where(*predicates)
                .order_by(Category.sort_order, Category.name)
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return Page(
        items=[CategoryOut.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
async def create_category(
    payload: CategoryCreate,
    identity: CatalogManager,
    db: DbSession,
) -> CategoryOut:
    tenant_id = require_tenant(identity)
    branch_id = payload.branch_id
    if branch_id is not None:
        await _validate_branch(db, tenant_id, branch_id)
    if payload.parent_id is not None:
        parent = (
            await db.execute(
                select(Category).where(
                    Category.id == payload.parent_id, Category.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if parent is None:
            raise DomainError("category_not_found", "Parent category not found", status_code=404)
    category = Category(
        tenant_id=tenant_id,
        branch_id=branch_id,
        parent_id=payload.parent_id,
        name=payload.name,
        description=payload.description,
        color=payload.color,
        sort_order=payload.sort_order,
        is_active=payload.is_active,
        translations=payload.translations,
    )
    db.add(category)
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="catalog.category_created",
        resource_type="category",
        resource_id=category.id,
        new_value={"name": category.name},
    )
    await db.commit()
    return CategoryOut.model_validate(category)


@router.patch("/categories/{category_id}", response_model=CategoryOut)
async def update_category(
    category_id: UUID,
    payload: CategoryUpdate,
    identity: CatalogManager,
    db: DbSession,
) -> CategoryOut:
    category = (
        await db.execute(
            select(Category).where(
                Category.id == category_id, Category.tenant_id == require_tenant(identity)
            )
        )
    ).scalar_one_or_none()
    if category is None:
        raise DomainError("category_not_found", "Category not found", status_code=404)
    previous = {"name": category.name, "is_active": category.is_active}
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(category, key, value)
    add_audit_log(
        db,
        identity=identity,
        action="catalog.category_updated",
        resource_type="category",
        resource_id=category.id,
        previous_value=previous,
        new_value={"name": category.name, "is_active": category.is_active},
    )
    await db.commit()
    return CategoryOut.model_validate(category)


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    category_id: UUID,
    identity: CatalogManager,
    db: DbSession,
) -> None:
    category = (
        await db.execute(
            select(Category).where(
                Category.id == category_id, Category.tenant_id == require_tenant(identity)
            )
        )
    ).scalar_one_or_none()
    if category is None:
        raise DomainError("category_not_found", "Category not found", status_code=404)
    category.is_active = False
    add_audit_log(
        db,
        identity=identity,
        action="catalog.category_archived",
        resource_type="category",
        resource_id=category.id,
    )
    await db.commit()


@router.get("/products", response_model=Page[ProductOut])
async def list_products(
    identity: CatalogReader,
    db: DbSession,
    category_id: UUID | None = None,
    search: str | None = None,
    include_inactive: bool = False,
    limit: int = Query(default=100, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
) -> Page[ProductOut]:
    predicates = [Product.tenant_id == require_tenant(identity)]
    if category_id:
        predicates.append(Product.category_id == category_id)
    if search:
        predicates.append(Product.name.ilike(f"%{search.strip()}%"))
    if not include_inactive:
        predicates.append(Product.is_active.is_(True))
    total = (await db.execute(select(func.count(Product.id)).where(*predicates))).scalar_one()
    rows = (
        (
            await db.execute(
                select(Product)
                .where(*predicates)
                .order_by(Product.sort_order, Product.name)
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return Page(
        items=[ProductOut.model_validate(item) for item in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/products/csv-template")
async def download_product_csv_template(identity: CatalogReader) -> Response:
    require_tenant(identity)
    return Response(
        content=build_product_csv_template(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="dixora-urun-sablonu.csv"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.get("/products/import-template")
async def download_product_import_template(identity: CatalogReader) -> Response:
    require_tenant(identity)
    return Response(
        content=build_product_xlsx_template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="dixora-urun-sablonu.xlsx"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.post("/products/csv-import", response_model=ProductCsvImportResult)
async def import_products_csv(
    identity: CatalogManager,
    db: DbSession,
    file: Annotated[UploadFile, File(description="XLSX or UTF-8 CSV product file")],
    dry_run: bool = Query(default=True),
) -> ProductCsvImportResult:
    tenant_id = require_tenant(identity)
    filename = (file.filename or "").lower()
    content_type = (file.content_type or "").lower().split(";", 1)[0]
    allowed_content_types = {
        "text/csv",
        "application/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/plain",
        "application/octet-stream",
    }
    if not filename.endswith((".csv", ".xlsx")):
        raise DomainError(
            "invalid_product_import_file",
            "Only .xlsx and .csv files are supported",
            status_code=415,
        )
    if content_type and content_type not in allowed_content_types:
        raise DomainError(
            "invalid_product_import_file",
            "Only Excel and CSV files are supported",
            status_code=415,
        )
    maximum_bytes = MAX_PRODUCT_XLSX_BYTES if filename.endswith(".xlsx") else MAX_PRODUCT_CSV_BYTES
    data = await file.read(maximum_bytes + 1)
    if len(data) > maximum_bytes:
        raise DomainError(
            "product_import_file_too_large",
            f"Product import file must not exceed {maximum_bytes} bytes",
            status_code=413,
        )

    parsed = parse_product_import(data, filename)
    errors = list(parsed.errors)
    categories = (
        (
            await db.execute(
                select(Category).where(
                    Category.tenant_id == tenant_id,
                    Category.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    category_candidates: dict[str, list[Category]] = {}
    for category in categories:
        category_candidates.setdefault(normalize_lookup_name(category.name), []).append(category)

    station_predicates = [
        PreparationStation.tenant_id == tenant_id,
        PreparationStation.is_active.is_(True),
    ]
    if identity.branch_id is not None:
        station_predicates.append(PreparationStation.branch_id == identity.branch_id)
    stations = (
        (await db.execute(select(PreparationStation).where(*station_predicates))).scalars().all()
    )
    station_candidates: dict[str, list[PreparationStation]] = {}
    for station_item in stations:
        station_candidates.setdefault(normalize_lookup_name(station_item.name), []).append(
            station_item
        )

    existing_skus = {
        sku.casefold()
        for sku in (
            (
                await db.execute(
                    select(Product.sku).where(
                        Product.tenant_id == tenant_id,
                        Product.sku.is_not(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        if sku
    }
    csv_skus: set[str] = set()
    validated_rows: list[tuple[ParsedProductCsvRow, Category, PreparationStation | None]] = []
    for row in parsed.rows:
        row_errors: list[ProductCsvImportError] = []
        matched_categories = category_candidates.get(normalize_lookup_name(row.category), [])
        if len(matched_categories) == 0:
            row_errors.append(
                ProductCsvImportError(
                    row_number=row.row_number,
                    field="category",
                    message=f"'{row.category}' adlı aktif kategori bulunamadı.",
                )
            )
        elif len(matched_categories) > 1:
            row_errors.append(
                ProductCsvImportError(
                    row_number=row.row_number,
                    field="category",
                    message=f"'{row.category}' adı birden fazla kategoriyle eşleşiyor.",
                )
            )

        matched_station: PreparationStation | None = None
        if row.station:
            matched_stations = station_candidates.get(normalize_lookup_name(row.station), [])
            if len(matched_stations) == 0:
                row_errors.append(
                    ProductCsvImportError(
                        row_number=row.row_number,
                        field="station",
                        message=f"'{row.station}' adlı aktif hazırlama istasyonu bulunamadı.",
                    )
                )
            elif len(matched_stations) > 1:
                row_errors.append(
                    ProductCsvImportError(
                        row_number=row.row_number,
                        field="station",
                        message=f"'{row.station}' adı birden fazla istasyonla eşleşiyor.",
                    )
                )
            else:
                matched_station = matched_stations[0]

        if row.sku:
            normalized_sku = row.sku.casefold()
            if normalized_sku in existing_skus:
                row_errors.append(
                    ProductCsvImportError(
                        row_number=row.row_number,
                        field="sku",
                        message=f"'{row.sku}' SKU kodu bu işletmede zaten kullanılıyor.",
                    )
                )
            elif normalized_sku in csv_skus:
                row_errors.append(
                    ProductCsvImportError(
                        row_number=row.row_number,
                        field="sku",
                        message=f"'{row.sku}' SKU kodu dosyada birden fazla kez kullanılmış.",
                    )
                )
            csv_skus.add(normalized_sku)

        errors.extend(row_errors)
        if not row_errors and len(matched_categories) == 1:
            validated_rows.append((row, matched_categories[0], matched_station))

    previews = [
        ProductCsvPreviewRow(
            row_number=row.row_number,
            category=row.category,
            name=row.name,
            selling_price=row.selling_price,
            sku=row.sku,
        )
        for row, _, _ in validated_rows
    ]
    imported_rows = 0
    if not dry_run:
        for row, category, station in validated_rows:
            product = Product(
                tenant_id=tenant_id,
                category_id=category.id,
                preparation_station_id=station.id if station else None,
                name=row.name,
                internal_name=row.internal_name,
                description=row.description,
                sku=row.sku,
                selling_price=row.selling_price,
                cost_price=row.cost_price,
                tax_rate=row.tax_rate,
                is_active=row.is_active,
                is_available=row.is_available,
                qr_visible=row.qr_visible,
                waiter_visible=row.waiter_visible,
                preparation_minutes=row.preparation_minutes,
                track_inventory=row.track_inventory,
                sort_order=0,
                allergens=[],
                tags=[],
            )
            db.add(product)
            await db.flush()
            add_audit_log(
                db,
                identity=identity,
                action="catalog.product_imported",
                resource_type="product",
                resource_id=product.id,
                new_value={
                    "name": product.name,
                    "selling_price": str(product.selling_price),
                    "source": "xlsx" if filename.endswith(".xlsx") else "csv",
                    "row_number": row.row_number,
                },
            )
            imported_rows += 1
        if imported_rows:
            await db.commit()

    valid_rows = len(validated_rows)
    failed_rows = max(parsed.total_rows - valid_rows, 0)
    if dry_run:
        result_status = "FAILED" if valid_rows == 0 else "PARTIAL" if errors else "READY"
    else:
        result_status = "FAILED" if imported_rows == 0 else "PARTIAL" if errors else "SUCCESS"
    return ProductCsvImportResult(
        status=result_status,
        dry_run=dry_run,
        total_rows=parsed.total_rows,
        valid_rows=valid_rows,
        imported_rows=imported_rows,
        failed_rows=failed_rows,
        rows=previews,
        errors=errors,
    )


@router.get("/products/{product_id}", response_model=ProductDetailOut)
async def get_product(
    product_id: UUID,
    identity: CatalogReader,
    db: DbSession,
) -> ProductDetailOut:
    product = (
        await db.execute(
            select(Product).where(
                Product.id == product_id, Product.tenant_id == require_tenant(identity)
            )
        )
    ).scalar_one_or_none()
    if product is None:
        raise DomainError("product_not_found", "Product not found", status_code=404)
    group_ids = (
        (
            await db.execute(
                select(ProductModifierGroup.modifier_group_id).where(
                    ProductModifierGroup.tenant_id == require_tenant(identity),
                    ProductModifierGroup.product_id == product.id,
                )
            )
        )
        .scalars()
        .all()
    )
    groups = (
        (
            await db.execute(
                select(ModifierGroup)
                .where(
                    ModifierGroup.tenant_id == require_tenant(identity),
                    ModifierGroup.id.in_(group_ids),
                    ModifierGroup.is_active.is_(True),
                )
                .options(
                    selectinload(ModifierGroup.modifiers),
                    with_loader_criteria(Modifier, Modifier.is_active.is_(True)),
                )
                .order_by(ModifierGroup.sort_order)
            )
        )
        .scalars()
        .all()
        if group_ids
        else []
    )
    base = ProductOut.model_validate(product).model_dump()
    return ProductDetailOut(
        **base,
        modifier_groups=[
            ModifierGroupOut(
                **ModifierGroupOut.model_validate(group).model_dump(exclude={"product_ids"}),
                product_ids=[product.id],
            )
            for group in groups
        ],
    )


async def _validate_product_references(
    db: DbSession,
    *,
    tenant_id: UUID,
    category_id: UUID,
    station_id: UUID | None,
) -> None:
    category = (
        await db.execute(
            select(Category.id).where(Category.id == category_id, Category.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if category is None:
        raise DomainError("category_not_found", "Category not found", status_code=404)
    if station_id is not None:
        station = (
            await db.execute(
                select(PreparationStation.id).where(
                    PreparationStation.id == station_id,
                    PreparationStation.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if station is None:
            raise DomainError("station_not_found", "Preparation station not found", status_code=404)


async def _validate_modifier_groups(
    db: DbSession,
    *,
    tenant_id: UUID,
    group_ids: list[UUID],
) -> None:
    if not group_ids:
        return
    found = (
        (
            await db.execute(
                select(ModifierGroup.id).where(
                    ModifierGroup.tenant_id == tenant_id,
                    ModifierGroup.id.in_(set(group_ids)),
                    ModifierGroup.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    if len(set(found)) != len(set(group_ids)):
        raise DomainError(
            "modifier_group_not_found",
            "One or more modifier groups were not found",
            status_code=404,
        )


@router.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
async def create_product(
    payload: ProductCreate,
    identity: CatalogManager,
    db: DbSession,
) -> ProductOut:
    tenant_id = require_tenant(identity)
    await _validate_product_references(
        db,
        tenant_id=tenant_id,
        category_id=payload.category_id,
        station_id=payload.preparation_station_id,
    )
    await _validate_modifier_groups(db, tenant_id=tenant_id, group_ids=payload.modifier_group_ids)
    product = Product(
        tenant_id=tenant_id,
        **payload.model_dump(exclude={"modifier_group_ids"}),
    )
    db.add(product)
    await db.flush()
    for group_id in set(payload.modifier_group_ids):
        db.add(
            ProductModifierGroup(
                tenant_id=tenant_id,
                product_id=product.id,
                modifier_group_id=group_id,
            )
        )
    add_audit_log(
        db,
        identity=identity,
        action="catalog.product_created",
        resource_type="product",
        resource_id=product.id,
        new_value={"name": product.name, "selling_price": str(product.selling_price)},
    )
    await db.commit()
    return ProductOut.model_validate(product)


@router.patch("/products/{product_id}", response_model=ProductOut)
async def update_product(
    product_id: UUID,
    payload: ProductUpdate,
    identity: CatalogManager,
    db: DbSession,
) -> ProductOut:
    tenant_id = require_tenant(identity)
    product = (
        await db.execute(
            select(Product).where(Product.id == product_id, Product.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if product is None:
        raise DomainError("product_not_found", "Product not found", status_code=404)
    data = payload.model_dump(exclude_unset=True)
    modifier_group_ids = data.pop("modifier_group_ids", None)
    category_id = data.get("category_id", product.category_id)
    station_id = data.get("preparation_station_id", product.preparation_station_id)
    await _validate_product_references(
        db, tenant_id=tenant_id, category_id=category_id, station_id=station_id
    )
    if modifier_group_ids is not None:
        await _validate_modifier_groups(db, tenant_id=tenant_id, group_ids=modifier_group_ids)
        existing_links = (
            (
                await db.execute(
                    select(ProductModifierGroup).where(
                        ProductModifierGroup.tenant_id == tenant_id,
                        ProductModifierGroup.product_id == product.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        for link in existing_links:
            await db.delete(link)
        await db.flush()
        for group_id in set(modifier_group_ids):
            db.add(
                ProductModifierGroup(
                    tenant_id=tenant_id,
                    product_id=product.id,
                    modifier_group_id=group_id,
                )
            )
    previous = {
        "name": product.name,
        "selling_price": str(product.selling_price),
        "is_active": product.is_active,
    }
    for key, value in data.items():
        setattr(product, key, value)
    add_audit_log(
        db,
        identity=identity,
        action="catalog.product_updated",
        resource_type="product",
        resource_id=product.id,
        previous_value=previous,
        new_value={
            "name": product.name,
            "selling_price": str(product.selling_price),
            "is_active": product.is_active,
        },
    )
    await db.commit()
    return ProductOut.model_validate(product)


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: UUID,
    identity: CatalogManager,
    db: DbSession,
) -> None:
    product = (
        await db.execute(
            select(Product).where(
                Product.id == product_id, Product.tenant_id == require_tenant(identity)
            )
        )
    ).scalar_one_or_none()
    if product is None:
        raise DomainError("product_not_found", "Product not found", status_code=404)
    product.is_active = False
    product.is_available = False
    add_audit_log(
        db,
        identity=identity,
        action="catalog.product_archived",
        resource_type="product",
        resource_id=product.id,
    )
    await db.commit()


async def _product_for_translation(db: DbSession, tenant_id: UUID, product_id: UUID) -> Product:
    product = (
        await db.execute(
            select(Product).where(Product.id == product_id, Product.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if product is None:
        raise DomainError("product_not_found", "Product not found", status_code=404)
    return product


@router.get(
    "/products/{product_id}/translations",
    response_model=EntityTranslationsOut,
)
async def get_product_translations(
    product_id: UUID,
    identity: CatalogReader,
    db: DbSession,
) -> EntityTranslationsOut:
    """Every language this business has entered for one product."""
    tenant_id = require_tenant(identity)
    product = await _product_for_translation(db, tenant_id, product_id)

    rows = (
        (
            await db.execute(
                select(ContentTranslation).where(
                    ContentTranslation.tenant_id == tenant_id,
                    ContentTranslation.entity_type == "product",
                    ContentTranslation.entity_id == product.id,
                )
            )
        )
        .scalars()
        .all()
    )

    by_locale: dict[str, TranslationFieldsOut] = {}
    for row in rows:
        entry = by_locale.setdefault(row.locale, TranslationFieldsOut())
        source_text = product.name if row.field == "name" else (product.description or "")
        if row.source_hash != source_fingerprint(source_text):
            entry.stale = True
        if row.field == "name":
            entry.name = row.translated_text
        elif row.field == "description":
            entry.description = row.translated_text

    return EntityTranslationsOut(
        entity_type="product",
        entity_id=product.id,
        source_locale=SOURCE_LOCALE,
        supported_locales=[code for code in SUPPORTED_LOCALES if code != SOURCE_LOCALE],
        source=TranslationFieldsOut(name=product.name, description=product.description),
        translations=by_locale,
    )


@router.put(
    "/products/{product_id}/translations",
    response_model=EntityTranslationsOut,
)
async def update_product_translations(
    product_id: UUID,
    payload: EntityTranslationsUpdate,
    identity: CatalogManager,
    db: DbSession,
) -> EntityTranslationsOut:
    """Save the business's own translations. Blank values clear a translation."""
    tenant_id = require_tenant(identity)
    product = await _product_for_translation(db, tenant_id, product_id)

    for locale, fields in payload.translations.items():
        if locale == SOURCE_LOCALE or not is_supported_locale(locale):
            raise DomainError(
                "unsupported_locale",
                "This language is not available for the QR menu",
                status_code=422,
                details={"locale": locale},
            )
        for field, value, source_text in (
            ("name", fields.name, product.name),
            ("description", fields.description, product.description or ""),
        ):
            if value is None:
                continue
            await save_translation(
                db,
                tenant_id=tenant_id,
                entity_type="product",
                entity_id=product.id,
                field=field,
                locale=locale,
                translated_text=value,
                source_text=source_text,
            )

    add_audit_log(
        db,
        identity=identity,
        action="catalog.product_translations_updated",
        resource_type="product",
        resource_id=product.id,
        new_value={"locales": sorted(payload.translations)},
    )
    await db.commit()
    return await get_product_translations(product_id, identity, db)


@router.post("/stations", response_model=StationOut, status_code=status.HTTP_201_CREATED)
async def create_station(
    payload: StationCreate,
    identity: CatalogManager,
    db: DbSession,
) -> StationOut:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity, payload.branch_id)
    await _validate_branch(db, tenant_id, branch_id)
    station = PreparationStation(
        tenant_id=tenant_id,
        branch_id=branch_id,
        name=payload.name,
        code=payload.code.upper(),
        sort_order=payload.sort_order,
    )
    db.add(station)
    await db.commit()
    await db.refresh(station)
    return StationOut.model_validate(station)


@router.get("/stations", response_model=list[StationOut])
async def list_stations(
    identity: CatalogReader,
    db: DbSession,
    branch_id: UUID | None = None,
) -> list[StationOut]:
    selected_branch = require_branch(identity, branch_id)
    rows = (
        (
            await db.execute(
                select(PreparationStation)
                .where(
                    PreparationStation.tenant_id == require_tenant(identity),
                    PreparationStation.branch_id == selected_branch,
                )
                .order_by(PreparationStation.sort_order)
            )
        )
        .scalars()
        .all()
    )
    return [StationOut.model_validate(item) for item in rows]


def _modifier_group_output(
    group: ModifierGroup,
    *,
    product_ids: list[UUID],
) -> ModifierGroupOut:
    return ModifierGroupOut(
        **ModifierGroupOut.model_validate(group).model_dump(exclude={"product_ids"}),
        product_ids=product_ids,
    )


def _modifier_group_audit_value(
    group: ModifierGroup,
    *,
    product_ids: list[UUID],
) -> dict[str, object]:
    return {
        "name": group.name,
        "is_required": group.is_required,
        "minimum_selection": group.minimum_selection,
        "maximum_selection": group.maximum_selection,
        "sort_order": group.sort_order,
        "is_active": group.is_active,
        "product_ids": [str(product_id) for product_id in product_ids],
    }


def _modifier_audit_value(modifier: Modifier) -> dict[str, object]:
    return {
        "name": modifier.name,
        "price_delta": str(modifier.price_delta),
        "sort_order": modifier.sort_order,
        "is_active": modifier.is_active,
    }


@router.post(
    "/modifier-groups", response_model=ModifierGroupOut, status_code=status.HTTP_201_CREATED
)
async def create_modifier_group(
    payload: ModifierGroupCreate,
    identity: CatalogManager,
    db: DbSession,
) -> ModifierGroupOut:
    tenant_id = require_tenant(identity)
    await _validate_product_ids(db, tenant_id=tenant_id, product_ids=payload.product_ids)
    group = ModifierGroup(
        tenant_id=tenant_id,
        name=payload.name,
        is_required=payload.is_required,
        minimum_selection=payload.minimum_selection,
        maximum_selection=payload.maximum_selection,
    )
    db.add(group)
    await db.flush()
    for product_id in set(payload.product_ids):
        db.add(
            ProductModifierGroup(
                tenant_id=tenant_id,
                product_id=product_id,
                modifier_group_id=group.id,
            )
        )
    assigned_product_ids = list(dict.fromkeys(payload.product_ids))
    add_audit_log(
        db,
        identity=identity,
        action="catalog.modifier_group_created",
        resource_type="modifier_group",
        resource_id=group.id,
        new_value=_modifier_group_audit_value(
            group,
            product_ids=assigned_product_ids,
        ),
    )
    await db.commit()
    await db.refresh(group, ["modifiers"])
    return _modifier_group_output(group, product_ids=assigned_product_ids)


@router.get("/modifier-groups", response_model=list[ModifierGroupOut])
async def list_modifier_groups(
    identity: CatalogReader,
    db: DbSession,
    product_id: UUID | None = None,
) -> list[ModifierGroupOut]:
    tenant_id = require_tenant(identity)
    statement = (
        select(ModifierGroup)
        .where(ModifierGroup.tenant_id == tenant_id, ModifierGroup.is_active.is_(True))
        .options(
            selectinload(ModifierGroup.modifiers),
            with_loader_criteria(Modifier, Modifier.is_active.is_(True)),
        )
        .order_by(ModifierGroup.sort_order, ModifierGroup.name)
    )
    if product_id is not None:
        product_exists = (
            await db.execute(
                select(Product.id).where(Product.id == product_id, Product.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if product_exists is None:
            raise DomainError("product_not_found", "Product not found", status_code=404)
        statement = statement.join(
            ProductModifierGroup,
            ProductModifierGroup.modifier_group_id == ModifierGroup.id,
        ).where(
            ProductModifierGroup.tenant_id == tenant_id,
            ProductModifierGroup.product_id == product_id,
        )
    groups = (await db.execute(statement)).scalars().unique().all()
    group_ids = [group.id for group in groups]
    links = (
        (
            await db.execute(
                select(
                    ProductModifierGroup.modifier_group_id,
                    ProductModifierGroup.product_id,
                ).where(
                    ProductModifierGroup.tenant_id == tenant_id,
                    ProductModifierGroup.modifier_group_id.in_(group_ids),
                )
            )
        ).all()
        if group_ids
        else []
    )
    products_by_group: dict[UUID, list[UUID]] = {}
    for group_id, linked_product_id in links:
        products_by_group.setdefault(group_id, []).append(linked_product_id)
    return [
        _modifier_group_output(group, product_ids=products_by_group.get(group.id, []))
        for group in groups
    ]


@router.patch("/modifier-groups/{group_id}", response_model=ModifierGroupOut)
async def update_modifier_group(
    group_id: UUID,
    payload: ModifierGroupUpdate,
    identity: CatalogManager,
    db: DbSession,
) -> ModifierGroupOut:
    tenant_id = require_tenant(identity)
    group = (
        await db.execute(
            select(ModifierGroup)
            .where(ModifierGroup.id == group_id, ModifierGroup.tenant_id == tenant_id)
            .options(
                selectinload(ModifierGroup.modifiers),
                with_loader_criteria(Modifier, Modifier.is_active.is_(True)),
            )
        )
    ).scalar_one_or_none()
    if group is None:
        raise DomainError(
            "modifier_group_not_found",
            "Modifier group not found",
            status_code=404,
        )

    links = (
        (
            await db.execute(
                select(ProductModifierGroup).where(
                    ProductModifierGroup.tenant_id == tenant_id,
                    ProductModifierGroup.modifier_group_id == group.id,
                )
            )
        )
        .scalars()
        .all()
    )
    existing_product_ids = [link.product_id for link in links]
    previous = _modifier_group_audit_value(
        group,
        product_ids=existing_product_ids,
    )
    data = payload.model_dump(exclude_unset=True)
    requested_product_ids = data.pop("product_ids", None)

    minimum_selection = data.get("minimum_selection", group.minimum_selection)
    if minimum_selection is None:
        raise DomainError(
            "invalid_modifier_selection_limits",
            "minimum_selection must not be null",
            status_code=422,
        )
    maximum_selection = (
        data["maximum_selection"] if "maximum_selection" in data else group.maximum_selection
    )
    if maximum_selection is not None and maximum_selection < minimum_selection:
        raise DomainError(
            "invalid_modifier_selection_limits",
            "maximum_selection must be >= minimum_selection",
            status_code=422,
        )

    assigned_product_ids = existing_product_ids
    if requested_product_ids is not None:
        await _validate_product_ids(
            db,
            tenant_id=tenant_id,
            product_ids=requested_product_ids,
        )
        for link in links:
            await db.delete(link)
        await db.flush()
        assigned_product_ids = list(dict.fromkeys(requested_product_ids))
        for product_id in assigned_product_ids:
            db.add(
                ProductModifierGroup(
                    tenant_id=tenant_id,
                    product_id=product_id,
                    modifier_group_id=group.id,
                )
            )

    for key, value in data.items():
        setattr(group, key, value)
    add_audit_log(
        db,
        identity=identity,
        action="catalog.modifier_group_updated",
        resource_type="modifier_group",
        resource_id=group.id,
        previous_value=previous,
        new_value=_modifier_group_audit_value(
            group,
            product_ids=assigned_product_ids,
        ),
    )
    await db.commit()
    return _modifier_group_output(group, product_ids=assigned_product_ids)


@router.delete("/modifier-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_modifier_group(
    group_id: UUID,
    identity: CatalogManager,
    db: DbSession,
) -> None:
    tenant_id = require_tenant(identity)
    group = (
        await db.execute(
            select(ModifierGroup).where(
                ModifierGroup.id == group_id,
                ModifierGroup.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if group is None:
        raise DomainError(
            "modifier_group_not_found",
            "Modifier group not found",
            status_code=404,
        )
    previous = {"is_active": group.is_active}
    group.is_active = False
    add_audit_log(
        db,
        identity=identity,
        action="catalog.modifier_group_archived",
        resource_type="modifier_group",
        resource_id=group.id,
        previous_value=previous,
        new_value={"is_active": group.is_active},
    )
    await db.commit()


@router.post("/modifiers", response_model=ModifierOut, status_code=status.HTTP_201_CREATED)
async def create_modifier(
    payload: ModifierCreate,
    identity: CatalogManager,
    db: DbSession,
) -> ModifierOut:
    tenant_id = require_tenant(identity)
    group = (
        await db.execute(
            select(ModifierGroup).where(
                ModifierGroup.id == payload.group_id,
                ModifierGroup.tenant_id == tenant_id,
                ModifierGroup.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if group is None:
        raise DomainError("modifier_group_not_found", "Modifier group not found", status_code=404)
    modifier = Modifier(tenant_id=tenant_id, **payload.model_dump())
    db.add(modifier)
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="catalog.modifier_created",
        resource_type="modifier",
        resource_id=modifier.id,
        new_value=_modifier_audit_value(modifier),
    )
    await db.commit()
    return ModifierOut.model_validate(modifier)


@router.patch("/modifiers/{modifier_id}", response_model=ModifierOut)
async def update_modifier(
    modifier_id: UUID,
    payload: ModifierUpdate,
    identity: CatalogManager,
    db: DbSession,
) -> ModifierOut:
    tenant_id = require_tenant(identity)
    modifier = (
        await db.execute(
            select(Modifier).where(
                Modifier.id == modifier_id,
                Modifier.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if modifier is None:
        raise DomainError("modifier_not_found", "Modifier not found", status_code=404)
    previous = _modifier_audit_value(modifier)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(modifier, key, value)
    add_audit_log(
        db,
        identity=identity,
        action="catalog.modifier_updated",
        resource_type="modifier",
        resource_id=modifier.id,
        previous_value=previous,
        new_value=_modifier_audit_value(modifier),
    )
    await db.commit()
    return ModifierOut.model_validate(modifier)


@router.delete("/modifiers/{modifier_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_modifier(
    modifier_id: UUID,
    identity: CatalogManager,
    db: DbSession,
) -> None:
    tenant_id = require_tenant(identity)
    modifier = (
        await db.execute(
            select(Modifier).where(
                Modifier.id == modifier_id,
                Modifier.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if modifier is None:
        raise DomainError("modifier_not_found", "Modifier not found", status_code=404)
    previous = {"is_active": modifier.is_active}
    modifier.is_active = False
    add_audit_log(
        db,
        identity=identity,
        action="catalog.modifier_archived",
        resource_type="modifier",
        resource_id=modifier.id,
        previous_value=previous,
        new_value={"is_active": modifier.is_active},
    )
    await db.commit()
