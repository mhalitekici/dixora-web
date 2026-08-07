from __future__ import annotations

from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile, status
from sqlalchemy import select

from app.config import Settings
from app.dependencies import (
    DbSession,
    Identity,
    get_app_settings,
    require_branch,
    require_permissions,
    require_tenant,
)
from app.errors import DomainError
from app.logging import logger
from app.models import Branch, Product, QrMenuConfig
from app.schemas import ProductOut, QrConfigOut
from app.services.audit import add_audit_log
from app.services.media_storage import (
    MediaObjectNotFound,
    MediaStorage,
    MediaStorageError,
)
from app.services.product_images import (
    generate_product_image_key,
    generate_qr_menu_image_key,
    owned_product_image_key,
    owned_qr_menu_image_key,
    parse_product_image_key,
    parse_qr_menu_image_key,
    public_media_url,
    validate_product_image_upload,
)
from app.services.qr_config import new_qr_menu_config

router = APIRouter(prefix="/media", tags=["media"])
ProductMediaManager = Annotated[Identity, Depends(require_permissions("products.manage"))]
QrMediaManager = Annotated[Identity, Depends(require_permissions("qr.manage"))]


def get_media_storage(request: Request) -> MediaStorage:
    return cast(MediaStorage, request.app.state.media_storage)


MediaStorageDependency = Annotated[MediaStorage, Depends(get_media_storage)]
SettingsDependency = Annotated[Settings, Depends(get_app_settings)]


