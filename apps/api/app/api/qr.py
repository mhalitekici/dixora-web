from __future__ import annotations

import hashlib
import hmac
from datetime import UTC, timedelta
from typing import Annotated
from uuid import UUID, uuid4

import jwt
from fastapi import APIRouter, Depends, Header, Query, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload, with_loader_criteria

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
from app.models import (
    Branch,
    Category,
    DiningTable,
    LoyaltyMembership,
    Modifier,
    ModifierGroup,
    Product,
    ProductModifierGroup,
    QrMenuConfig,
    QrOrderRequest,
    Tenant,
)
from app.models.enums import OrderSource, QrOrderMode, QrRequestStatus
from app.schemas import (
    OrderCreate,
    OrderItemInput,
    OrderModifierInput,
    PublicBranchOut,
    PublicMenuCategory,
    PublicMenuModifier,
    PublicMenuModifierGroup,
    PublicMenuOut,
    PublicMenuProduct,
    PublicQrConfigOut,
    PublicQrRequestOut,
    QrConfigOut,
    QrConfigUpdate,
    QrRequestCreate,
    QrRequestOut,
)
from app.security import utcnow
from app.services.audit import add_audit_log
from app.services.loyalty import attach_membership_to_order, membership_from_token
from app.services.orders import create_order
from app.services.product_images import safe_public_image_url
from app.services.public_refs import public_reference
from app.services.qr_config import new_qr_menu_config
from app.services.translation import (
    SOURCE_LOCALE,
    TranslationKey,
    is_supported_locale,
    translate_fields,
)

router = APIRouter(prefix="/qr", tags=["qr-menu"])
QrReader = Annotated[Identity, Depends(require_permissions("qr.read"))]
QrManager = Annotated[Identity, Depends(require_permissions("qr.manage"))]
QrApprover = Annotated[Identity, Depends(require_permissions("qr.approve"))]


