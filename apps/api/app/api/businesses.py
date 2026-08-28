from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import selectinload

from app.dependencies import CurrentIdentity, DbSession, Identity, require_permissions
from app.errors import DomainError
from app.models import (
    AuthSession,
    Branch,
    Invoice,
    Role,
    SavedCard,
    Subscription,
    SubscriptionPlan,
    Tenant,
    TrustedDevice,
    User,
)
from app.models.enums import TenantState
from app.rbac import ensure_role, ensure_tenant_role_presets
from app.schemas import (
    AdminPasswordResetOut,
    AdminPasswordResetRequest,
    BusinessCreate,
    BusinessOverviewOut,
    BusinessReactivateRequest,
    BusinessUpdate,
    BusinessUserOut,
    Page,
    TenantOut,
)
from app.security import hash_password, utcnow
from app.services.audit import add_audit_log
from app.services.pricing import branch_pricing_for_tenant

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


class PlatformInvoiceOut(BaseModel):
    """One business's bill, as the platform operator sees it."""

    id: UUID
    tenant_id: UUID
    business_name: str
    business_slug: str
    number: str
    amount: Decimal
    currency: str
    status: str
    period_start: date
    branch_count: int
    due_at: datetime | None
    paid_at: datetime | None
    attempt_count: int
    failure_reason: str | None
    has_card: bool


@router.get("/invoices", response_model=list[PlatformInvoiceOut])
async def list_platform_invoices(
    identity: PlatformAdmin,
    db: DbSession,
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=200, ge=1, le=500),
) -> list[PlatformInvoiceOut]:
    """Every business's invoices, newest period first.

    Whether a card is on file is included: an unpaid invoice for a business
    that never added one is a different problem from a declined card, and the
    operator has to be able to tell them apart before chasing anyone.
    """
    carded = (
        select(SavedCard.tenant_id)
        .where(SavedCard.is_active.is_(True))
        .distinct()
        .subquery()
    )
    query = (
        select(Invoice, Tenant.name, Tenant.slug, carded.c.tenant_id)
        .join(Tenant, Tenant.id == Invoice.tenant_id)
        .outerjoin(carded, carded.c.tenant_id == Invoice.tenant_id)
        .order_by(Invoice.period_start.desc(), Tenant.name)
        .limit(limit)
    )
    if status_filter:
        query = query.where(Invoice.status == status_filter.upper())

    rows = (await db.execute(query)).all()
    return [
        PlatformInvoiceOut(
            id=invoice.id,
            tenant_id=invoice.tenant_id,
            business_name=name,
            business_slug=slug,
            number=invoice.number,
            amount=invoice.amount,
            currency=invoice.currency,
            status=invoice.status,
            period_start=invoice.period_start,
            branch_count=invoice.branch_count,
            due_at=invoice.due_at,
            paid_at=invoice.paid_at,
            attempt_count=invoice.attempt_count,
            failure_reason=invoice.failure_reason,
            has_card=card_tenant is not None,
        )
        for invoice, name, slug, card_tenant in rows
    ]


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


@router.get("/{business_id}/users", response_model=list[BusinessUserOut])
async def list_business_users(
    business_id: UUID,
    identity: PlatformAdmin,
    db: DbSession,
) -> list[BusinessUserOut]:
    """Support lookup: the staff accounts belonging to one business."""
    tenant = await db.get(Tenant, business_id)
    if tenant is None:
        raise DomainError("business_not_found", "Business not found", status_code=404)
    rows = (
        (
            await db.execute(
                select(User)
                .where(User.tenant_id == business_id)
                .options(selectinload(User.role))
                .order_by(User.display_name)
            )
        )
        .scalars()
        .all()
    )
    return [
        BusinessUserOut(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            email=user.email,
            role=user.role.code if user.role else "",
            is_active=user.is_active,
        )
        for user in rows
    ]


