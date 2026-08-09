from __future__ import annotations

import hmac
from datetime import timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.config import Settings
from app.dependencies import (
    DbSession,
    Identity,
    get_app_settings,
    require_permissions,
    require_tenant,
)
from app.errors import DomainError
from app.loyalty_schemas import (
    LoyaltyAdminRewardOut,
    LoyaltyCustomerOut,
    LoyaltyEnroll,
    LoyaltyEnrollmentOut,
    LoyaltyMembershipAttach,
    LoyaltyMembershipAttachOut,
    LoyaltyOrderContextOut,
    LoyaltyOrderRewardOut,
    LoyaltyProgramOut,
    LoyaltyProgramStats,
    LoyaltyProgramUpsert,
    LoyaltyPublicOfferOut,
    LoyaltyPublicRewardOut,
    LoyaltyPublicStatusOut,
    LoyaltyRedemptionCreate,
    LoyaltyRedemptionOut,
    LoyaltyReversalCreate,
    LoyaltyReversalOut,
    LoyaltyRuleOut,
    LoyaltyVerificationOut,
    LoyaltyVerificationStart,
)
from app.models import (
    Branch,
    Category,
    LoyaltyCustomer,
    LoyaltyLedgerEntry,
    LoyaltyMembership,
    LoyaltyProgram,
    LoyaltyProgramBranch,
    LoyaltyReward,
    LoyaltyRule,
    LoyaltyVerificationChallenge,
    Product,
    Tenant,
)
from app.models.base import utcnow
from app.models.enums import LoyaltyRewardStatus, TenantState
from app.security import as_utc
from app.services.audit import add_audit_log
from app.services.loyalty import (
    CONSENT_VERSION,
    active_program_for_branch,
    attach_membership_to_order,
    enroll_membership,
    mask_phone,
    membership_from_code,
    membership_from_token,
    membership_progress,
    normalize_phone,
    program_is_current,
    redeem_reward,
    reverse_order_loyalty,
    reward_description,
    reward_target_description,
    verification_rate_limit_key,
)
from app.services.loyalty_verification_security import (
    consume_verification_rate_limit,
    verification_private_hash,
    verification_token_hash,
)
from app.services.orders import load_order
from app.services.phone_verification import phone_verification_provider

router = APIRouter(prefix="/loyalty", tags=["loyalty"])
LoyaltyReader = Annotated[Identity, Depends(require_permissions("loyalty.read"))]
LoyaltyManager = Annotated[Identity, Depends(require_permissions("loyalty.manage"))]
LoyaltyRedeemer = Annotated[Identity, Depends(require_permissions("loyalty.redeem"))]


def _ensure_order_branch(identity: Identity, branch_id: UUID) -> None:
    if identity.branch_id is not None and identity.branch_id != branch_id:
        raise DomainError("order_not_found", "Sipariş bulunamadı.", status_code=404)


