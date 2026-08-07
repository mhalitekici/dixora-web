from __future__ import annotations

from decimal import Decimal
from io import BytesIO
from re import fullmatch
from urllib.parse import urlsplit
from uuid import UUID

import pytest
from PIL import Image
from sqlalchemy import select

from app.models import AuditLog, Category, Product, Tenant
from app.models.enums import TenantState
from app.services.media_storage import MediaObjectNotFound
from app.services.product_images import generate_product_image_key
from tests.conftest import ApiContext, auth_headers, login, seeded_resources


def _image_bytes(image_format: str, size: tuple[int, int] = (128, 128)) -> bytes:
    buffer = BytesIO()
    image = Image.new("RGB", size, color=(236, 90, 32))
    image.save(buffer, format=image_format)
    return buffer.getvalue()


def _media_path(image_url: str) -> str:
    return urlsplit(image_url).path


def _object_key(image_url: str) -> str:
    return _media_path(image_url).removeprefix("/api/v1/media/")


async def test_product_image_upload_get_replace_and_delete(api: ApiContext) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    resources = await seeded_resources(api, headers)
    burger = resources["burger"]
    png_data = _image_bytes("PNG")

    uploaded = await api.client.post(
        f"/api/v1/media/products/{burger['id']}/image",
        headers=headers,
        files={"file": ("burger.png", png_data, "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    first_url = uploaded.json()["image_url"]
    assert first_url.startswith("http://test/api/v1/media/products/")
    first_key = _object_key(first_url)
    assert fullmatch(r"products/[0-9a-f]{24}/[0-9a-f]{32}\.png", first_key)

    public_menu = await api.client.get("/api/v1/qr/public/dixora-lab/merkez")
    assert public_menu.status_code == 200, public_menu.text
    public_burger = next(
        product
        for product in public_menu.json()["products"]
        if product["name"] == burger["name"]
    )
    assert public_burger["image_url"] == f"/api/v1/media/{first_key}"

    delivered = await api.client.get(_media_path(first_url))
    assert delivered.status_code == 200, delivered.text
    assert delivered.content == png_data
    assert delivered.headers["content-type"] == "image/png"
    assert delivered.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert delivered.headers["x-content-type-options"] == "nosniff"
    assert delivered.headers["etag"]

    not_modified = await api.client.get(
        _media_path(first_url),
        headers={"If-None-Match": delivered.headers["etag"]},
    )
    assert not_modified.status_code == 304, not_modified.text

    jpeg_data = _image_bytes("JPEG")
    replaced = await api.client.post(
        f"/api/v1/media/products/{burger['id']}/image",
        headers=headers,
        files={"file": ("burger.jpg", jpeg_data, "image/jpeg")},
    )
    assert replaced.status_code == 200, replaced.text
    replacement_url = replaced.json()["image_url"]
    replacement_key = _object_key(replacement_url)
    assert replacement_url != first_url
    assert replacement_key.endswith(".jpg")

    old_delivery = await api.client.get(_media_path(first_url))
    assert old_delivery.status_code == 404, old_delivery.text
    with pytest.raises(MediaObjectNotFound):
        await api.media_storage.get_object(first_key)

    replacement_delivery = await api.client.get(_media_path(replacement_url))
    assert replacement_delivery.status_code == 200, replacement_delivery.text
    assert replacement_delivery.content == jpeg_data
    assert replacement_delivery.headers["content-type"] == "image/jpeg"

    deleted = await api.client.delete(
        f"/api/v1/media/products/{burger['id']}/image",
        headers=headers,
    )
    assert deleted.status_code == 204, deleted.text
    with pytest.raises(MediaObjectNotFound):
        await api.media_storage.get_object(replacement_key)
    assert (await api.client.get(_media_path(replacement_url))).status_code == 404

    product = await api.client.get(
        f"/api/v1/catalog/products/{burger['id']}",
        headers=headers,
    )
    assert product.status_code == 200, product.text
    assert product.json()["image_url"] is None

    async with api.database.session_factory() as db:
        actions = (
            (
                await db.execute(
                    select(AuditLog.action).where(
                        AuditLog.resource_id == burger["id"],
                        AuditLog.action.in_(
                            {
                                "catalog.product_image_uploaded",
                                "catalog.product_image_deleted",
                            }
                        ),
                    )
                )
            )
            .scalars()
            .all()
        )
    assert actions.count("catalog.product_image_uploaded") == 2
    assert actions.count("catalog.product_image_deleted") == 1


async def test_catalog_rejects_direct_product_image_urls(api: ApiContext) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    resources = await seeded_resources(api, headers)
    response = await api.client.patch(
        f"/api/v1/catalog/products/{resources['burger']['id']}",
        headers=headers,
        json={"image_url": "https://tracking.invalid/product.png"},
    )
    assert response.status_code == 422


async def test_qr_logo_multipart_upload_is_scoped_and_removable(api: ApiContext) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    png_data = _image_bytes("PNG", (256, 128))

    uploaded = await api.client.post(
        "/api/v1/media/qr-menu/logo",
        headers=headers,
        files={"file": ("logo.png", png_data, "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    logo_url = uploaded.json()["logo_url"]
    assert "/qr-menu/" in logo_url
    assert "/logo/" in logo_url

    delivered = await api.client.get(_media_path(logo_url))
    assert delivered.status_code == 200, delivered.text
    assert delivered.content == png_data
    assert delivered.headers["x-content-type-options"] == "nosniff"

    removed = await api.client.delete("/api/v1/media/qr-menu/logo", headers=headers)
    assert removed.status_code == 204, removed.text
    assert (await api.client.get(_media_path(logo_url))).status_code == 404


async def test_product_image_rejects_corrupt_mismatched_oversized_and_bad_dimensions(
    api: ApiContext,
) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    burger = (await seeded_resources(api, headers))["burger"]
    endpoint = f"/api/v1/media/products/{burger['id']}/image"

    corrupt = await api.client.post(
        endpoint,
        headers=headers,
        files={"file": ("broken.png", b"not-a-real-image", "image/png")},
    )
    assert corrupt.status_code == 422, corrupt.text
    assert corrupt.json()["error"]["code"] == "invalid_image"

    png_data = _image_bytes("PNG")
    mismatched = await api.client.post(
        endpoint,
        headers=headers,
        files={"file": ("fake.jpg", png_data, "image/jpeg")},
    )
    assert mismatched.status_code == 422, mismatched.text
    assert mismatched.json()["error"]["code"] == "image_mime_mismatch"

    invalid_dimensions = await api.client.post(
        endpoint,
        headers=headers,
        files={"file": ("tiny.png", _image_bytes("PNG", (32, 128)), "image/png")},
    )
    assert invalid_dimensions.status_code == 422, invalid_dimensions.text
    assert invalid_dimensions.json()["error"]["code"] == "invalid_image_dimensions"

    unsupported = await api.client.post(
        endpoint,
        headers=headers,
        files={"file": ("legacy.gif", b"GIF89a", "image/gif")},
    )
    assert unsupported.status_code == 415, unsupported.text
    assert unsupported.json()["error"]["code"] == "unsupported_image_type"

    webp_data = _image_bytes("WEBP")
    webp = await api.client.post(
        endpoint,
        headers=headers,
        files={"file": ("burger.webp", webp_data, "image/webp")},
    )
    assert webp.status_code == 200, webp.text
    assert webp.json()["image_url"].endswith(".webp")

    api.settings.media_max_dimension = 100
    excessive_dimensions = await api.client.post(
        endpoint,
        headers=headers,
        files={"file": ("wide.png", png_data, "image/png")},
    )
    assert excessive_dimensions.status_code == 422, excessive_dimensions.text
    assert excessive_dimensions.json()["error"]["code"] == "invalid_image_dimensions"
    api.settings.media_max_dimension = 8192

    api.settings.media_max_upload_bytes = 128
    oversized = await api.client.post(
        endpoint,
        headers=headers,
        files={"file": ("large.png", b"x" * 129, "image/png")},
    )
    assert oversized.status_code == 413, oversized.text
    assert oversized.json()["error"]["code"] == "image_too_large"


async def test_product_media_enforces_permission_tenant_scope_and_active_reference(
    api: ApiContext,
) -> None:
    owner = await login(api)
    owner_headers = auth_headers(owner)
    resources = await seeded_resources(api, owner_headers)
    burger = resources["burger"]
    image_data = _image_bytes("PNG")

    waiter = await login(api, username="waiter@dixora.test")
    forbidden = await api.client.post(
        f"/api/v1/media/products/{burger['id']}/image",
        headers=auth_headers(waiter),
        files={"file": ("burger.png", image_data, "image/png")},
    )
    assert forbidden.status_code == 403, forbidden.text
    assert forbidden.json()["error"]["details"]["missing_permissions"] == ["products.manage"]

    async with api.database.session_factory() as db:
        foreign_tenant = Tenant(
            name="Foreign Media Tenant",
            slug="foreign-media-tenant",
            state=TenantState.ACTIVE,
            is_active=True,
        )
        db.add(foreign_tenant)
        await db.flush()
        foreign_category = Category(
            tenant_id=foreign_tenant.id,
            name="Foreign Media Category",
        )
        db.add(foreign_category)
        await db.flush()
        foreign_product = Product(
            tenant_id=foreign_tenant.id,
            category_id=foreign_category.id,
            name="Foreign Media Product",
            selling_price=Decimal("75.00"),
        )
        db.add(foreign_product)
        await db.commit()
        foreign_product_id = str(foreign_product.id)

    cross_tenant_upload = await api.client.post(
        f"/api/v1/media/products/{foreign_product_id}/image",
        headers=owner_headers,
        files={"file": ("foreign.png", image_data, "image/png")},
    )
    assert cross_tenant_upload.status_code == 404, cross_tenant_upload.text

    cross_tenant_delete = await api.client.delete(
        f"/api/v1/media/products/{foreign_product_id}/image",
        headers=owner_headers,
    )
    assert cross_tenant_delete.status_code == 404, cross_tenant_delete.text

    tenant_id = UUID(owner["user"]["tenant_id"])
    orphan_key = generate_product_image_key(tenant_id, "png")
    await api.media_storage.put_object(orphan_key, image_data, "image/png")
    orphan_delivery = await api.client.get(f"/api/v1/media/{orphan_key}")
    assert orphan_delivery.status_code == 404, orphan_delivery.text

    invalid_key = await api.client.get("/api/v1/media/not/a/product-image.png")
    assert invalid_key.status_code == 404, invalid_key.text