@router.post(
    "/{business_id}/users/{user_id}/password-reset",
    response_model=AdminPasswordResetOut,
)
async def reset_business_user_password(
    business_id: UUID,
    user_id: UUID,
    payload: AdminPasswordResetRequest,
    identity: PlatformAdmin,
    db: DbSession,
) -> AdminPasswordResetOut:
    """Set a temporary password for a business user, for support recovery.

    The user must belong to the named business — a mismatched pair 404s rather
    than leaking whether the id exists elsewhere. Every live session for that
    account is revoked so an attacker holding a stolen refresh token loses it
    at the same moment. The password itself is never logged or returned.
    """
    tenant = await db.get(Tenant, business_id)
    if tenant is None:
        raise DomainError("business_not_found", "Business not found", status_code=404)

    user = (
        await db.execute(
            select(User).where(User.id == user_id, User.tenant_id == business_id)
        )
    ).scalar_one_or_none()
    if user is None:
        raise DomainError("user_not_found", "User not found", status_code=404)
    if user.is_super_admin:
        raise DomainError(
            "platform_account_protected",
            "Platform accounts cannot be reset through business support",
            status_code=403,
        )

    live_sessions = (
        await db.execute(
            select(func.count(AuthSession.id)).where(
                AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)
            )
        )
    ).scalar_one()

    user.password_hash = hash_password(payload.new_password)
    await db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    await db.execute(
        update(TrustedDevice)
        .where(TrustedDevice.created_by_user_id == user.id, TrustedDevice.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    add_audit_log(
        db,
        identity=identity,
        tenant_id=tenant.id,
        action="user.password_reset",
        resource_type="user",
        resource_id=user.id,
        # Deliberately records only *that* a reset happened and why — never
        # the password, and never the old or new hash.
        new_value={"sessions_revoked": live_sessions, "by": "platform_support"},
        reason=payload.reason,
    )
    await db.commit()
    return AdminPasswordResetOut(
        user_id=user.id,
        username=user.username,
        sessions_revoked=live_sessions,
    )


@router.post("/{business_id}/reactivate", response_model=TenantOut)
async def reactivate_business(
    business_id: UUID,
    payload: BusinessReactivateRequest,
    identity: PlatformAdmin,
    db: DbSession,
) -> TenantOut:
    """Manually reactivate (or extend) a business's membership.

    This is the only path back to ACTIVE once a trial expires or a business
    is suspended for non-payment — a deliberate platform-admin action taken
    after payment is confirmed by some other means (bank transfer, etc.)
    until an online payment gateway is wired up.
    """
    tenant = await db.get(Tenant, business_id)
    if tenant is None:
        raise DomainError("business_not_found", "Business not found", status_code=404)
    subscription = (
        await db.execute(select(Subscription).where(Subscription.tenant_id == tenant.id))
    ).scalar_one_or_none()

    previous_state = tenant.state.value
    now = utcnow()
    tenant.state = TenantState.ACTIVE
    tenant.is_active = True
    if subscription is not None:
        subscription.status = TenantState.ACTIVE
        subscription.starts_at = now
        subscription.ends_at = now + timedelta(days=payload.extend_days)

    add_audit_log(
        db,
        identity=identity,
        tenant_id=tenant.id,
        action="business.reactivated",
        resource_type="tenant",
        resource_id=tenant.id,
        previous_value={"state": previous_state},
        new_value={
            "state": tenant.state.value,
            "extended_days": payload.extend_days,
            "valid_until": (now + timedelta(days=payload.extend_days)).isoformat(),
        },
        reason=payload.note,
    )
    await db.commit()
    await db.refresh(tenant)
    return TenantOut.model_validate(tenant)


@router.get("/{business_id}/overview", response_model=BusinessOverviewOut)
async def business_overview(
    business_id: UUID,
    identity: PlatformAdmin,
    db: DbSession,
) -> BusinessOverviewOut:
    """Contact details, branch count and what this business owes, in one call.

    Platform support answers "who do I ring and what are they paying?" far more
    often than anything else, so it is one request rather than four.
    """
    tenant = await db.get(Tenant, business_id)
    if tenant is None:
        raise DomainError("business_not_found", "Business not found", status_code=404)

    owner = (
        await db.execute(
            select(User)
            .join(Role, Role.id == User.role_id)
            .where(User.tenant_id == tenant.id, Role.code == "BUSINESS_OWNER")
            .order_by(User.created_at)
            .limit(1)
        )
    ).scalars().first()

    total_branches = int(
        (
            await db.execute(
                select(func.count(Branch.id)).where(Branch.tenant_id == tenant.id)
            )
        ).scalar_one()
    )
    user_count = int(
        (
            await db.execute(select(func.count(User.id)).where(User.tenant_id == tenant.id))
        ).scalar_one()
    )

    pricing = await branch_pricing_for_tenant(db, tenant.id)
    subscription = (
        await db.execute(select(Subscription).where(Subscription.tenant_id == tenant.id))
    ).scalars().first()
    plan_name = None
    if subscription is not None:
        plan_name = (
            await db.execute(
                select(SubscriptionPlan.name).where(
                    SubscriptionPlan.id == subscription.plan_id
                )
            )
        ).scalar_one_or_none()

    trial_ends_at = (
        subscription.ends_at
        if subscription is not None and tenant.state == TenantState.TRIAL
        else None
    )

    return BusinessOverviewOut(
        id=tenant.id,
        name=tenant.name,
        slug=tenant.slug,
        business_type=tenant.business_type,
        state=tenant.state,
        is_active=tenant.is_active,
        created_at=tenant.created_at,
        owner_name=owner.display_name if owner else None,
        owner_email=owner.email if owner else None,
        owner_phone=owner.phone if owner else None,
        active_branches=pricing.active_branches,
        total_branches=total_branches,
        user_count=user_count,
        plan_name=plan_name,
        currency=pricing.currency,
        monthly_total=pricing.monthly_total,
        base_monthly_price=pricing.base_monthly_price,
        included_branches=pricing.included_branches,
        additional_branch_price=pricing.additional_branch_price,
        billable_extra_branches=pricing.billable_extra_branches,
        next_payment_at=subscription.ends_at if subscription else None,
        trial_ends_at=trial_ends_at,
    )