async def _public_context(
    db: DbSession,
    business_slug: str,
    branch_slug: str,
) -> tuple[Tenant, Branch]:
    tenant = (
        await db.execute(
            select(Tenant).where(
                Tenant.slug == business_slug.lower(),
                Tenant.is_active.is_(True),
                Tenant.state.notin_(
                    [
                        TenantState.PAST_DUE,
                        TenantState.SUSPENDED,
                        TenantState.CANCELLED,
                        TenantState.ARCHIVED,
                    ]
                ),
            )
        )
    ).scalar_one_or_none()
    if tenant is None:
        raise DomainError("loyalty_not_found", "Sadakat programı bulunamadı.", status_code=404)
    branch = (
        await db.execute(
            select(Branch).where(
                Branch.tenant_id == tenant.id,
                Branch.slug == branch_slug.lower(),
                Branch.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if branch is None:
        raise DomainError("loyalty_not_found", "Sadakat programı bulunamadı.", status_code=404)
    return tenant, branch


async def _program_output(db: DbSession, program: LoyaltyProgram) -> LoyaltyProgramOut:
    if program.rule is None:
        raise DomainError(
            "loyalty_rule_missing", "Sadakat programı kuralı bulunamadı.", status_code=409
        )
    active_customers = (
        await db.execute(
            select(func.count(LoyaltyMembership.id)).where(
                LoyaltyMembership.tenant_id == program.tenant_id,
                LoyaltyMembership.program_id == program.id,
                LoyaltyMembership.is_active.is_(True),
            )
        )
    ).scalar_one()
    available_rewards = (
        await db.execute(
            select(func.count(LoyaltyReward.id)).where(
                LoyaltyReward.tenant_id == program.tenant_id,
                LoyaltyReward.program_id == program.id,
                LoyaltyReward.status == LoyaltyRewardStatus.AVAILABLE,
            )
        )
    ).scalar_one()
    redeemed_rewards = (
        await db.execute(
            select(func.count(LoyaltyReward.id)).where(
                LoyaltyReward.tenant_id == program.tenant_id,
                LoyaltyReward.program_id == program.id,
                LoyaltyReward.status == LoyaltyRewardStatus.REDEEMED,
            )
        )
    ).scalar_one()
    return LoyaltyProgramOut(
        id=program.id,
        name=program.name,
        is_active=program.is_active,
        show_on_qr=program.show_on_qr,
        starts_at=program.starts_at,
        ends_at=program.ends_at,
        version=program.version,
        branch_ids=[item.branch_id for item in program.program_branches],
        rule=LoyaltyRuleOut.model_validate(program.rule),
        stats=LoyaltyProgramStats(
            active_customers=active_customers,
            available_rewards=available_rewards,
            redeemed_rewards=redeemed_rewards,
        ),
    )


@router.get("/program", response_model=LoyaltyProgramOut | None)
async def get_program(identity: LoyaltyManager, db: DbSession) -> LoyaltyProgramOut | None:
    program = (
        await db.execute(
            select(LoyaltyProgram)
            .where(LoyaltyProgram.tenant_id == require_tenant(identity))
            .options(
                selectinload(LoyaltyProgram.rule),
                selectinload(LoyaltyProgram.program_branches),
            )
            .order_by(LoyaltyProgram.created_at)
            .limit(1)
        )
    ).scalar_one_or_none()
    return await _program_output(db, program) if program is not None else None


@router.put("/program", response_model=LoyaltyProgramOut)
async def upsert_program(
    payload: LoyaltyProgramUpsert,
    identity: LoyaltyManager,
    db: DbSession,
) -> LoyaltyProgramOut:
    tenant_id = require_tenant(identity)
    if not payload.branch_ids:
        raise DomainError(
            "loyalty_branch_required", "En az bir geçerli şube seçin.", status_code=422
        )
    branch_count = (
        await db.execute(
            select(func.count(Branch.id)).where(
                Branch.tenant_id == tenant_id,
                Branch.id.in_(payload.branch_ids),
                Branch.is_active.is_(True),
            )
        )
    ).scalar_one()
    if branch_count != len(payload.branch_ids):
        raise DomainError("branch_not_found", "Şube bulunamadı.", status_code=404)
    await _validate_catalog_references(db, tenant_id, payload)
    program = (
        await db.execute(
            select(LoyaltyProgram)
            .where(LoyaltyProgram.tenant_id == tenant_id)
            .options(
                selectinload(LoyaltyProgram.rule),
                selectinload(LoyaltyProgram.program_branches),
            )
            .order_by(LoyaltyProgram.created_at)
            .limit(1)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if program is None:
        program = LoyaltyProgram(
            tenant_id=tenant_id,
            name=payload.name,
            is_active=payload.is_active,
            show_on_qr=payload.show_on_qr,
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            rule=LoyaltyRule(
                tenant_id=tenant_id,
                **_rule_values(payload),
            ),
            program_branches=[
                LoyaltyProgramBranch(
                    tenant_id=tenant_id,
                    branch_id=branch_id,
                )
                for branch_id in payload.branch_ids
            ],
        )
        db.add(program)
        await db.flush()
        action = "loyalty.program_created"
    else:
        if payload.expected_version is None:
            raise DomainError(
                "loyalty_version_required",
                "Programı güncellemeden önce güncel sürümü yeniden yükleyin.",
                status_code=409,
                details={"current_version": program.version},
            )
        if payload.expected_version != program.version:
            raise DomainError(
                "loyalty_version_conflict",
                "Sadakat programı başka bir kullanıcı tarafından güncellendi.",
                status_code=409,
                details={"current_version": program.version},
            )
        previous = _program_audit_value(
            program,
            branch_ids=[item.branch_id for item in program.program_branches],
        )
        if program.rule is not None:
            rule_values = _rule_values(payload)
            historical_rule_changed = any(
                getattr(program.rule, key) != rule_values[key]
                for key in (
                    "campaign_type",
                    "threshold",
                    "qualifying_product_id",
                    "qualifying_category_id",
                )
            )
            if historical_rule_changed:
                ledger_count = (
                    await db.execute(
                        select(func.count(LoyaltyLedgerEntry.id)).where(
                            LoyaltyLedgerEntry.tenant_id == tenant_id,
                            LoyaltyLedgerEntry.program_id == program.id,
                        )
                    )
                ).scalar_one()
                if ledger_count:
                    raise DomainError(
                        "loyalty_rule_locked",
                        "İlerleme oluşmuş programın kampanya türü veya kazanım kuralı "
                        "müşteri geçmişini korumak için değiştirilemez.",
                        status_code=409,
                    )
        program.name = payload.name
        program.is_active = payload.is_active
        program.show_on_qr = payload.show_on_qr
        program.starts_at = payload.starts_at
        program.ends_at = payload.ends_at
        program.version += 1
        if program.rule is None:
            program.rule = LoyaltyRule(
                tenant_id=tenant_id,
                program_id=program.id,
                **_rule_values(payload),
            )
        else:
            for key, value in _rule_values(payload).items():
                setattr(program.rule, key, value)
        program.program_branches = [
            LoyaltyProgramBranch(
                tenant_id=tenant_id,
                program_id=program.id,
                branch_id=branch_id,
            )
            for branch_id in payload.branch_ids
        ]
        action = "loyalty.program_updated"
        add_audit_log(
            db,
            identity=identity,
            action=action,
            resource_type="loyalty_program",
            resource_id=program.id,
            previous_value=previous,
            new_value=_program_audit_value(program, branch_ids=payload.branch_ids),
        )
    if action == "loyalty.program_created":
        add_audit_log(
            db,
            identity=identity,
            action=action,
            resource_type="loyalty_program",
            resource_id=program.id,
            new_value=_program_audit_value(program, branch_ids=payload.branch_ids),
        )
    await db.commit()
    program = (
        await db.execute(
            select(LoyaltyProgram)
            .where(LoyaltyProgram.id == program.id, LoyaltyProgram.tenant_id == tenant_id)
            .options(
                selectinload(LoyaltyProgram.rule),
                selectinload(LoyaltyProgram.program_branches),
            )
        )
    ).scalar_one()
    return await _program_output(db, program)


def _rule_values(payload: LoyaltyProgramUpsert) -> dict[str, object]:
    return {
        "campaign_type": payload.campaign_type,
        "threshold": payload.threshold,
        "qualifying_product_id": payload.qualifying_product_id,
        "qualifying_category_id": payload.qualifying_category_id,
        "reward_product_id": payload.reward_product_id,
        "reward_category_id": payload.reward_category_id,
        "minimum_order_amount": payload.minimum_order_amount,
        "allow_multiple_same_day": payload.allow_multiple_same_day,
        "reward_same_order": payload.reward_same_order,
    }


def _program_audit_value(
    program: LoyaltyProgram, *, branch_ids: list[UUID]
) -> dict[str, object]:
    rule = program.rule
    return {
        "name": program.name,
        "is_active": program.is_active,
        "show_on_qr": program.show_on_qr,
        "starts_at": program.starts_at.isoformat() if program.starts_at else None,
        "ends_at": program.ends_at.isoformat() if program.ends_at else None,
        "version": program.version,
        "branch_ids": [str(branch_id) for branch_id in branch_ids],
        "rule": (
            {
                "campaign_type": rule.campaign_type.value,
                "threshold": str(rule.threshold),
                "qualifying_product_id": (
                    str(rule.qualifying_product_id)
                    if rule.qualifying_product_id is not None
                    else None
                ),
                "qualifying_category_id": (
                    str(rule.qualifying_category_id)
                    if rule.qualifying_category_id is not None
                    else None
                ),
                "reward_product_id": (
                    str(rule.reward_product_id)
                    if rule.reward_product_id is not None
                    else None
                ),
                "reward_category_id": (
                    str(rule.reward_category_id)
                    if rule.reward_category_id is not None
                    else None
                ),
                "minimum_order_amount": str(rule.minimum_order_amount),
                "allow_multiple_same_day": rule.allow_multiple_same_day,
                "reward_same_order": rule.reward_same_order,
            }
            if rule is not None
            else None
        ),
    }


async def _validate_catalog_references(
    db: DbSession,
    tenant_id: UUID,
    payload: LoyaltyProgramUpsert,
) -> None:
    for value in [payload.qualifying_product_id, payload.reward_product_id]:
        if value is None:
            continue
        exists = (
            await db.execute(
                select(Product.id).where(Product.id == value, Product.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if exists is None:
            raise DomainError("product_not_found", "Ürün bulunamadı.", status_code=404)
    for value in [payload.qualifying_category_id, payload.reward_category_id]:
        if value is None:
            continue
        exists = (
            await db.execute(
                select(Category.id).where(Category.id == value, Category.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if exists is None:
            raise DomainError("category_not_found", "Kategori bulunamadı.", status_code=404)


@router.get("/customers", response_model=list[LoyaltyCustomerOut])
async def list_customers(
    identity: LoyaltyManager,
    db: DbSession,
    limit: int = Query(default=100, ge=1, le=250),
) -> list[LoyaltyCustomerOut]:
    tenant_id = require_tenant(identity)
    progress_totals = (
        select(
            LoyaltyLedgerEntry.membership_id.label("membership_id"),
            LoyaltyLedgerEntry.program_id.label("program_id"),
            func.sum(LoyaltyLedgerEntry.progress_delta).label("progress"),
        )
        .where(LoyaltyLedgerEntry.tenant_id == tenant_id)
        .group_by(
            LoyaltyLedgerEntry.membership_id,
            LoyaltyLedgerEntry.program_id,
        )
        .subquery()
    )
    reward_totals = (
        select(
            LoyaltyReward.membership_id.label("membership_id"),
            func.count(LoyaltyReward.id).label("available_rewards"),
        )
        .where(
            LoyaltyReward.tenant_id == tenant_id,
            LoyaltyReward.status == LoyaltyRewardStatus.AVAILABLE,
        )
        .group_by(LoyaltyReward.membership_id)
        .subquery()
    )
    rows = (
        await db.execute(
            select(
                LoyaltyMembership,
                LoyaltyCustomer,
                LoyaltyProgram,
                func.coalesce(progress_totals.c.progress, 0),
                func.coalesce(reward_totals.c.available_rewards, 0),
            )
            .join(LoyaltyCustomer, LoyaltyCustomer.id == LoyaltyMembership.customer_id)
            .join(LoyaltyProgram, LoyaltyProgram.id == LoyaltyMembership.program_id)
            .outerjoin(
                progress_totals,
                (progress_totals.c.membership_id == LoyaltyMembership.id)
                & (progress_totals.c.program_id == LoyaltyProgram.id),
            )
            .outerjoin(
                reward_totals,
                reward_totals.c.membership_id == LoyaltyMembership.id,
            )
            .where(LoyaltyMembership.tenant_id == tenant_id)
            .order_by(LoyaltyMembership.created_at.desc())
            .limit(limit)
        )
    ).all()
    result: list[LoyaltyCustomerOut] = []
    for membership, customer, program, progress, available_rewards in rows:
        result.append(
            LoyaltyCustomerOut(
                membership_code=membership.lookup_code,
                phone_masked=mask_phone(customer.phone_normalized),
                branch_id=membership.branch_id,
                program_name=program.name,
                progress=progress,
                available_rewards=available_rewards,
                joined_at=membership.created_at,
                is_active=membership.is_active,
            )
        )
    return result


@router.get("/rewards", response_model=list[LoyaltyAdminRewardOut])
async def list_rewards(
    identity: LoyaltyManager,
    db: DbSession,
    limit: int = Query(default=100, ge=1, le=250),
) -> list[LoyaltyAdminRewardOut]:
    tenant_id = require_tenant(identity)
    rows = (
        await db.execute(
            select(LoyaltyReward, LoyaltyMembership, LoyaltyProgram)
            .join(LoyaltyMembership, LoyaltyMembership.id == LoyaltyReward.membership_id)
            .join(LoyaltyProgram, LoyaltyProgram.id == LoyaltyReward.program_id)
            .where(LoyaltyReward.tenant_id == tenant_id)
            .order_by(LoyaltyReward.issued_at.desc())
            .limit(limit)
        )
    ).all()
    return [
        LoyaltyAdminRewardOut(
            redemption_code=reward.redemption_code,
            membership_code=membership.lookup_code,
            program_name=program.name,
            status=reward.status,
            issued_at=reward.issued_at,
            redeemed_at=reward.redeemed_at,
        )
        for reward, membership, program in rows
    ]


@router.get(
    "/public/{business_slug}/{branch_slug}/offer",
    response_model=LoyaltyPublicOfferOut,
)
async def public_offer(
    business_slug: str,
    branch_slug: str,
    db: DbSession,
    response: Response,
) -> LoyaltyPublicOfferOut:
    response.headers["Cache-Control"] = "private, no-store"
    tenant, branch = await _public_context(db, business_slug, branch_slug)
    program = await active_program_for_branch(
        db,
        tenant_id=tenant.id,
        branch_id=branch.id,
        require_qr_visibility=True,
    )
    if program is None or program.rule is None or not program_is_current(program):
        return LoyaltyPublicOfferOut(enabled=False)
    return LoyaltyPublicOfferOut(
        enabled=True,
        program_name=program.name,
        campaign_type=program.rule.campaign_type,
        threshold=program.rule.threshold,
        minimum_order_amount=program.rule.minimum_order_amount,
        allow_multiple_same_day=program.rule.allow_multiple_same_day,
        qualifying_description=(
            await reward_target_description(
                db,
                tenant_id=tenant.id,
                reward_product_id=program.rule.qualifying_product_id,
                reward_category_id=program.rule.qualifying_category_id,
            )
            if program.rule.campaign_type.value == "PRODUCT_QUANTITY"
            else None
        ),
        reward_description=await reward_description(db, program.rule),
        reward_same_order=program.rule.reward_same_order,
        ends_at=program.ends_at,
    )


@router.post(
    "/public/{business_slug}/{branch_slug}/verification/start",
    response_model=LoyaltyVerificationOut,
)
async def start_verification(
    business_slug: str,
    branch_slug: str,
    payload: LoyaltyVerificationStart,
    db: DbSession,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_app_settings),
) -> LoyaltyVerificationOut:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    tenant, branch = await _public_context(db, business_slug, branch_slug)
    program = await active_program_for_branch(
        db,
        tenant_id=tenant.id,
        branch_id=branch.id,
        require_qr_visibility=True,
    )
    if program is None:
        raise DomainError("loyalty_not_found", "Sadakat programı bulunamadı.", status_code=404)
    phone = normalize_phone(payload.phone)
    rate_limit_key = verification_rate_limit_key(
        settings, tenant_id=tenant.id, phone=phone
    )
    window_seconds = settings.loyalty_verification_rate_limit_window_minutes * 60
    ip_address = request.client.host if request.client else None
    await consume_verification_rate_limit(
        db,
        settings=settings,
        scope=f"loyalty:send:phone:{tenant.id}:{phone}",
        limit=settings.loyalty_verification_rate_limit_attempts,
        window_seconds=window_seconds,
        message="Çok fazla doğrulama isteği gönderildi. Lütfen daha sonra tekrar deneyin.",
    )
    if ip_address:
        await consume_verification_rate_limit(
            db,
            settings=settings,
            scope=f"loyalty:send:ip:{tenant.id}:{ip_address}",
            limit=settings.loyalty_verification_ip_rate_limit_attempts,
            window_seconds=window_seconds,
            message=(
                "Bu bağlantıdan çok fazla doğrulama isteği gönderildi. "
                "Lütfen daha sonra tekrar deneyin."
            ),
        )
    await consume_verification_rate_limit(
        db,
        settings=settings,
        scope=f"loyalty:send:tenant-day:{tenant.id}",
        limit=settings.loyalty_verification_tenant_daily_limit,
        window_seconds=24 * 60 * 60,
        message="İşletmenin günlük doğrulama limiti doldu. Lütfen daha sonra tekrar deneyin.",
    )
    # Consume the allowance before calling the paid SMS provider. Delivery failures
    # must not allow an attacker to bypass the quota by retrying concurrently.
    await db.commit()
    verification = await phone_verification_provider(settings).start(
        tenant_id=tenant.id,
        branch_id=branch.id,
        phone=phone,
    )
    challenge = LoyaltyVerificationChallenge(
        tenant_id=tenant.id,
        branch_id=branch.id,
        token_hash=verification_token_hash(verification.token),
        phone_hash=verification_private_hash(settings, f"phone:{tenant.id}:{phone}"),
        request_ip_hash=(
            verification_private_hash(settings, f"ip:{ip_address}") if ip_address else None
        ),
        mode=verification.mode,
        expires_at=utcnow() + timedelta(seconds=verification.expires_in),
    )
    db.add(challenge)
    add_audit_log(
        db,
        identity=None,
        tenant_id=tenant.id,
        branch_id=branch.id,
        action="loyalty.verification_started",
        resource_type="loyalty_verification",
        resource_id=None,
        reason=rate_limit_key,
        new_value={"mode": verification.mode},
        ip_address=ip_address,
        user_agent=request.headers.get("user-agent", "")[:512] or None,
    )
    await db.commit()
    return LoyaltyVerificationOut(
        verification_token=verification.token,
        expires_in=verification.expires_in,
        mode=verification.mode,
        development_code=verification.development_code,
        message=verification.message,
    )


@router.post(
    "/public/{business_slug}/{branch_slug}/enroll",
    response_model=LoyaltyEnrollmentOut,
    status_code=status.HTTP_201_CREATED,
)
async def enroll(
    business_slug: str,
    branch_slug: str,
    payload: LoyaltyEnroll,
    db: DbSession,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_app_settings),
) -> LoyaltyEnrollmentOut:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    tenant, branch = await _public_context(db, business_slug, branch_slug)
    program = await active_program_for_branch(
        db,
        tenant_id=tenant.id,
        branch_id=branch.id,
        require_qr_visibility=True,
    )
    if program is None:
        raise DomainError("loyalty_not_found", "Sadakat programı bulunamadı.", status_code=404)
    if payload.consent_text_version != CONSENT_VERSION:
        raise DomainError(
            "consent_version_mismatch",
            "Onay metni güncellendi; lütfen sayfayı yenileyip tekrar onaylayın.",
            status_code=409,
        )
    phone = normalize_phone(payload.phone)
    verification_provider = phone_verification_provider(settings)
    rate_limit_key = verification_rate_limit_key(
        settings, tenant_id=tenant.id, phone=phone
    )
    window_seconds = settings.loyalty_verification_rate_limit_window_minutes * 60
    ip_address = request.client.host if request.client else None
    await consume_verification_rate_limit(
        db,
        settings=settings,
        scope=f"loyalty:verify:phone:{tenant.id}:{phone}",
        limit=settings.loyalty_verification_rate_limit_attempts,
        window_seconds=window_seconds,
        message="Çok fazla hatalı doğrulama kodu girildi. Lütfen daha sonra tekrar deneyin.",
    )
    if ip_address:
        await consume_verification_rate_limit(
            db,
            settings=settings,
            scope=f"loyalty:verify:ip:{tenant.id}:{ip_address}",
            limit=settings.loyalty_verification_ip_rate_limit_attempts,
            window_seconds=window_seconds,
            message=(
                "Bu bağlantıdan çok fazla doğrulama denemesi yapıldı. "
                "Lütfen daha sonra tekrar deneyin."
            ),
        )
    await db.commit()

    challenge = (
        await db.execute(
            select(LoyaltyVerificationChallenge)
            .where(
                LoyaltyVerificationChallenge.tenant_id == tenant.id,
                LoyaltyVerificationChallenge.branch_id == branch.id,
                LoyaltyVerificationChallenge.token_hash
                == verification_token_hash(payload.verification_token),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if challenge is None:
        raise DomainError(
            "verification_invalid", "Doğrulama isteği geçersiz.", status_code=401
        )
    if challenge.consumed_at is not None:
        add_audit_log(
            db,
            identity=None,
            tenant_id=tenant.id,
            branch_id=branch.id,
            action="loyalty.verification_replayed",
            resource_type="loyalty_verification",
            resource_id=challenge.id,
            reason="one_time_challenge_already_consumed",
            ip_address=ip_address,
            user_agent=request.headers.get("user-agent", "")[:512] or None,
        )
        await db.commit()
        raise DomainError(
            "verification_consumed",
            "Bu doğrulama kodu daha önce kullanıldı. Lütfen yeni kod isteyin.",
            status_code=401,
        )
    if as_utc(challenge.expires_at) <= utcnow():
        raise DomainError(
            "verification_expired", "Doğrulama kodunun süresi doldu.", status_code=401
        )
    expected_phone_hash = verification_private_hash(settings, f"phone:{tenant.id}:{phone}")
    if not hmac.compare_digest(challenge.phone_hash, expected_phone_hash):
        challenge.failed_attempts += 1
        await db.commit()
        raise DomainError(
            "verification_invalid", "Doğrulama kodu geçersiz.", status_code=401
        )
    if challenge.failed_attempts >= settings.loyalty_verification_rate_limit_attempts:
        raise DomainError(
            "loyalty_verification_rate_limited",
            "Çok fazla hatalı doğrulama kodu girildi. Lütfen yeni kod isteyin.",
            status_code=429,
            details={"retry_after_seconds": window_seconds},
        )
    try:
        await verification_provider.verify(
            token=payload.verification_token,
            code=payload.verification_code,
            tenant_id=tenant.id,
            branch_id=branch.id,
            phone=phone,
        )
    except DomainError as exc:
        if exc.code in {"verification_invalid", "verification_expired"}:
            challenge.failed_attempts += 1
            add_audit_log(
                db,
                identity=None,
                tenant_id=tenant.id,
                branch_id=branch.id,
                action="loyalty.verification_failed",
                resource_type="loyalty_verification",
                resource_id=None,
                reason=rate_limit_key,
                new_value={"mode": verification_provider.mode},
                ip_address=ip_address,
                user_agent=request.headers.get("user-agent", "")[:512] or None,
            )
            await db.commit()
        raise
    challenge.consumed_at = utcnow()
    membership, raw_token = await enroll_membership(
        db,
        program=program,
        branch_id=branch.id,
        phone=phone,
        referral_code=payload.referral_code,
        consent_text_version=CONSENT_VERSION,
    )
    add_audit_log(
        db,
        identity=None,
        tenant_id=tenant.id,
        branch_id=branch.id,
        action="loyalty.membership_enrolled",
        resource_type="loyalty_membership",
        resource_id=membership.id,
        new_value={
            "program_id": str(program.id),
            "verification_mode": verification_provider.mode,
            "consent_version": membership.consent_text_version,
        },
        reason="public_qr_enrollment",
        ip_address=ip_address,
        user_agent=request.headers.get("user-agent", "")[:512] or None,
    )
    await db.commit()
    return LoyaltyEnrollmentOut(
        membership_token=raw_token,
        membership_code=membership.lookup_code,
        referral_code=membership.referral_code,
        program_name=program.name,
        verification_mode=verification_provider.mode,
    )


@router.get(
    "/public/{business_slug}/{branch_slug}/status",
    response_model=LoyaltyPublicStatusOut,
)
async def public_status(
    business_slug: str,
    branch_slug: str,
    db: DbSession,
    response: Response,
    loyalty_token: str | None = Header(default=None, alias="X-Loyalty-Token"),
) -> LoyaltyPublicStatusOut:
    response.headers["Cache-Control"] = "private, no-store"
    tenant, branch = await _public_context(db, business_slug, branch_slug)
    if not loyalty_token:
        raise DomainError("loyalty_session_required", "Sadakat oturumu gerekli.", status_code=401)
    membership = await membership_from_token(
        db, tenant_id=tenant.id, raw_token=loyalty_token
    )
    if membership is None:
        raise DomainError("loyalty_session_invalid", "Sadakat oturumu geçersiz.", status_code=401)
    program = (
        await db.execute(
            select(LoyaltyProgram)
            .where(
                LoyaltyProgram.id == membership.program_id,
                LoyaltyProgram.tenant_id == tenant.id,
            )
            .options(selectinload(LoyaltyProgram.rule))
        )
    ).scalar_one()
    branch_link = (
        await db.execute(
            select(LoyaltyProgramBranch.program_id).where(
                LoyaltyProgramBranch.program_id == program.id,
                LoyaltyProgramBranch.branch_id == branch.id,
                LoyaltyProgramBranch.tenant_id == tenant.id,
            )
        )
    ).scalar_one_or_none()
    if branch_link is None or program.rule is None or not program.show_on_qr:
        raise DomainError("loyalty_not_found", "Sadakat programı bulunamadı.", status_code=404)
    rewards = (
        (
            await db.execute(
                select(LoyaltyReward)
                .where(
                    LoyaltyReward.tenant_id == tenant.id,
                    LoyaltyReward.membership_id == membership.id,
                    LoyaltyReward.status.in_(
                        [LoyaltyRewardStatus.AVAILABLE, LoyaltyRewardStatus.REDEEMED]
                    ),
                    or_(
                        LoyaltyReward.status == LoyaltyRewardStatus.REDEEMED,
                        LoyaltyReward.expires_at.is_(None),
                        LoyaltyReward.expires_at > utcnow(),
                    ),
                )
                .order_by(LoyaltyReward.issued_at.desc())
            )
        )
        .scalars()
        .all()
    )
    public_rewards = []
    for reward in rewards:
        public_rewards.append(
            LoyaltyPublicRewardOut(
                redemption_code=reward.redemption_code,
                description=await reward_target_description(
                    db,
                    tenant_id=tenant.id,
                    reward_product_id=reward.reward_product_id,
                    reward_category_id=reward.reward_category_id,
                ),
                status=reward.status,
                issued_at=reward.issued_at,
                expires_at=reward.expires_at,
            )
        )
    return LoyaltyPublicStatusOut(
        program_name=program.name,
        campaign_type=program.rule.campaign_type,
        progress=await membership_progress(
            db,
            tenant_id=tenant.id,
            membership_id=membership.id,
            program_id=program.id,
        ),
        target=program.rule.threshold,
        membership_code=membership.lookup_code,
        referral_code=membership.referral_code,
        rewards=public_rewards,
    )


@router.post("/orders/{order_id}/membership", response_model=LoyaltyMembershipAttachOut)
async def attach_membership(
    order_id: UUID,
    payload: LoyaltyMembershipAttach,
    identity: LoyaltyRedeemer,
    db: DbSession,
) -> LoyaltyMembershipAttachOut:
    tenant_id = require_tenant(identity)
    order = await load_order(db, tenant_id, order_id, lock=True)
    _ensure_order_branch(identity, order.branch_id)
    membership = await membership_from_code(
        db, tenant_id=tenant_id, code=payload.membership_code
    )
    if membership is None:
        raise DomainError("membership_not_found", "Üyelik bulunamadı.", status_code=404)
    await attach_membership_to_order(db, order=order, membership=membership)
    program = await db.get(LoyaltyProgram, membership.program_id)
    assert program is not None
    add_audit_log(
        db,
        identity=identity,
        action="loyalty.membership_attached",
        resource_type="order",
        resource_id=order.id,
        branch_id=order.branch_id,
        new_value={"program_id": str(program.id)},
    )
    await db.commit()
    return LoyaltyMembershipAttachOut(
        order_id=order.id,
        membership_code=membership.lookup_code,
        program_name=program.name,
    )


@router.get("/orders/{order_id}/context", response_model=LoyaltyOrderContextOut)
async def get_order_loyalty_context(
    order_id: UUID,
    identity: LoyaltyReader,
    db: DbSession,
) -> LoyaltyOrderContextOut:
    tenant_id = require_tenant(identity)
    order = await load_order(db, tenant_id, order_id)
    _ensure_order_branch(identity, order.branch_id)
    if order.loyalty_membership_id is None:
        return LoyaltyOrderContextOut(
            order_id=order.id,
            membership_code=None,
            program_name=None,
            available_rewards=[],
        )

    membership = (
        await db.execute(
            select(LoyaltyMembership).where(
                LoyaltyMembership.id == order.loyalty_membership_id,
                LoyaltyMembership.tenant_id == tenant_id,
                LoyaltyMembership.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        return LoyaltyOrderContextOut(
            order_id=order.id,
            membership_code=None,
            program_name=None,
            available_rewards=[],
        )

    program = (
        await db.execute(
            select(LoyaltyProgram)
            .options(selectinload(LoyaltyProgram.rule))
            .where(
                LoyaltyProgram.id == membership.program_id,
                LoyaltyProgram.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if program is None or program.rule is None or not program_is_current(program):
        return LoyaltyOrderContextOut(
            order_id=order.id,
            membership_code=membership.lookup_code,
            program_name=None,
            available_rewards=[],
        )
    branch_allowed = (
        await db.execute(
            select(LoyaltyProgramBranch.program_id).where(
                LoyaltyProgramBranch.tenant_id == tenant_id,
                LoyaltyProgramBranch.program_id == program.id,
                LoyaltyProgramBranch.branch_id == order.branch_id,
            )
        )
    ).scalar_one_or_none()
    if branch_allowed is None:
        return LoyaltyOrderContextOut(
            order_id=order.id,
            membership_code=membership.lookup_code,
            program_name=program.name,
            available_rewards=[],
        )

    rewards = (
        await db.execute(
            select(LoyaltyReward)
            .where(
                LoyaltyReward.tenant_id == tenant_id,
                LoyaltyReward.membership_id == membership.id,
                LoyaltyReward.status == LoyaltyRewardStatus.AVAILABLE,
                or_(
                    LoyaltyReward.expires_at.is_(None),
                    LoyaltyReward.expires_at > utcnow(),
                ),
            )
            .order_by(LoyaltyReward.issued_at)
        )
    ).scalars().all()
    product_category_rows = (
        await db.execute(
            select(Product.id, Product.category_id).where(
                Product.tenant_id == tenant_id,
                Product.id.in_([item.product_id for item in order.items]),
            )
        )
    ).all()
    product_categories: dict[UUID, UUID] = {
        product_id: category_id for product_id, category_id in product_category_rows
    }
    available_rewards: list[LoyaltyOrderRewardOut] = []
    for reward in rewards:
        eligible_item_ids = [
            item.id
            for item in order.items
            if item.status.value not in {"CANCELLED", "VOIDED"}
            and (
                reward.reward_product_id is None
                or item.product_id == reward.reward_product_id
            )
            and (
                reward.reward_category_id is None
                or product_categories.get(item.product_id) == reward.reward_category_id
            )
        ]
        available_rewards.append(
            LoyaltyOrderRewardOut(
                redemption_code=reward.redemption_code,
                description=await reward_target_description(
                    db,
                    tenant_id=tenant_id,
                    reward_product_id=reward.reward_product_id,
                    reward_category_id=reward.reward_category_id,
                ),
                eligible_order_item_ids=eligible_item_ids,
                expires_at=reward.expires_at,
            )
        )

    return LoyaltyOrderContextOut(
        order_id=order.id,
        membership_code=membership.lookup_code,
        program_name=program.name,
        available_rewards=available_rewards,
    )


@router.post(
    "/rewards/{redemption_code}/redeem",
    response_model=LoyaltyRedemptionOut,
    status_code=status.HTTP_201_CREATED,
)
async def redeem(
    redemption_code: str,
    payload: LoyaltyRedemptionCreate,
    identity: LoyaltyRedeemer,
    db: DbSession,
) -> LoyaltyRedemptionOut:
    tenant_id = require_tenant(identity)
    order = await load_order(db, tenant_id, payload.order_id, lock=True)
    _ensure_order_branch(identity, order.branch_id)
    redemption = await redeem_reward(
        db,
        tenant_id=tenant_id,
        redemption_code=redemption_code,
        order=order,
        order_item_id=payload.order_item_id,
        idempotency_key=payload.idempotency_key,
        identity=identity,
    )
    await db.commit()
    return LoyaltyRedemptionOut(
        id=redemption.id,
        redemption_code=redemption_code.upper(),
        order_id=redemption.order_id,
        order_item_id=redemption.order_item_id,
        discount_id=redemption.discount_id,
        status=redemption.status,
        amount=redemption.amount,
        created_at=redemption.created_at,
    )


@router.post("/orders/{order_id}/reverse", response_model=LoyaltyReversalOut)
async def reverse_order_progress(
    order_id: UUID,
    payload: LoyaltyReversalCreate,
    identity: LoyaltyManager,
    db: DbSession,
) -> LoyaltyReversalOut:
    tenant_id = require_tenant(identity)
    order = await load_order(db, tenant_id, order_id, lock=True)
    _ensure_order_branch(identity, order.branch_id)
    count, progress = await reverse_order_loyalty(
        db,
        order=order,
        identity=identity,
        idempotency_key=payload.idempotency_key,
        reason=payload.reason,
    )
    if count:
        add_audit_log(
            db,
            identity=identity,
            action="loyalty.order_reversed",
            resource_type="order",
            resource_id=order.id,
            branch_id=order.branch_id,
            new_value={"programs": count, "progress": str(progress)},
            reason=payload.reason,
        )
    await db.commit()
    return LoyaltyReversalOut(
        order_id=order.id,
        reversed_programs=count,
        reversed_progress=progress,
    )