@router.post("/products/{product_id}/image", response_model=ProductOut)
async def upload_product_image(
    product_id: UUID,
    identity: ProductMediaManager,
    db: DbSession,
    storage: MediaStorageDependency,
    settings: SettingsDependency,
    file: Annotated[UploadFile, File(description="JPEG, PNG, or WebP product image")],
) -> ProductOut:
    tenant_id = require_tenant(identity)
    product = (
        await db.execute(
            select(Product)
            .where(Product.id == product_id, Product.tenant_id == tenant_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if product is None:
        raise DomainError("product_not_found", "Product not found", status_code=404)

    image = await validate_product_image_upload(file, settings)
    object_key = generate_product_image_key(tenant_id, image.extension)
    image_url = public_media_url(settings, object_key)
    previous_image_url = product.image_url
    previous_object_key = owned_product_image_key(
        settings,
        previous_image_url,
        tenant_id,
    )

    try:
        await storage.put_object(object_key, image.data, image.content_type)
    except MediaStorageError as exc:
        raise DomainError(
            "media_storage_unavailable",
            "Product image storage is unavailable",
            status_code=503,
        ) from exc

    product.image_url = image_url
    add_audit_log(
        db,
        identity=identity,
        action="catalog.product_image_uploaded",
        resource_type="product",
        resource_id=product.id,
        previous_value={"image_url": previous_image_url},
        new_value={
            "image_url": image_url,
            "content_type": image.content_type,
            "size_bytes": len(image.data),
            "width": image.width,
            "height": image.height,
        },
    )
    try:
        await db.commit()
    except Exception:
        await _delete_object_safely(
            storage,
            object_key,
            operation="rollback_cleanup",
        )
        raise

    if previous_object_key is not None and previous_object_key != object_key:
        await _delete_object_safely(
            storage,
            previous_object_key,
            operation="replacement_cleanup",
        )
    return ProductOut.model_validate(product)


@router.delete(
    "/products/{product_id}/image",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_product_image(
    product_id: UUID,
    identity: ProductMediaManager,
    db: DbSession,
    storage: MediaStorageDependency,
    settings: SettingsDependency,
) -> None:
    tenant_id = require_tenant(identity)
    product = (
        await db.execute(
            select(Product)
            .where(Product.id == product_id, Product.tenant_id == tenant_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if product is None:
        raise DomainError("product_not_found", "Product not found", status_code=404)

    previous_image_url = product.image_url
    object_key = owned_product_image_key(
        settings,
        previous_image_url,
        tenant_id,
    )
    if previous_image_url is None:
        return

    product.image_url = None
    add_audit_log(
        db,
        identity=identity,
        action="catalog.product_image_deleted",
        resource_type="product",
        resource_id=product.id,
        previous_value={"image_url": previous_image_url},
        new_value={"image_url": None},
    )
    await db.commit()
    if object_key is not None:
        await _delete_object_safely(
            storage,
            object_key,
            operation="delete_cleanup",
        )


@router.post("/qr-menu/{asset_kind}", response_model=QrConfigOut)
async def upload_qr_menu_image(
    asset_kind: Literal["logo", "cover"],
    identity: QrMediaManager,
    db: DbSession,
    storage: MediaStorageDependency,
    settings: SettingsDependency,
    file: Annotated[UploadFile, File(description="JPEG, PNG, or WebP QR menu image")],
    branch_id: UUID | None = Query(default=None),
) -> QrConfigOut:
    tenant_id = require_tenant(identity)
    selected_branch = require_branch(identity, branch_id)
    branch_exists = (
        await db.execute(
            select(Branch.id).where(
                Branch.id == selected_branch,
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if branch_exists is None:
        raise DomainError("branch_not_found", "Branch not found", status_code=404)

    config = (
        await db.execute(
            select(QrMenuConfig)
            .where(
                QrMenuConfig.tenant_id == tenant_id,
                QrMenuConfig.branch_id == selected_branch,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if config is None:
        config = new_qr_menu_config(tenant_id=tenant_id, branch_id=selected_branch)
        db.add(config)

    image = await validate_product_image_upload(file, settings)
    object_key = generate_qr_menu_image_key(
        tenant_id,
        selected_branch,
        asset_kind,
        image.extension,
    )
    image_url = public_media_url(settings, object_key)
    field_name = "logo_url" if asset_kind == "logo" else "cover_image_url"
    previous_image_url = getattr(config, field_name)
    previous_object_key = owned_qr_menu_image_key(
        settings,
        previous_image_url,
        tenant_id,
        selected_branch,
        asset_kind,
    )

    try:
        await storage.put_object(object_key, image.data, image.content_type)
    except MediaStorageError as exc:
        raise DomainError(
            "media_storage_unavailable",
            "QR menu image storage is unavailable",
            status_code=503,
        ) from exc

    setattr(config, field_name, image_url)
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action=f"qr.{asset_kind}_uploaded",
        resource_type="qr_menu_config",
        resource_id=config.id,
        previous_value={field_name: previous_image_url},
        new_value={
            field_name: image_url,
            "content_type": image.content_type,
            "size_bytes": len(image.data),
            "width": image.width,
            "height": image.height,
        },
    )
    try:
        await db.commit()
    except Exception:
        await _delete_object_safely(storage, object_key, operation="rollback_cleanup")
        raise

    if previous_object_key is not None and previous_object_key != object_key:
        await _delete_object_safely(
            storage,
            previous_object_key,
            operation="replacement_cleanup",
        )
    return QrConfigOut.model_validate(config)


@router.delete("/qr-menu/{asset_kind}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_qr_menu_image(
    asset_kind: Literal["logo", "cover"],
    identity: QrMediaManager,
    db: DbSession,
    storage: MediaStorageDependency,
    settings: SettingsDependency,
    branch_id: UUID | None = Query(default=None),
) -> None:
    tenant_id = require_tenant(identity)
    selected_branch = require_branch(identity, branch_id)
    config = (
        await db.execute(
            select(QrMenuConfig)
            .where(
                QrMenuConfig.tenant_id == tenant_id,
                QrMenuConfig.branch_id == selected_branch,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if config is None:
        raise DomainError("qr_config_not_found", "QR menu configuration not found", status_code=404)

    field_name = "logo_url" if asset_kind == "logo" else "cover_image_url"
    previous_image_url = getattr(config, field_name)
    object_key = owned_qr_menu_image_key(
        settings,
        previous_image_url,
        tenant_id,
        selected_branch,
        asset_kind,
    )
    if previous_image_url is None:
        return

    setattr(config, field_name, None)
    add_audit_log(
        db,
        identity=identity,
        action=f"qr.{asset_kind}_deleted",
        resource_type="qr_menu_config",
        resource_id=config.id,
        previous_value={field_name: previous_image_url},
        new_value={field_name: None},
    )
    await db.commit()
    if object_key is not None:
        await _delete_object_safely(storage, object_key, operation="delete_cleanup")


@router.get("/{object_key:path}")
async def get_public_media(
    object_key: str,
    request: Request,
    db: DbSession,
    storage: MediaStorageDependency,
    settings: SettingsDependency,
) -> Response:
    parsed_product_key = parse_product_image_key(object_key)
    parsed_qr_key = parse_qr_menu_image_key(object_key)
    if parsed_product_key is None and parsed_qr_key is None:
        raise DomainError("media_not_found", "Media object not found", status_code=404)

    if parsed_product_key is not None:
        parsed_value = parsed_product_key.value
        image_url = public_media_url(settings, parsed_value)
        owner_conditions = [
            Product.image_url == image_url,
            Product.is_active.is_(True),
        ]
        if parsed_product_key.legacy_tenant_id is not None:
            owner_conditions.append(
                Product.tenant_id == parsed_product_key.legacy_tenant_id
            )
        owner_id = (
            await db.execute(
                select(Product.id).where(*owner_conditions)
            )
        ).scalar_one_or_none()
    else:
        assert parsed_qr_key is not None
        parsed_value = parsed_qr_key.value
        image_url = public_media_url(settings, parsed_value)
        image_field = (
            QrMenuConfig.logo_url
            if parsed_qr_key.asset_kind == "logo"
            else QrMenuConfig.cover_image_url
        )
        owner_conditions = [image_field == image_url]
        if parsed_qr_key.legacy_tenant_id is not None:
            owner_conditions.extend(
                (
                    QrMenuConfig.tenant_id == parsed_qr_key.legacy_tenant_id,
                    QrMenuConfig.branch_id == parsed_qr_key.legacy_branch_id,
                )
            )
        owner_id = (
            await db.execute(
                select(QrMenuConfig.id).where(*owner_conditions)
            )
        ).scalar_one_or_none()
    if owner_id is None:
        raise DomainError("media_not_found", "Media object not found", status_code=404)

    try:
        stored = await storage.get_object(parsed_value)
    except MediaObjectNotFound as exc:
        raise DomainError("media_not_found", "Media object not found", status_code=404) from exc
    except MediaStorageError as exc:
        raise DomainError(
            "media_storage_unavailable",
            "Media storage is unavailable",
            status_code=503,
        ) from exc

    if stored.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise DomainError("media_not_found", "Media object not found", status_code=404)
    etag = f'"{stored.etag}"'
    headers = {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": str(len(stored.data)),
        "ETag": etag,
        "X-Content-Type-Options": "nosniff",
    }
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(
        content=stored.data,
        media_type=stored.content_type,
        headers=headers,
    )


async def _delete_object_safely(
    storage: MediaStorage,
    object_key: str,
    *,
    operation: str,
) -> None:
    try:
        await storage.delete_object(object_key)
    except MediaObjectNotFound:
        return
    except MediaStorageError as exc:
        logger.warning(
            "media.object_cleanup_failed",
            operation=operation,
            object_key=object_key,
            error=type(exc).__name__,
        )
