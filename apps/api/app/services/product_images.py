from __future__ import annotations

import warnings
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from re import Pattern, compile
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from app.config import Settings
from app.errors import DomainError

_FORMAT_MEDIA_TYPES = {
    "JPEG": ("image/jpeg", "jpg"),
    "PNG": ("image/png", "png"),
    "WEBP": ("image/webp", "webp"),
}
_LEGACY_PRODUCT_IMAGE_KEY: Pattern[str] = compile(
    r"^tenants/(?P<tenant_id>[0-9a-f]{32})/products/"
    r"(?P<object_id>[0-9a-f]{32})\.(?P<extension>jpg|png|webp)$"
)
_LEGACY_QR_MENU_IMAGE_KEY: Pattern[str] = compile(
    r"^tenants/(?P<tenant_id>[0-9a-f]{32})/qr-menu/"
    r"(?P<branch_id>[0-9a-f]{32})/(?P<asset_kind>logo|cover)/"
    r"(?P<object_id>[0-9a-f]{32})\.(?P<extension>jpg|png|webp)$"
)
_PRODUCT_IMAGE_KEY: Pattern[str] = compile(
    r"^products/(?P<tenant_scope>[0-9a-f]{24})/"
    r"(?P<object_id>[0-9a-f]{32})\.(?P<extension>jpg|png|webp)$"
)
_QR_MENU_IMAGE_KEY: Pattern[str] = compile(
    r"^qr-menu/(?P<tenant_scope>[0-9a-f]{24})/"
    r"(?P<branch_scope>[0-9a-f]{24})/(?P<asset_kind>logo|cover)/"
    r"(?P<object_id>[0-9a-f]{32})\.(?P<extension>jpg|png|webp)$"
)
_READ_CHUNK_SIZE = 1024 * 1024


@dataclass(frozen=True, slots=True)
class ValidatedProductImage:
    data: bytes
    content_type: str
    extension: str
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class ProductImageKey:
    tenant_scope: str
    value: str
    legacy_tenant_id: UUID | None = None


@dataclass(frozen=True, slots=True)
class QrMenuImageKey:
    tenant_scope: str
    branch_scope: str
    asset_kind: Literal["logo", "cover"]
    value: str
    legacy_tenant_id: UUID | None = None
    legacy_branch_id: UUID | None = None


async def validate_product_image_upload(
    file: UploadFile,
    settings: Settings,
) -> ValidatedProductImage:
    declared_content_type = (file.content_type or "").lower().split(";", 1)[0].strip()
    if declared_content_type not in {item[0] for item in _FORMAT_MEDIA_TYPES.values()}:
        raise DomainError(
            "unsupported_image_type",
            "Only JPEG, PNG, and WebP product images are supported",
            status_code=415,
        )
    data = await _read_limited(file, settings.media_max_upload_bytes)
    return await run_in_threadpool(
        _decode_and_validate,
        data,
        declared_content_type,
        settings.media_min_dimension,
        settings.media_max_dimension,
        settings.media_max_pixels,
    )


async def _read_limited(file: UploadFile, maximum_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(_READ_CHUNK_SIZE):
        total += len(chunk)
        if total > maximum_bytes:
            raise DomainError(
                "image_too_large",
                f"Product image must not exceed {maximum_bytes} bytes",
                status_code=413,
            )
        chunks.append(chunk)
    if total == 0:
        raise DomainError("invalid_image", "Product image is empty", status_code=422)
    return b"".join(chunks)


def _decode_and_validate(
    data: bytes,
    declared_content_type: str,
    minimum_dimension: int,
    maximum_dimension: int,
    maximum_pixels: int,
) -> ValidatedProductImage:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data), formats=list(_FORMAT_MEDIA_TYPES)) as image:
                detected_format = image.format
                width, height = image.size
                if (
                    width < minimum_dimension
                    or height < minimum_dimension
                    or width > maximum_dimension
                    or height > maximum_dimension
                    or width * height > maximum_pixels
                ):
                    raise DomainError(
                        "invalid_image_dimensions",
                        (
                            "Product image dimensions must be between "
                            f"{minimum_dimension} and {maximum_dimension} pixels, "
                            f"with at most {maximum_pixels} total pixels"
                        ),
                        status_code=422,
                    )
                image.verify()
            with Image.open(BytesIO(data), formats=list(_FORMAT_MEDIA_TYPES)) as image:
                image.load()
    except DomainError:
        raise
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        ValueError,
    ) as exc:
        raise DomainError(
            "invalid_image",
            "Uploaded file is not a valid JPEG, PNG, or WebP image",
            status_code=422,
        ) from exc

    media = _FORMAT_MEDIA_TYPES.get(detected_format or "")
    if media is None:
        raise DomainError(
            "invalid_image",
            "Uploaded file is not a valid JPEG, PNG, or WebP image",
            status_code=422,
        )
    detected_content_type, extension = media
    if detected_content_type != declared_content_type:
        raise DomainError(
            "image_mime_mismatch",
            "Declared image MIME type does not match the decoded image",
            status_code=422,
        )
    return ValidatedProductImage(
        data=data,
        content_type=detected_content_type,
        extension=extension,
        width=width,
        height=height,
    )


def _opaque_scope(resource_id: UUID) -> str:
    """Return a stable non-reversible namespace without exposing a database UUID."""

    return sha256(resource_id.bytes).hexdigest()[:24]