async def _validate_qr_branch(db: DbSession, *, tenant_id: UUID, branch_id: UUID) -> None:
    branch = (
        await db.execute(
            select(Branch.id).where(
                Branch.id == branch_id,
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if branch is None:
        raise DomainError("branch_not_found", "Branch not found", status_code=404)


def _resolve_public_resource(
    value: str,
    references: dict[str, UUID],
    allowed_ids: set[UUID],
) -> UUID | None:
    resolved = references.get(value)
    if resolved is not None:
        return resolved
    # Temporary backward compatibility for already-open clients; UUIDs are never
    # emitted by public responses and still must belong to the current tenant scope.
    try:
        legacy_id = UUID(value)
    except (TypeError, ValueError):
        return None
    return legacy_id if legacy_id in allowed_ids else None


def _public_qr_request_out(
    settings: Settings,
    qr_request: QrOrderRequest,
) -> PublicQrRequestOut:
    return PublicQrRequestOut(
        reference=public_reference(
            settings,
            tenant_id=qr_request.tenant_id,
            kind="request",
            resource_id=qr_request.id,
        ),
        status=qr_request.status,
        expires_at=qr_request.expires_at,
        created_at=qr_request.created_at,
    )


def _issue_qr_session(
    settings: Settings,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    table_id: UUID,
    table_token: str,
) -> str:
    now = utcnow()
    return jwt.encode(
        {
            "typ": "qr_session",
            "context_hash": _qr_session_context_hash(
                settings,
                tenant_id=tenant_id,
                branch_id=branch_id,
                table_id=table_id,
                table_token=table_token,
            ),
            "jti": uuid4().hex,
            "iat": now,
            "nbf": now,
            "exp": now + timedelta(minutes=30),
            "iss": "dixora-api",
            "aud": "dixora-qr",
        },
        settings.jwt_secret.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )


def _qr_session_context_hash(
    settings: Settings,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    table_id: UUID,
    table_token: str,
) -> str:
    message = b"\0".join(
        (tenant_id.bytes, branch_id.bytes, table_id.bytes, table_token.encode("utf-8"))
    )
    return hmac.new(
        settings.jwt_secret.get_secret_value().encode("utf-8"),
        message,
        hashlib.sha256,
    ).hexdigest()


def _decode_qr_session(settings: Settings, token: str) -> dict[str, str]:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            audience="dixora-qr",
            issuer="dixora-api",
        )
    except jwt.ExpiredSignatureError as exc:
        raise DomainError("qr_session_expired", "QR session has expired", status_code=401) from exc
    except jwt.PyJWTError as exc:
        raise DomainError("invalid_qr_session", "QR session is invalid", status_code=401) from exc
    if payload.get("typ") != "qr_session":
        raise DomainError("invalid_qr_session", "QR session is invalid", status_code=401)
    return payload


async def _public_context(
    db: DbSession,
    business_slug: str,
    branch_slug: str,
) -> tuple[Tenant, Branch, QrMenuConfig]:
    tenant = (
        await db.execute(
            select(Tenant).where(
                Tenant.slug == business_slug,
                Tenant.is_active.is_(True),
                Tenant.state.notin_(["PAST_DUE", "SUSPENDED", "CANCELLED", "ARCHIVED"]),
            )
        )
    ).scalar_one_or_none()
    if tenant is None:
        raise DomainError("menu_not_found", "Menu not found", status_code=404)
    branch = (
        await db.execute(
            select(Branch).where(
                Branch.tenant_id == tenant.id,
                Branch.slug == branch_slug,
                Branch.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if branch is None:
        raise DomainError("menu_not_found", "Menu not found", status_code=404)
    config = (
        await db.execute(
            select(QrMenuConfig).where(
                QrMenuConfig.tenant_id == tenant.id,
                QrMenuConfig.branch_id == branch.id,
                QrMenuConfig.is_enabled.is_(True),
                QrMenuConfig.order_mode != QrOrderMode.DISABLED,
            )
        )
    ).scalar_one_or_none()
    if config is None:
        raise DomainError("menu_disabled", "QR menu is not available", status_code=404)
    return tenant, branch, config


@router.get("/public/{business_slug}/branches", response_model=list[PublicBranchOut])
async def public_branches(
    business_slug: str,
    db: DbSession,
    response: Response,
) -> list[PublicBranchOut]:
    response.headers["Cache-Control"] = "private, no-store"
    tenant = (
        await db.execute(
            select(Tenant).where(
                Tenant.slug == business_slug,
                Tenant.is_active.is_(True),
                Tenant.state.notin_(["PAST_DUE", "SUSPENDED", "CANCELLED", "ARCHIVED"]),
            )
        )
    ).scalar_one_or_none()
    if tenant is None:
        raise DomainError("menu_not_found", "Menu not found", status_code=404)
    branches = (
        (
            await db.execute(
                select(Branch)
                .join(
                    QrMenuConfig,
                    (QrMenuConfig.branch_id == Branch.id) & (QrMenuConfig.tenant_id == tenant.id),
                )
                .where(
                    Branch.tenant_id == tenant.id,
                    Branch.is_active.is_(True),
                    QrMenuConfig.is_enabled.is_(True),
                    QrMenuConfig.order_mode != QrOrderMode.DISABLED,
                )
                .order_by(Branch.name)
            )
        )
        .scalars()
        .all()
    )
    return [PublicBranchOut(name=branch.name, slug=branch.slug) for branch in branches]


@router.get("/public/{business_slug}/{branch_slug}", response_model=PublicMenuOut)
async def public_menu(
    business_slug: str,
    branch_slug: str,
    db: DbSession,
    response: Response,
    settings: Settings = Depends(get_app_settings),
    table_token: str | None = Query(default=None, min_length=16, max_length=64),
    lang: str = Query(default=SOURCE_LOCALE, min_length=2, max_length=12),
) -> PublicMenuOut:
    response.headers["Cache-Control"] = "private, no-store"
    locale = lang if is_supported_locale(lang) else SOURCE_LOCALE
    tenant, branch, config = await _public_context(db, business_slug, branch_slug)
    table: DiningTable | None = None
    session_token: str | None = None
    if table_token:
        table = (
            await db.execute(
                select(DiningTable).where(
                    DiningTable.tenant_id == tenant.id,
                    DiningTable.branch_id == branch.id,
                    DiningTable.qr_token == table_token,
                    DiningTable.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if table is None:
            raise DomainError("table_not_found", "Table QR code is invalid", status_code=404)
        session_token = _issue_qr_session(
            settings,
            tenant_id=tenant.id,
            branch_id=branch.id,
            table_id=table.id,
            table_token=table.qr_token,
        )
    categories = (
        (
            await db.execute(
                select(Category)
                .where(
                    Category.tenant_id == tenant.id,
                    or_(Category.branch_id == branch.id, Category.branch_id.is_(None)),
                    Category.is_active.is_(True),
                )
                .order_by(Category.sort_order, Category.name)
            )
        )
        .scalars()
        .all()
    )
    category_ids = [category.id for category in categories]
    products = (
        (
            await db.execute(
                select(Product)
                .where(
                    Product.tenant_id == tenant.id,
                    Product.category_id.in_(category_ids),
                    Product.is_active.is_(True),
                    Product.is_available.is_(True),
                    Product.qr_visible.is_(True),
                )
                .order_by(Product.sort_order, Product.name)
            )
        )
        .scalars()
        .all()
        if category_ids
        else []
    )
    product_ids = [product.id for product in products]
    links = (
        (
            await db.execute(
                select(ProductModifierGroup).where(
                    ProductModifierGroup.tenant_id == tenant.id,
                    ProductModifierGroup.product_id.in_(product_ids),
                )
            )
        )
        .scalars()
        .all()
        if product_ids
        else []
    )
    group_ids = {link.modifier_group_id for link in links}
    groups = (
        (
            await db.execute(
                select(ModifierGroup)
                .where(
                    ModifierGroup.tenant_id == tenant.id,
                    ModifierGroup.id.in_(group_ids),
                    ModifierGroup.is_active.is_(True),
                )
                .options(
                    selectinload(ModifierGroup.modifiers),
                    with_loader_criteria(Modifier, Modifier.is_active.is_(True)),
                )
                .order_by(ModifierGroup.sort_order, ModifierGroup.name)
            )
        )
        .scalars()
        .all()
        if group_ids
        else []
    )
    groups_by_id = {group.id: group for group in groups}
    group_ids_by_product: dict[UUID, list[UUID]] = {}
    for link in links:
        group_ids_by_product.setdefault(link.product_id, []).append(link.modifier_group_id)

    translation_keys: list[TranslationKey] = []
    for category in categories:
        translation_keys.append(
            TranslationKey("category", category.id, "name", category.name)
        )
        if category.description:
            translation_keys.append(
                TranslationKey("category", category.id, "description", category.description)
            )
    for product in products:
        translation_keys.append(TranslationKey("product", product.id, "name", product.name))
        if product.description:
            translation_keys.append(
                TranslationKey("product", product.id, "description", product.description)
            )
    for group in groups:
        translation_keys.append(
            TranslationKey("modifier_group", group.id, "name", group.name)
        )
        for modifier in group.modifiers:
            translation_keys.append(
                TranslationKey("modifier", modifier.id, "name", modifier.name)
            )
    translations = await translate_fields(
        db,
        tenant_id=tenant.id,
        locale=locale,
        keys=translation_keys,
    )

    def localized(entity_type: str, entity_id: UUID, field: str, fallback: str) -> str:
        return translations.get((entity_type, entity_id, field), fallback)

    def localized_optional(
        entity_type: str, entity_id: UUID, field: str, fallback: str | None
    ) -> str | None:
        if not fallback:
            return fallback
        return translations.get((entity_type, entity_id, field), fallback)

    return PublicMenuOut(
        business=tenant.name,
        branch=branch.name,
        context_key=f"{tenant.slug}:{branch.slug}",
        table_name=table.name if table else None,
        config=PublicQrConfigOut(
            menu_name=config.menu_name,
            order_mode=config.order_mode,
            logo_url=safe_public_image_url(settings, config.logo_url),
            cover_image_url=safe_public_image_url(settings, config.cover_image_url),
            primary_color=config.primary_color,
            language=config.language,
            currency=config.currency,
            customer_notes_enabled=config.customer_notes_enabled,
            allergens_visible=config.allergens_visible,
        ),
        categories=[
            PublicMenuCategory(
                id=public_reference(
                    settings,
                    tenant_id=tenant.id,
                    kind="category",
                    resource_id=category.id,
                ),
                name=localized("category", category.id, "name", category.name),
                description=localized_optional(
                    "category", category.id, "description", category.description
                ),
                color=category.color,
                sort_order=category.sort_order,
            )
            for category in categories
        ],
        products=[
            PublicMenuProduct(
                id=public_reference(
                    settings,
                    tenant_id=tenant.id,
                    kind="product",
                    resource_id=product.id,
                ),
                category_id=public_reference(
                    settings,
                    tenant_id=tenant.id,
                    kind="category",
                    resource_id=product.category_id,
                ),
                name=localized("product", product.id, "name", product.name),
                description=localized_optional(
                    "product", product.id, "description", product.description
                ),
                selling_price=product.selling_price,
                image_url=safe_public_image_url(settings, product.image_url),
                allergens=product.allergens,
                calories=product.calories,
                modifier_groups=[
                    PublicMenuModifierGroup(
                        id=public_reference(
                            settings,
                            tenant_id=tenant.id,
                            kind="modifier_group",
                            resource_id=groups_by_id[group_id].id,
                        ),
                        name=localized(
                            "modifier_group",
                            groups_by_id[group_id].id,
                            "name",
                            groups_by_id[group_id].name,
                        ),
                        is_required=groups_by_id[group_id].is_required,
                        minimum_selection=groups_by_id[group_id].minimum_selection,
                        maximum_selection=groups_by_id[group_id].maximum_selection,
                        modifiers=[
                            PublicMenuModifier(
                                id=public_reference(
                                    settings,
                                    tenant_id=tenant.id,
                                    kind="modifier",
                                    resource_id=modifier.id,
                                ),
                                name=localized(
                                    "modifier", modifier.id, "name", modifier.name
                                ),
                                price_delta=modifier.price_delta,
                            )
                            for modifier in groups_by_id[group_id].modifiers
                        ],
                    )
                    for group_id in group_ids_by_product.get(product.id, [])
                    if group_id in groups_by_id
                ],
            )
            for product in products
        ],
        session_token=session_token,
    )


@router.post(
    "/public/{business_slug}/{branch_slug}/requests",
    response_model=PublicQrRequestOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_public_qr_request(
    business_slug: str,
    branch_slug: str,
    payload: QrRequestCreate,
    request: Request,
    db: DbSession,
    settings: Settings = Depends(get_app_settings),
    loyalty_token: str | None = Header(default=None, alias="X-Loyalty-Token"),
) -> PublicQrRequestOut:
    tenant, branch, config = await _public_context(db, business_slug, branch_slug)
    if config.order_mode in {QrOrderMode.MENU_ONLY, QrOrderMode.DISABLED}:
        raise DomainError("qr_ordering_disabled", "QR ordering is disabled", status_code=409)
    claims = _decode_qr_session(settings, payload.session_token)
    table = (
        await db.execute(
            select(DiningTable).where(
                DiningTable.tenant_id == tenant.id,
                DiningTable.branch_id == branch.id,
                DiningTable.qr_token == payload.table_token,
                DiningTable.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if table is None:
        raise DomainError("table_not_found", "Table QR code is invalid", status_code=404)
    expected_context = _qr_session_context_hash(
        settings,
        tenant_id=tenant.id,
        branch_id=branch.id,
        table_id=table.id,
        table_token=payload.table_token,
    )
    supplied_context = claims.get("context_hash")
    if not isinstance(supplied_context, str) or not hmac.compare_digest(
        supplied_context, expected_context
    ):
        raise DomainError(
            "invalid_qr_session", "QR session context is invalid", status_code=401
        )
    existing = (
        await db.execute(
            select(QrOrderRequest).where(
                QrOrderRequest.tenant_id == tenant.id,
                QrOrderRequest.idempotency_key == payload.idempotency_key,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return _public_qr_request_out(settings, existing)
    pending_for_table = (
        await db.execute(
            select(func.count(QrOrderRequest.id)).where(
                QrOrderRequest.tenant_id == tenant.id,
                QrOrderRequest.branch_id == branch.id,
                QrOrderRequest.table_id == table.id,
                QrOrderRequest.status == QrRequestStatus.PENDING,
                QrOrderRequest.expires_at > utcnow(),
            )
        )
    ).scalar_one()
    if pending_for_table >= 3:
        raise DomainError(
            "qr_request_rate_limited",
            "Too many pending requests for this table",
            status_code=429,
        )
    allowed_category_ids = (
        (
            await db.execute(
                select(Category.id).where(
                    Category.tenant_id == tenant.id,
                    or_(Category.branch_id == branch.id, Category.branch_id.is_(None)),
                    Category.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    eligible_product_ids = set(
        (
            await db.execute(
                select(Product.id).where(
                    Product.tenant_id == tenant.id,
                    Product.category_id.in_(allowed_category_ids),
                    Product.is_active.is_(True),
                    Product.is_available.is_(True),
                    Product.qr_visible.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    product_references = {
        public_reference(
            settings,
            tenant_id=tenant.id,
            kind="product",
            resource_id=product_id,
        ): product_id
        for product_id in eligible_product_ids
    }
    selected_modifier_refs = {
        selected.modifier_id for item in payload.items for selected in item.modifiers
    }
    eligible_modifier_ids: set[UUID] = set()
    modifier_references: dict[str, UUID] = {}
    if selected_modifier_refs:
        eligible_modifier_ids = set(
            (
                await db.execute(
                    select(Modifier.id).where(
                        Modifier.tenant_id == tenant.id,
                        Modifier.is_active.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )
        modifier_references = {
            public_reference(
                settings,
                tenant_id=tenant.id,
                kind="modifier",
                resource_id=modifier_id,
            ): modifier_id
            for modifier_id in eligible_modifier_ids
        }

    resolved_items: list[OrderItemInput] = []
    for item in payload.items:
        product_id = _resolve_public_resource(
            item.product_id,
            product_references,
            eligible_product_ids,
        )
        if product_id is None:
            raise DomainError(
                "product_not_available",
                "One or more products are unavailable",
                status_code=409,
            )
        resolved_modifiers: list[OrderModifierInput] = []
        for selected in item.modifiers:
            modifier_id = _resolve_public_resource(
                selected.modifier_id,
                modifier_references,
                eligible_modifier_ids,
            )
            if modifier_id is None:
                raise DomainError(
                    "modifier_not_available",
                    "One or more modifiers are unavailable",
                    status_code=409,
                )
            resolved_modifiers.append(
                OrderModifierInput(
                    modifier_id=modifier_id,
                    quantity=selected.quantity,
                )
            )
        resolved_items.append(
            OrderItemInput(
                product_id=product_id,
                quantity=item.quantity,
                note=item.note,
                modifiers=resolved_modifiers,
            )
        )
    membership = (
        await membership_from_token(
            db,
            tenant_id=tenant.id,
            raw_token=loyalty_token,
            branch_id=branch.id,
        )
        if loyalty_token
        else None
    )
    qr_request = QrOrderRequest(
        tenant_id=tenant.id,
        branch_id=branch.id,
        table_id=table.id,
        loyalty_membership_id=membership.id if membership else None,
        status=QrRequestStatus.PENDING,
        idempotency_key=payload.idempotency_key,
        session_nonce_hash=str(claims.get("jti", ""))[:64],
        items_payload=[item.model_dump(mode="json") for item in resolved_items],
        customer_note=payload.customer_note,
        request_metadata={
            "ip": request.client.host if request.client else None,
            "user_agent": request.headers.get("user-agent"),
        },
        expires_at=utcnow() + timedelta(minutes=30),
    )
    db.add(qr_request)
    await db.flush()
    if config.order_mode == QrOrderMode.AUTOMATIC_ACCEPTANCE:
        order_payload = OrderCreate(
            table_id=table.id,
            source=OrderSource.QR,
            items=resolved_items,
            idempotency_key=f"qr:{qr_request.id}",
            auto_accept=True,
        )
        order, _ = await create_order(
            db,
            tenant_id=tenant.id,
            branch_id=branch.id,
            actor_user_id=None,
            payload=order_payload,
            source_override=OrderSource.QR,
        )
        if membership is not None:
            await attach_membership_to_order(db, order=order, membership=membership)
        qr_request.order_id = order.id
        qr_request.status = QrRequestStatus.APPROVED
        qr_request.resolved_at = utcnow()
    await db.commit()
    await request.app.state.realtime.broadcast(
        tenant.id,
        branch.id,
        {
            "type": "qr.request.created",
            "request_id": str(qr_request.id),
            "table_id": str(table.id),
            "status": qr_request.status.value,
        },
    )
    return _public_qr_request_out(settings, qr_request)


@router.get("/config", response_model=QrConfigOut)
async def get_qr_config(
    identity: QrReader,
    db: DbSession,
    branch_id: UUID | None = None,
) -> QrConfigOut:
    tenant_id = require_tenant(identity)
    selected_branch = require_branch(identity, branch_id)
    await _validate_qr_branch(db, tenant_id=tenant_id, branch_id=selected_branch)
    config = (
        await db.execute(
            select(QrMenuConfig).where(
                QrMenuConfig.tenant_id == tenant_id,
                QrMenuConfig.branch_id == selected_branch,
            )
        )
    ).scalar_one_or_none()
    if config is None:
        raise DomainError("qr_config_not_found", "QR menu configuration not found", status_code=404)
    return QrConfigOut.model_validate(config)


@router.put("/config", response_model=QrConfigOut)
async def upsert_qr_config(
    payload: QrConfigUpdate,
    identity: QrManager,
    db: DbSession,
    branch_id: UUID | None = None,
) -> QrConfigOut:
    tenant_id = require_tenant(identity)
    selected_branch = require_branch(identity, branch_id)
    await _validate_qr_branch(db, tenant_id=tenant_id, branch_id=selected_branch)
    config = (
        await db.execute(
            select(QrMenuConfig).where(
                QrMenuConfig.tenant_id == tenant_id,
                QrMenuConfig.branch_id == selected_branch,
            )
        )
    ).scalar_one_or_none()
    if config is None:
        config = new_qr_menu_config(tenant_id=tenant_id, branch_id=selected_branch)
        db.add(config)
    previous = {
        "is_enabled": bool(config.is_enabled),
        "order_mode": (
            config.order_mode.value
            if isinstance(config.order_mode, QrOrderMode)
            else QrOrderMode.WAITER_APPROVAL.value
        ),
    }
    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(config, key, value)
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="qr.config_updated",
        resource_type="qr_menu_config",
        resource_id=config.id,
        previous_value=previous,
        new_value={"is_enabled": config.is_enabled, "order_mode": config.order_mode.value},
    )
    await db.commit()
    return QrConfigOut.model_validate(config)


@router.get("/requests", response_model=list[QrRequestOut])
async def list_qr_requests(
    identity: QrReader,
    db: DbSession,
    branch_id: UUID | None = None,
    request_status: QrRequestStatus | None = Query(default=None, alias="status"),
) -> list[QrRequestOut]:
    predicates = [
        QrOrderRequest.tenant_id == require_tenant(identity),
        QrOrderRequest.branch_id == require_branch(identity, branch_id),
    ]
    if request_status:
        predicates.append(QrOrderRequest.status == request_status)
    rows = (
        (
            await db.execute(
                select(QrOrderRequest)
                .where(*predicates)
                .order_by(QrOrderRequest.created_at.desc())
                .limit(200)
            )
        )
        .scalars()
        .all()
    )
    return [QrRequestOut.model_validate(item) for item in rows]


@router.post("/requests/{request_id}/approve", response_model=QrRequestOut)
async def approve_qr_request(
    request_id: UUID,
    request: Request,
    identity: QrApprover,
    db: DbSession,
) -> QrRequestOut:
    tenant_id = require_tenant(identity)
    qr_request = (
        await db.execute(
            select(QrOrderRequest)
            .where(
                QrOrderRequest.id == request_id,
                QrOrderRequest.tenant_id == tenant_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if qr_request is None:
        raise DomainError("qr_request_not_found", "QR order request not found", status_code=404)
    if qr_request.status == QrRequestStatus.APPROVED:
        return QrRequestOut.model_validate(qr_request)
    expires_at = qr_request.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if qr_request.status != QrRequestStatus.PENDING or expires_at <= utcnow():
        qr_request.status = QrRequestStatus.EXPIRED
        await db.commit()
        raise DomainError("qr_request_expired", "QR order request has expired", status_code=409)
    order_payload = OrderCreate(
        table_id=qr_request.table_id,
        source=OrderSource.QR,
        items=qr_request.items_payload,
        idempotency_key=f"qr:{qr_request.id}",
        auto_accept=True,
    )
    order, _ = await create_order(
        db,
        tenant_id=tenant_id,
        branch_id=qr_request.branch_id,
        actor_user_id=identity.user_id,
        payload=order_payload,
        source_override=OrderSource.QR,
    )
    if qr_request.loyalty_membership_id is not None:
        membership = (
            await db.execute(
                select(LoyaltyMembership).where(
                    LoyaltyMembership.id == qr_request.loyalty_membership_id,
                    LoyaltyMembership.tenant_id == tenant_id,
                    LoyaltyMembership.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if membership is None:
            raise DomainError("membership_not_found", "Üyelik bulunamadı.", status_code=404)
        await attach_membership_to_order(db, order=order, membership=membership)
    qr_request.order_id = order.id
    qr_request.status = QrRequestStatus.APPROVED
    qr_request.resolved_by_user_id = identity.user_id
    qr_request.resolved_at = utcnow()
    add_audit_log(
        db,
        identity=identity,
        action="qr.request_approved",
        resource_type="qr_order_request",
        resource_id=qr_request.id,
        new_value={"order_id": str(order.id)},
    )
    await db.commit()
    await request.app.state.realtime.broadcast(
        tenant_id,
        qr_request.branch_id,
        {
            "type": "qr.request.approved",
            "request_id": str(qr_request.id),
            "order_id": str(order.id),
        },
    )
    return QrRequestOut.model_validate(qr_request)


@router.post("/requests/{request_id}/reject", response_model=QrRequestOut)
async def reject_qr_request(
    request_id: UUID,
    identity: QrApprover,
    db: DbSession,
) -> QrRequestOut:
    qr_request = (
        await db.execute(
            select(QrOrderRequest).where(
                QrOrderRequest.id == request_id,
                QrOrderRequest.tenant_id == require_tenant(identity),
            )
        )
    ).scalar_one_or_none()
    if qr_request is None:
        raise DomainError("qr_request_not_found", "QR order request not found", status_code=404)
    if qr_request.status == QrRequestStatus.PENDING:
        qr_request.status = QrRequestStatus.REJECTED
        qr_request.resolved_by_user_id = identity.user_id
        qr_request.resolved_at = utcnow()
        add_audit_log(
            db,
            identity=identity,
            action="qr.request_rejected",
            resource_type="qr_order_request",
            resource_id=qr_request.id,
        )
    await db.commit()
    return QrRequestOut.model_validate(qr_request)


@router.post("/tables/{table_id}/regenerate-token")
async def regenerate_table_token(
    table_id: UUID,
    identity: QrManager,
    db: DbSession,
) -> dict[str, str]:
    table = (
        await db.execute(
            select(DiningTable).where(
                DiningTable.id == table_id,
                DiningTable.tenant_id == require_tenant(identity),
            )
        )
    ).scalar_one_or_none()
    if table is None:
        raise DomainError("table_not_found", "Table not found", status_code=404)
    table.qr_token = uuid4().hex
    table.version += 1
    add_audit_log(
        db,
        identity=identity,
        action="qr.table_token_regenerated",
        resource_type="table",
        resource_id=table.id,
    )
    await db.commit()
    return {"table_token": table.qr_token}
