from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select

from app.dependencies import CurrentIdentity, DbSession, Identity, require_permissions
from app.errors import DomainError
from app.models import Branch, Subscription, SubscriptionPlan, Tenant, User
from app.models.enums import TenantState
from app.rbac import ensure_role, ensure_tenant_role_presets
from app.schemas import BusinessCreate, BusinessUpdate, Page, TenantOut
from app.security import hash_password, utcnow
from app.services.audit import add_audit_log

router = APIRouter(prefix="/businesses", tags=["businesses"])
PlatformAdmin = Annotated[Identity, Depends(require_permissions("platform.businesses.manage"))]


@router.get("", response_model=Page[TenantOut])
async def list_businesses(
    identity: CurrentIdentity,
    db: DbSession,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[TenantOut]:
    if identity.is_super_admin:
        predicates = []
    else:
        if identity.tenant_id is None:
            raise DomainError("permission_denied", "Business access denied", status_code=403)
        predicates = [Tenant.id == identity.tenant_id]
    total = (await db.execute(select(func.count(Tenant.id)).where(*predicates))).scalar_one()
    rows = (
        (
            await db.execute(
                select(Tenant)
                .where(*predicates)
                .order_by(Tenant.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return Page(
        items=[TenantOut.model_validate(item) for item in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=TenantOut, status_code=status.HTTP_201_CREATED)
async def create_business(
    payload: BusinessCreate,
    _: PlatformAdmin,
    db: DbSession,
    identity: CurrentIdentity,
) -> TenantOut:
    if (
        await db.execute(select(Tenant.id).where(Tenant.slug == payload.slug))
    ).scalar_one_or_none():
        raise DomainError("slug_conflict", "Business slug is already in use", status_code=409)
    tenant = Tenant(
        name=payload.name,
        slug=payload.slug,
        business_type=payload.business_type,
        state=TenantState.TRIAL,
        is_active=True,
    )
    db.add(tenant)
    await db.flush()
    branch = Branch(
        tenant_id=tenant.id,
        name=payload.first_branch.name,
        slug=payload.first_branch.slug,
        timezone=payload.first_branch.timezone,
    )
    db.add(branch)
    owner_role = await ensure_role(db, tenant_id=tenant.id, code="BUSINESS_OWNER")
    await ensure_tenant_role_presets(db, tenant.id)
    owner = User(
        tenant_id=tenant.id,
        branch_id=None,
        role_id=owner_role.id,
        username=payload.owner.username.lower(),
        email=payload.owner.email.lower() if payload.owner.email else None,
        display_name=payload.owner.display_name,
        password_hash=hash_password(payload.owner.temporary_password),
    )
    db.add(owner)
    plan = (
        await db.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.code == payload.subscription_plan_code)
        )
    ).scalar_one_or_none()
    if plan is not None:
        db.add(
            Subscription(
                tenant_id=tenant.id,
                plan_id=plan.id,
                status=TenantState.TRIAL,
                starts_at=utcnow(),
            )
        )
    add_audit_log(
        db,
        identity=identity,
        tenant_id=tenant.id,
        branch_id=branch.id,
        action="business.created",
        resource_type="tenant",
        resource_id=tenant.id,
        new_value={"name": tenant.name, "slug": tenant.slug},
    )
    await db.commit()
    await db.refresh(tenant)
    return TenantOut.model_validate(tenant)


@router.get("/{business_id}", response_model=TenantOut)
async def get_business(
    business_id: UUID,
    identity: CurrentIdentity,
    db: DbSession,
) -> TenantOut:
    if not identity.is_super_admin and identity.tenant_id != business_id:
        raise DomainError("business_not_found", "Business not found", status_code=404)
    tenant = await db.get(Tenant, business_id)
    if tenant is None:
        raise DomainError("business_not_found", "Business not found", status_code=404)
    return TenantOut.model_validate(tenant)


@router.patch("/{business_id}", response_model=TenantOut)
async def update_business(
    business_id: UUID,
    payload: BusinessUpdate,
    identity: CurrentIdentity,
    db: DbSession,
) -> TenantOut:
    if identity.is_super_admin:
        if (
            "*" not in identity.permissions
            and "platform.businesses.manage" not in identity.permissions
        ):
            raise DomainError("permission_denied", "Permission denied", status_code=403)
    else:
        if identity.tenant_id != business_id:
            raise DomainError("business_not_found", "Business not found", status_code=404)
        if "settings.manage" not in identity.permissions:
            raise DomainError("permission_denied", "Permission denied", status_code=403)
        if payload.state is not None or payload.is_active is not None:
            raise DomainError(
                "platform_fields_forbidden",
                "Business lifecycle fields can only be changed by a platform administrator",
                status_code=403,
            )
    tenant = await db.get(Tenant, business_id)
    if tenant is None:
        raise DomainError("business_not_found", "Business not found", status_code=404)
    previous = {
        "name": tenant.name,
        "state": tenant.state.value,
        "is_active": tenant.is_active,
        "default_currency": tenant.default_currency,
        "prevent_negative_stock": tenant.prevent_negative_stock,
    }
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(tenant, key, value)
    add_audit_log(
        db,
        identity=identity,
        tenant_id=tenant.id,
        action="business.updated",
        resource_type="tenant",
        resource_id=tenant.id,
        previous_value=previous,
        new_value={
            "name": tenant.name,
            "state": tenant.state.value,
            "is_active": tenant.is_active,
            "default_currency": tenant.default_currency,
            "prevent_negative_stock": tenant.prevent_negative_stock,
        },
    )
    await db.commit()
    await db.refresh(tenant)
    return TenantOut.model_validate(tenant)