def generate_product_image_key(tenant_id: UUID, extension: str) -> str:
    return f"products/{_opaque_scope(tenant_id)}/{uuid4().hex}.{extension}"


def generate_qr_menu_image_key(
    tenant_id: UUID,
    branch_id: UUID,
    asset_kind: Literal["logo", "cover"],
    extension: str,
) -> str:
    return (
        f"qr-menu/{_opaque_scope(tenant_id)}/{_opaque_scope(branch_id)}/"
        f"{asset_kind}/{uuid4().hex}.{extension}"
    )


def parse_product_image_key(value: str) -> ProductImageKey | None:
    match = _PRODUCT_IMAGE_KEY.fullmatch(value)
    if match is not None:
        return ProductImageKey(tenant_scope=match.group("tenant_scope"), value=value)

    legacy_match = _LEGACY_PRODUCT_IMAGE_KEY.fullmatch(value)
    if legacy_match is None:
        return None
    legacy_tenant_id = UUID(hex=legacy_match.group("tenant_id"))
    return ProductImageKey(
        tenant_scope=_opaque_scope(legacy_tenant_id),
        value=value,
        legacy_tenant_id=legacy_tenant_id,
    )


def parse_qr_menu_image_key(value: str) -> QrMenuImageKey | None:
    match = _QR_MENU_IMAGE_KEY.fullmatch(value)
    if match is not None:
        asset_kind: Literal["logo", "cover"] = (
            "logo" if match.group("asset_kind") == "logo" else "cover"
        )
        return QrMenuImageKey(
            tenant_scope=match.group("tenant_scope"),
            branch_scope=match.group("branch_scope"),
            asset_kind=asset_kind,
            value=value,
        )

    legacy_match = _LEGACY_QR_MENU_IMAGE_KEY.fullmatch(value)
    if legacy_match is None:
        return None
    legacy_tenant_id = UUID(hex=legacy_match.group("tenant_id"))
    legacy_branch_id = UUID(hex=legacy_match.group("branch_id"))
    legacy_asset_kind: Literal["logo", "cover"] = (
        "logo" if legacy_match.group("asset_kind") == "logo" else "cover"
    )
    return QrMenuImageKey(
        tenant_scope=_opaque_scope(legacy_tenant_id),
        branch_scope=_opaque_scope(legacy_branch_id),
        asset_kind=legacy_asset_kind,
        value=value,
        legacy_tenant_id=legacy_tenant_id,
        legacy_branch_id=legacy_branch_id,
    )


def public_media_url(settings: Settings, object_key: str) -> str:
    return f"{settings.media_public_base_url.rstrip('/')}/{object_key}"


def managed_image_key(settings: Settings, image_url: str | None) -> str | None:
    if not image_url:
        return None
    try:
        parsed = urlsplit(image_url)
        if parsed.scheme not in {"", "http", "https"} or parsed.query or parsed.fragment:
            return None
        if parsed.username or parsed.password:
            return None
        base_path = urlsplit(settings.media_public_base_url).path.rstrip("/") + "/"
        prefixes = {base_path, "/api/v1/media/"}
        for prefix in prefixes:
            if parsed.path.startswith(prefix):
                key = parsed.path[len(prefix) :]
                if parse_product_image_key(key) or parse_qr_menu_image_key(key):
                    return key
    except ValueError:
        pass
    return None


def public_image_key(object_key: str) -> str | None:
    product = parse_product_image_key(object_key)
    if product is not None:
        return f"products/{product.tenant_scope}/{product.value.rsplit('/', 1)[-1]}"
    qr = parse_qr_menu_image_key(object_key)
    if qr is not None:
        filename = qr.value.rsplit("/", 1)[-1]
        return f"qr-menu/{qr.tenant_scope}/{qr.branch_scope}/{qr.asset_kind}/{filename}"
    return None


def safe_public_image_url(settings: Settings, image_url: str | None) -> str | None:
    """Same-origin opaque URL, including aliases for legacy UUID-bearing keys.

    Storage and historical references stay untouched. The media route verifies
    ownership before resolving an alias to a private legacy object.
    """
    key = managed_image_key(settings, image_url)
    public_key = public_image_key(key) if key else None
    return f"/api/v1/media/{public_key}" if public_key else None


def owned_product_image_key(
    settings: Settings,
    image_url: str | None,
    tenant_id: UUID,
) -> str | None:
    if image_url is None:
        return None
    object_key = managed_image_key(settings, image_url)
    if object_key is None:
        return None
    parsed = parse_product_image_key(object_key)
    if parsed is None or parsed.tenant_scope != _opaque_scope(tenant_id):
        return None
    return parsed.value


def owned_qr_menu_image_key(
    settings: Settings,
    image_url: str | None,
    tenant_id: UUID,
    branch_id: UUID,
    asset_kind: Literal["logo", "cover"],
) -> str | None:
    if image_url is None:
        return None
    object_key = managed_image_key(settings, image_url)
    if object_key is None:
        return None
    parsed = parse_qr_menu_image_key(object_key)
    if (
        parsed is None
        or parsed.tenant_scope != _opaque_scope(tenant_id)
        or parsed.branch_scope != _opaque_scope(branch_id)
        or parsed.asset_kind != asset_kind
    ):
        return None
    return parsed.value
