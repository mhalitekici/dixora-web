from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import jwt
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.config import Settings
from app.dependencies import Identity
from app.errors import DomainError
from app.models import (
    Branch,
    Category,
    DiningTable,
    Discount,
    LoyaltyCustomer,
    LoyaltyLedgerEntry,
    LoyaltyMembership,
    LoyaltyProgram,
    LoyaltyProgramBranch,
    LoyaltyRedemption,
    LoyaltyReward,
    LoyaltyRule,
    Order,
    Product,
    TableSession,
)
from app.models.enums import (
    DiscountKind,
    LoyaltyCampaignType,
    LoyaltyLedgerEntryType,
    LoyaltyRedemptionStatus,
    LoyaltyRewardStatus,
    OrderItemStatus,
    OrderStatus,
    PaymentStatus,
    TableState,
)
from app.security import as_utc, utcnow
from app.services.audit import add_audit_log

PHONE_DIGITS = re.compile(r"\D+")
VERIFICATION_TTL_SECONDS = 5 * 60
VERIFICATION_ISSUER = "dixora-loyalty-verification"
CONSENT_VERSION = "2026-08"
PUBLIC_MEMBERSHIP_TTL_DAYS = 180
CENT = Decimal("0.01")


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


async def _validated_redemption_replay(
    db: AsyncSession,
    *,
    redemption: LoyaltyRedemption,
    redemption_code: str,
    tenant_id: UUID,
    order_id: UUID,
    branch_id: UUID,
    order_item_id: UUID,
) -> LoyaltyRedemption:
    stored_code = (
        await db.execute(
            select(LoyaltyReward.redemption_code).where(
                LoyaltyReward.id == redemption.reward_id,
                LoyaltyReward.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if (
        redemption.order_id != order_id
        or redemption.order_item_id != order_item_id
        or redemption.branch_id != branch_id
        or stored_code != redemption_code.strip().upper()
    ):
        raise DomainError(
            "idempotency_conflict",
            "Bu işlem anahtarı farklı bir ödül komutunda kullanılmış.",
            status_code=409,
        )
    return redemption


def normalize_phone(value: str) -> str:
    value = value.strip()
    digits = PHONE_DIGITS.sub("", value)
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        digits = f"90{digits[1:]}"
    elif len(digits) == 10:
        digits = f"90{digits}"
    if not 10 <= len(digits) <= 15:
        raise DomainError(
            "invalid_phone_number",
            "Telefon numarasını ülke koduyla birlikte kontrol edin.",
            status_code=422,
        )
    return f"+{digits}"


def mask_phone(value: str) -> str:
    if len(value) <= 7:
        return "***"
    return f"{value[:4]}***{value[-4:]}"


def membership_token_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _verification_value_hash(settings: Settings, value: str) -> str:
    return hmac.new(
        settings.jwt_secret.get_secret_value().encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _verification_context_hash(
    settings: Settings, *, tenant_id: UUID, branch_id: UUID
) -> str:
    return _verification_value_hash(
        settings, f"tenant:{tenant_id}:branch:{branch_id}"
    )


def verification_rate_limit_key(
    settings: Settings, *, tenant_id: UUID, phone: str
) -> str:
    return f"phone:{_verification_value_hash(settings, f'{tenant_id}:{phone}')}"


def create_phone_verification_challenge(
    settings: Settings,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    phone: str,
) -> tuple[str, str]:
    if (
        settings.environment not in {"development", "test"}
        and settings.loyalty_verification_provider != "netgsm"
    ):
        raise DomainError(
            "verification_provider_unavailable",
            "Telefon doğrulama sağlayıcısı yapılandırılmamış.",
            status_code=503,
        )
    code = f"{secrets.randbelow(900_000) + 100_000:06d}"
    now = utcnow()
    token = jwt.encode(
        {
            "typ": "loyalty_phone_verification",
            "context_hash": _verification_context_hash(
                settings, tenant_id=tenant_id, branch_id=branch_id
            ),
            "phone_hash": _verification_value_hash(settings, phone),
            "code_hash": _verification_value_hash(settings, code),
            "iat": now,
            "nbf": now,
            "exp": now + timedelta(seconds=VERIFICATION_TTL_SECONDS),
            "jti": secrets.token_urlsafe(18),
            "iss": VERIFICATION_ISSUER,
            "aud": "dixora-public-menu",
        },
        settings.jwt_secret.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )
    return token, code


def verify_phone_verification_challenge(
    settings: Settings,
    *,
    token: str,
    code: str,
    tenant_id: UUID,
    branch_id: UUID,
    phone: str,
) -> None:
    if (
        settings.environment not in {"development", "test"}
        and settings.loyalty_verification_provider != "netgsm"
    ):
        raise DomainError(
            "verification_provider_unavailable",
            "Telefon doğrulama sağlayıcısı yapılandırılmamış.",
            status_code=503,
        )
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            audience="dixora-public-menu",
            issuer=VERIFICATION_ISSUER,
        )
    except jwt.ExpiredSignatureError as exc:
        raise DomainError(
            "verification_expired", "Doğrulama kodunun süresi doldu.", status_code=401
        ) from exc
    except jwt.PyJWTError as exc:
        raise DomainError(
            "verification_invalid", "Doğrulama isteği geçersiz.", status_code=401
        ) from exc
    expected = {
        "typ": "loyalty_phone_verification",
        "context_hash": _verification_context_hash(
            settings, tenant_id=tenant_id, branch_id=branch_id
        ),
        "phone_hash": _verification_value_hash(settings, phone),
        "code_hash": _verification_value_hash(settings, code),
    }
    if any(
        not isinstance(payload.get(key), str)
        or not hmac.compare_digest(payload[key], value)
        for key, value in expected.items()
    ):
        raise DomainError(
            "verification_invalid", "Doğrulama kodu geçersiz.", status_code=401
        )


def program_is_current(program: LoyaltyProgram, *, now: datetime | None = None) -> bool:
    point = now or utcnow()
    if not program.is_active:
        return False
    if program.starts_at is not None and as_utc(program.starts_at) > point:
        return False
    return program.ends_at is None or as_utc(program.ends_at) > point


async def active_program_for_branch(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    require_qr_visibility: bool = False,
) -> LoyaltyProgram | None:
    predicates = [
        LoyaltyProgram.tenant_id == tenant_id,
        LoyaltyProgram.is_active.is_(True),
        LoyaltyProgramBranch.tenant_id == tenant_id,
        LoyaltyProgramBranch.branch_id == branch_id,
    ]
    if require_qr_visibility:
        predicates.append(LoyaltyProgram.show_on_qr.is_(True))
    programs = (
        (
            await db.execute(
                select(LoyaltyProgram)
                .join(
                    LoyaltyProgramBranch,
                    LoyaltyProgramBranch.program_id == LoyaltyProgram.id,
                )
                .where(*predicates)
                .options(
                    selectinload(LoyaltyProgram.rule),
                    selectinload(LoyaltyProgram.program_branches),
                )
                .order_by(LoyaltyProgram.created_at)
            )
        )
        .scalars()
        .unique()
        .all()
    )
    return next((program for program in programs if program_is_current(program)), None)


async def enroll_membership(
    db: AsyncSession,
    *,
    program: LoyaltyProgram,
    branch_id: UUID,
    phone: str,
    referral_code: str | None,
    consent_text_version: str,
) -> tuple[LoyaltyMembership, str]:
    customer = (
        await db.execute(
            select(LoyaltyCustomer).where(
                LoyaltyCustomer.tenant_id == program.tenant_id,
                LoyaltyCustomer.phone_normalized == phone,
            )
        )
    ).scalar_one_or_none()
    if customer is None:
        customer = LoyaltyCustomer(
            tenant_id=program.tenant_id,
            phone_normalized=phone,
        )
        db.add(customer)
        await db.flush()
    elif not customer.is_active:
        customer.is_active = True

    membership = (
        await db.execute(
            select(LoyaltyMembership).where(
                LoyaltyMembership.tenant_id == program.tenant_id,
                LoyaltyMembership.program_id == program.id,
                LoyaltyMembership.customer_id == customer.id,
            )
        )
    ).scalar_one_or_none()
    raw_token = f"lm_{secrets.token_urlsafe(40)}"
    if membership is not None:
        membership.public_token_hash = membership_token_hash(raw_token)
        membership.is_active = True
        membership.consent_at = utcnow()
        membership.consent_text_version = consent_text_version
        return membership, raw_token

    referrer: LoyaltyMembership | None = None
    if referral_code:
        referrer = (
            await db.execute(
                select(LoyaltyMembership).where(
                    LoyaltyMembership.tenant_id == program.tenant_id,
                    LoyaltyMembership.referral_code == referral_code.upper(),
                    LoyaltyMembership.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if referrer is None:
            raise DomainError(
                "referral_not_found", "Davet kodu bulunamadı.", status_code=404
            )

    membership = LoyaltyMembership(
        tenant_id=program.tenant_id,
        branch_id=branch_id,
        program_id=program.id,
        customer_id=customer.id,
        public_token_hash=membership_token_hash(raw_token),
        lookup_code=await _new_membership_code(db, program.tenant_id),
        referral_code=await _new_referral_code(db, program.tenant_id),
        referred_by_membership_id=referrer.id if referrer else None,
        consent_at=utcnow(),
        consent_text_version=consent_text_version,
    )
    db.add(membership)
    await db.flush()
    return membership, raw_token


async def _new_referral_code(db: AsyncSession, tenant_id: UUID) -> str:
    for _ in range(8):
        code = secrets.token_urlsafe(9).replace("-", "").replace("_", "").upper()[:12]
        exists = (
            await db.execute(
                select(LoyaltyMembership.id).where(
                    LoyaltyMembership.tenant_id == tenant_id,
                    LoyaltyMembership.referral_code == code,
                )
            )
        ).scalar_one_or_none()
        if exists is None:
            return code
    raise DomainError(
        "referral_generation_failed",
        "Davet kodu üretilemedi; lütfen yeniden deneyin.",
        status_code=503,
    )


async def _new_membership_code(db: AsyncSession, tenant_id: UUID) -> str:
    for _ in range(8):
        random_part = secrets.token_urlsafe(12).replace("-", "").replace("_", "").upper()
        code = f"MB-{random_part[:16]}"
        exists = (
            await db.execute(
                select(LoyaltyMembership.id).where(
                    LoyaltyMembership.tenant_id == tenant_id,
                    LoyaltyMembership.lookup_code == code,
                )
            )
        ).scalar_one_or_none()
        if exists is None:
            return code
    raise DomainError(
        "membership_code_generation_failed",
        "Üyelik kodu üretilemedi; lütfen yeniden deneyin.",
        status_code=503,
    )


async def membership_from_token(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    raw_token: str,
    branch_id: UUID | None = None,
    require_active_program: bool = True,
) -> LoyaltyMembership | None:
    membership = (
        await db.execute(
            select(LoyaltyMembership).where(
                LoyaltyMembership.tenant_id == tenant_id,
                LoyaltyMembership.public_token_hash == membership_token_hash(raw_token),
                LoyaltyMembership.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        return None
    if as_utc(membership.consent_at) + timedelta(days=PUBLIC_MEMBERSHIP_TTL_DAYS) <= utcnow():
        return None
    if require_active_program:
        program = await db.get(LoyaltyProgram, membership.program_id)
        if program is None or not program_is_current(program):
            return None
    if branch_id is not None:
        branch_allowed = (
            await db.execute(
                select(LoyaltyProgramBranch.program_id).where(
                    LoyaltyProgramBranch.tenant_id == tenant_id,
                    LoyaltyProgramBranch.program_id == membership.program_id,
                    LoyaltyProgramBranch.branch_id == branch_id,
                )
            )
        ).scalar_one_or_none()
        if branch_allowed is None:
            return None
    return membership


async def membership_from_code(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    code: str,
) -> LoyaltyMembership | None:
    return (
        await db.execute(
            select(LoyaltyMembership).where(
                LoyaltyMembership.tenant_id == tenant_id,
                LoyaltyMembership.lookup_code == code.strip().upper(),
                LoyaltyMembership.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()


async def membership_progress(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    membership_id: UUID,
    program_id: UUID,
) -> Decimal:
    value = (
        await db.execute(
            select(func.coalesce(func.sum(LoyaltyLedgerEntry.progress_delta), 0)).where(
                LoyaltyLedgerEntry.tenant_id == tenant_id,
                LoyaltyLedgerEntry.membership_id == membership_id,
                LoyaltyLedgerEntry.program_id == program_id,
            )
        )
    ).scalar_one()
    return Decimal(value)


async def accrue_paid_order(
    db: AsyncSession,
    *,
    order: Order,
    actor_user_id: UUID | None,
) -> LoyaltyLedgerEntry | None:
    if order.status != OrderStatus.PAID or order.total <= 0:
        return None
    if order.loyalty_membership_id is None:
        return None
    membership = (
        await db.execute(
            select(LoyaltyMembership)
            .where(
                LoyaltyMembership.id == order.loyalty_membership_id,
                LoyaltyMembership.tenant_id == order.tenant_id,
                LoyaltyMembership.is_active.is_(True),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if membership is None:
        return None
    program = (
        await db.execute(
            select(LoyaltyProgram)
            .where(
                LoyaltyProgram.id == membership.program_id,
                LoyaltyProgram.tenant_id == order.tenant_id,
            )
            .options(selectinload(LoyaltyProgram.rule))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if program is None or not program_is_current(program) or program.rule is None:
        return None
    branch_allowed = (
        await db.execute(
            select(LoyaltyProgramBranch.program_id).where(
                LoyaltyProgramBranch.tenant_id == order.tenant_id,
                LoyaltyProgramBranch.program_id == program.id,
                LoyaltyProgramBranch.branch_id == order.branch_id,
            )
        )
    ).scalar_one_or_none()
    if branch_allowed is None or order.total < program.rule.minimum_order_amount:
        return None
    existing = (
        await db.execute(
            select(LoyaltyLedgerEntry).where(
                LoyaltyLedgerEntry.program_id == program.id,
                LoyaltyLedgerEntry.order_id == order.id,
                LoyaltyLedgerEntry.entry_type == LoyaltyLedgerEntryType.ACCRUAL,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    delta = await _progress_delta(db, order=order, rule=program.rule, membership=membership)
    if delta <= 0:
        return None
    entry = LoyaltyLedgerEntry(
        tenant_id=order.tenant_id,
        branch_id=order.branch_id,
        program_id=program.id,
        membership_id=membership.id,
        order_id=order.id,
        entry_type=LoyaltyLedgerEntryType.ACCRUAL,
        progress_delta=delta,
        actor_user_id=actor_user_id,
        idempotency_key=f"paid-order:{order.id}:program:{program.id}",
        reason="paid_order",
        entry_metadata={
            "campaign_type": program.rule.campaign_type.value,
            "rule_version": program.version,
            "threshold": str(program.rule.threshold),
            "minimum_order_amount": str(program.rule.minimum_order_amount),
            "qualifying_product_id": (
                str(program.rule.qualifying_product_id)
                if program.rule.qualifying_product_id is not None
                else None
            ),
            "qualifying_category_id": (
                str(program.rule.qualifying_category_id)
                if program.rule.qualifying_category_id is not None
                else None
            ),
            "order_total": str(order.total),
        },
    )
    db.add(entry)
    await db.flush()
    await _sync_rewards_after_progress(db, membership=membership, program=program, entry=entry)
    return entry


async def _progress_delta(
    db: AsyncSession,
    *,
    order: Order,
    rule: LoyaltyRule,
    membership: LoyaltyMembership,
) -> Decimal:
    if rule.campaign_type == LoyaltyCampaignType.VISIT_COUNT:
        if not rule.allow_multiple_same_day:
            paid_at = order.paid_at or utcnow()
            branch_timezone = (
                await db.execute(
                    select(Branch.timezone).where(
                        Branch.id == order.branch_id,
                        Branch.tenant_id == order.tenant_id,
                    )
                )
            ).scalar_one_or_none()
            try:
                timezone = ZoneInfo(branch_timezone or "UTC")
            except ZoneInfoNotFoundError:
                timezone = ZoneInfo("UTC")
            local_paid_at = as_utc(paid_at).astimezone(timezone)
            local_day_start = local_paid_at.replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            day_start = local_day_start.astimezone(UTC)
            day_end = (local_day_start + timedelta(days=1)).astimezone(UTC)
            reversal = aliased(LoyaltyLedgerEntry)
            valid_same_day_visits = (
                await db.execute(
                    select(func.count(LoyaltyLedgerEntry.id))
                    .outerjoin(
                        reversal,
                        (reversal.source_entry_id == LoyaltyLedgerEntry.id)
                        & (reversal.entry_type == LoyaltyLedgerEntryType.REVERSAL),
                    )
                    .where(
                        LoyaltyLedgerEntry.tenant_id == order.tenant_id,
                        LoyaltyLedgerEntry.membership_id == membership.id,
                        LoyaltyLedgerEntry.program_id == rule.program_id,
                        LoyaltyLedgerEntry.entry_type
                        == LoyaltyLedgerEntryType.ACCRUAL,
                        LoyaltyLedgerEntry.created_at >= day_start,
                        LoyaltyLedgerEntry.created_at < day_end,
                        reversal.id.is_(None),
                    )
                )
            ).scalar_one()
            if valid_same_day_visits > 0:
                return Decimal("0")
        return Decimal("1")

    product_ids: set[UUID]
    if rule.qualifying_product_id is not None:
        product_ids = {rule.qualifying_product_id}
    elif rule.qualifying_category_id is not None:
        product_ids = set(
            (
                await db.execute(
                    select(Product.id).where(
                        Product.tenant_id == order.tenant_id,
                        Product.category_id == rule.qualifying_category_id,
                    )
                )
            )
            .scalars()
            .all()
        )
    else:
        return Decimal("0")
    redemption_rows = (
        await db.execute(
            select(
                LoyaltyRedemption.order_item_id,
                func.count(LoyaltyRedemption.id),
            )
            .where(
                LoyaltyRedemption.tenant_id == order.tenant_id,
                LoyaltyRedemption.order_id == order.id,
                LoyaltyRedemption.status == LoyaltyRedemptionStatus.APPLIED,
            )
            .group_by(LoyaltyRedemption.order_item_id)
        )
    ).all()
    rewarded_units = {
        item_id: Decimal(count) for item_id, count in redemption_rows
    }
    return sum(
        (
            max(Decimal("0"), item.quantity - rewarded_units.get(item.id, Decimal("0")))
            for item in order.items
            if item.product_id in product_ids
            and item.status not in {OrderItemStatus.CANCELLED, OrderItemStatus.VOIDED}
        ),
        Decimal("0"),
    )


async def _sync_rewards_after_progress(
    db: AsyncSession,
    *,
    membership: LoyaltyMembership,
    program: LoyaltyProgram,
    entry: LoyaltyLedgerEntry,
) -> None:
    assert program.rule is not None
    progress = await membership_progress(
        db,
        tenant_id=membership.tenant_id,
        membership_id=membership.id,
        program_id=program.id,
    )
    earned_count = max(0, int(progress // Decimal(program.rule.threshold)))
    active_rewards = (
        await db.execute(
            select(func.count(LoyaltyReward.id)).where(
                LoyaltyReward.tenant_id == membership.tenant_id,
                LoyaltyReward.membership_id == membership.id,
                LoyaltyReward.program_id == program.id,
                LoyaltyReward.status.in_(
                    [LoyaltyRewardStatus.AVAILABLE, LoyaltyRewardStatus.REDEEMED]
                ),
            )
        )
    ).scalar_one()
    if active_rewards >= earned_count:
        return
    max_ordinal = (
        await db.execute(
            select(func.coalesce(func.max(LoyaltyReward.ordinal), 0)).where(
                LoyaltyReward.tenant_id == membership.tenant_id,
                LoyaltyReward.membership_id == membership.id,
                LoyaltyReward.program_id == program.id,
            )
        )
    ).scalar_one()
    now = utcnow()
    for offset in range(earned_count - active_rewards):
        reward = LoyaltyReward(
            tenant_id=membership.tenant_id,
            branch_id=entry.branch_id,
            program_id=program.id,
            membership_id=membership.id,
            source_ledger_entry_id=entry.id,
            reward_product_id=program.rule.reward_product_id,
            reward_category_id=program.rule.reward_category_id,
            ordinal=int(max_ordinal) + offset + 1,
            redemption_code=await _new_reward_code(db, membership.tenant_id),
            status=LoyaltyRewardStatus.AVAILABLE,
            issued_at=now,
        )
        db.add(reward)
        await db.flush()


async def _new_reward_code(db: AsyncSession, tenant_id: UUID) -> str:
    for _ in range(8):
        code = f"RW-{secrets.token_urlsafe(10).replace('-', '').replace('_', '').upper()[:14]}"
        exists = (
            await db.execute(
                select(LoyaltyReward.id).where(
                    LoyaltyReward.tenant_id == tenant_id,
                    LoyaltyReward.redemption_code == code,
                )
            )
        ).scalar_one_or_none()
        if exists is None:
            return code
    raise DomainError(
        "reward_code_generation_failed",
        "Ödül kodu üretilemedi; lütfen yeniden deneyin.",
        status_code=503,
    )


async def _lock_memberships(db: AsyncSession, membership_ids: set[UUID]) -> None:
    if not membership_ids:
        return
    await db.execute(
        select(LoyaltyMembership.id)
        .where(LoyaltyMembership.id.in_(membership_ids))
        .order_by(LoyaltyMembership.id)
        .with_for_update()
    )


async def reverse_order_loyalty(
    db: AsyncSession,
    *,
    order: Order,
    identity: Identity,
    idempotency_key: str,
    reason: str,
) -> tuple[int, Decimal]:
    accruals = (
        (
            await db.execute(
                select(LoyaltyLedgerEntry).where(
                    LoyaltyLedgerEntry.tenant_id == order.tenant_id,
                    LoyaltyLedgerEntry.order_id == order.id,
                    LoyaltyLedgerEntry.entry_type == LoyaltyLedgerEntryType.ACCRUAL,
                )
            )
        )
        .scalars()
        .all()
    )
    await _lock_memberships(db, {accrual.membership_id for accrual in accruals})
    reversed_count = 0
    reversed_progress = Decimal("0")
    for accrual in accruals:
        existing = (
            await db.execute(
                select(LoyaltyLedgerEntry).where(
                    LoyaltyLedgerEntry.program_id == accrual.program_id,
                    LoyaltyLedgerEntry.order_id == order.id,
                    LoyaltyLedgerEntry.entry_type == LoyaltyLedgerEntryType.REVERSAL,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            continue
        reversal = LoyaltyLedgerEntry(
            tenant_id=accrual.tenant_id,
            branch_id=accrual.branch_id,
            program_id=accrual.program_id,
            membership_id=accrual.membership_id,
            order_id=accrual.order_id,
            entry_type=LoyaltyLedgerEntryType.REVERSAL,
            progress_delta=-accrual.progress_delta,
            source_entry_id=accrual.id,
            actor_user_id=identity.user_id,
            idempotency_key=f"{idempotency_key}:program:{accrual.program_id}",
            reason=reason,
            entry_metadata={"source_entry_id": str(accrual.id)},
        )
        db.add(reversal)
        await db.flush()
        await _reverse_unearned_rewards(
            db,
            tenant_id=accrual.tenant_id,
            membership_id=accrual.membership_id,
            program_id=accrual.program_id,
        )
        reversed_count += 1
        reversed_progress += accrual.progress_delta
    return reversed_count, reversed_progress


async def reverse_order_redemptions(
    db: AsyncSession,
    *,
    order: Order,
    identity: Identity,
    reason: str,
    order_item_ids: set[UUID] | None = None,
) -> tuple[int, Decimal]:
    predicates = [
        LoyaltyRedemption.tenant_id == order.tenant_id,
        LoyaltyRedemption.order_id == order.id,
        LoyaltyRedemption.status == LoyaltyRedemptionStatus.APPLIED,
    ]
    if order_item_ids is not None:
        predicates.append(LoyaltyRedemption.order_item_id.in_(order_item_ids))
    redemptions = (
        (
            await db.execute(
                select(LoyaltyRedemption).where(*predicates).with_for_update()
            )
        )
        .scalars()
        .all()
    )
    await _lock_memberships(
        db, {redemption.membership_id for redemption in redemptions}
    )
    reversed_amount = Decimal("0")
    for redemption in redemptions:
        reward = (
            await db.execute(
                select(LoyaltyReward)
                .where(
                    LoyaltyReward.id == redemption.reward_id,
                    LoyaltyReward.tenant_id == order.tenant_id,
                )
                .with_for_update()
            )
        ).scalar_one()
        redemption.status = LoyaltyRedemptionStatus.REVERSED
        reward.status = LoyaltyRewardStatus.REVERSED
        await db.flush()
        rule = (
            await db.execute(
                select(LoyaltyRule).where(
                    LoyaltyRule.tenant_id == reward.tenant_id,
                    LoyaltyRule.program_id == reward.program_id,
                )
            )
        ).scalar_one()
        progress = await membership_progress(
            db,
            tenant_id=reward.tenant_id,
            membership_id=reward.membership_id,
            program_id=reward.program_id,
        )
        allowed = max(0, int(progress // Decimal(rule.threshold)))
        active_count = (
            await db.execute(
                select(func.count(LoyaltyReward.id)).where(
                    LoyaltyReward.tenant_id == reward.tenant_id,
                    LoyaltyReward.membership_id == reward.membership_id,
                    LoyaltyReward.program_id == reward.program_id,
                    LoyaltyReward.status.in_(
                        [LoyaltyRewardStatus.AVAILABLE, LoyaltyRewardStatus.REDEEMED]
                    ),
                )
            )
        ).scalar_one()
        if active_count < allowed:
            max_ordinal = (
                await db.execute(
                    select(func.coalesce(func.max(LoyaltyReward.ordinal), 0)).where(
                        LoyaltyReward.tenant_id == reward.tenant_id,
                        LoyaltyReward.membership_id == reward.membership_id,
                        LoyaltyReward.program_id == reward.program_id,
                    )
                )
            ).scalar_one()
            db.add(
                LoyaltyReward(
                    tenant_id=reward.tenant_id,
                    branch_id=reward.branch_id,
                    program_id=reward.program_id,
                    membership_id=reward.membership_id,
                    source_ledger_entry_id=reward.source_ledger_entry_id,
                    reward_product_id=reward.reward_product_id,
                    reward_category_id=reward.reward_category_id,
                    ordinal=int(max_ordinal) + 1,
                    redemption_code=await _new_reward_code(db, reward.tenant_id),
                    status=LoyaltyRewardStatus.AVAILABLE,
                    issued_at=utcnow(),
                    expires_at=reward.expires_at,
                )
            )
            await db.flush()
        reversed_amount += redemption.amount
        db.add(
            Discount(
                tenant_id=order.tenant_id,
                branch_id=order.branch_id,
                order_id=order.id,
                order_item_id=redemption.order_item_id,
                requested_by_user_id=identity.user_id,
                approved_by_user_id=identity.user_id,
                kind=DiscountKind.FIXED,
                value=-redemption.amount,
                amount=-redemption.amount,
                reason=f"Sadakat ödülü iptali {redemption.id}",
            )
        )
        add_audit_log(
            db,
            identity=identity,
            action="loyalty.redemption_reversed",
            resource_type="loyalty_redemption",
            resource_id=redemption.id,
            branch_id=order.branch_id,
            new_value={"amount": str(redemption.amount)},
            reason=reason,
        )
    if reversed_amount:
        order.discount_total = money(max(Decimal("0"), order.discount_total - reversed_amount))
        order.total = money(
            max(Decimal("0"), order.subtotal - order.discount_total + order.tax_total)
        )
    return len(redemptions), reversed_amount


async def _reverse_unearned_rewards(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    membership_id: UUID,
    program_id: UUID,
) -> None:
    rule = (
        await db.execute(
            select(LoyaltyRule).where(
                LoyaltyRule.tenant_id == tenant_id,
                LoyaltyRule.program_id == program_id,
            )
        )
    ).scalar_one()
    progress = await membership_progress(
        db,
        tenant_id=tenant_id,
        membership_id=membership_id,
        program_id=program_id,
    )
    allowed = max(0, int(progress // Decimal(rule.threshold)))
    rewards = (
        (
            await db.execute(
                select(LoyaltyReward)
                .where(
                    LoyaltyReward.tenant_id == tenant_id,
                    LoyaltyReward.membership_id == membership_id,
                    LoyaltyReward.program_id == program_id,
                    LoyaltyReward.status.in_(
                        [LoyaltyRewardStatus.AVAILABLE, LoyaltyRewardStatus.REDEEMED]
                    ),
                )
                .order_by(LoyaltyReward.ordinal.desc())
            )
        )
        .scalars()
        .all()
    )
    excess = max(0, len(rewards) - allowed)
    for reward in [item for item in rewards if item.status == LoyaltyRewardStatus.AVAILABLE][
        :excess
    ]:
        reward.status = LoyaltyRewardStatus.REVERSED


async def attach_membership_to_order(
    db: AsyncSession,
    *,
    order: Order,
    membership: LoyaltyMembership,
) -> None:
    if membership.tenant_id != order.tenant_id:
        raise DomainError("membership_not_found", "Üyelik bulunamadı.", status_code=404)
    program = (
        await db.execute(
            select(LoyaltyProgram).where(
                LoyaltyProgram.id == membership.program_id,
                LoyaltyProgram.tenant_id == order.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if program is None or not program_is_current(program):
        raise DomainError(
            "loyalty_program_inactive",
            "Sadakat programı şu anda kullanılamıyor.",
            status_code=409,
        )
    program_branch = (
        await db.execute(
            select(LoyaltyProgramBranch.program_id).where(
                LoyaltyProgramBranch.tenant_id == order.tenant_id,
                LoyaltyProgramBranch.program_id == membership.program_id,
                LoyaltyProgramBranch.branch_id == order.branch_id,
            )
        )
    ).scalar_one_or_none()
    if program_branch is None:
        raise DomainError(
            "membership_branch_not_eligible",
            "Üyelik bu şubede kullanılamaz.",
            status_code=409,
        )
    if order.status in {OrderStatus.PAID, OrderStatus.CANCELLED, OrderStatus.VOIDED}:
        raise DomainError(
            "order_membership_locked",
            "Tamamlanmış siparişin sadakat üyeliği değiştirilemez.",
            status_code=409,
        )
    if order.loyalty_membership_id not in {None, membership.id}:
        raise DomainError(
            "order_membership_conflict",
            "Sipariş başka bir sadakat üyeliğine bağlı.",
            status_code=409,
        )
    order.loyalty_membership_id = membership.id
    order.version += 1


async def redeem_reward(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    redemption_code: str,
    order: Order,
    order_item_id: UUID,
    idempotency_key: str,
    identity: Identity,
) -> LoyaltyRedemption:
    if order.tenant_id != tenant_id:
        raise DomainError("order_not_found", "Sipariş bulunamadı.", status_code=404)
    command_order_id = order.id
    command_branch_id = order.branch_id
    existing = (
        await db.execute(
            select(LoyaltyRedemption).where(
                LoyaltyRedemption.tenant_id == tenant_id,
                LoyaltyRedemption.idempotency_key == idempotency_key,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return await _validated_redemption_replay(
            db,
            redemption=existing,
            redemption_code=redemption_code,
            tenant_id=tenant_id,
            order_id=command_order_id,
            branch_id=command_branch_id,
            order_item_id=order_item_id,
        )
    reward = (
        await db.execute(
            select(LoyaltyReward)
            .where(
                LoyaltyReward.tenant_id == tenant_id,
                LoyaltyReward.redemption_code == redemption_code.strip().upper(),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if reward is None:
        raise DomainError("reward_not_found", "Ödül bulunamadı.", status_code=404)
    existing = (
        await db.execute(
            select(LoyaltyRedemption).where(
                LoyaltyRedemption.tenant_id == tenant_id,
                LoyaltyRedemption.idempotency_key == idempotency_key,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return await _validated_redemption_replay(
            db,
            redemption=existing,
            redemption_code=redemption_code,
            tenant_id=tenant_id,
            order_id=command_order_id,
            branch_id=command_branch_id,
            order_item_id=order_item_id,
        )
    membership = (
        await db.execute(
            select(LoyaltyMembership).where(
                LoyaltyMembership.id == reward.membership_id,
                LoyaltyMembership.tenant_id == tenant_id,
                LoyaltyMembership.program_id == reward.program_id,
                LoyaltyMembership.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    program = (
        await db.execute(
            select(LoyaltyProgram).where(
                LoyaltyProgram.id == reward.program_id,
                LoyaltyProgram.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if membership is None or program is None or not program_is_current(program):
        raise DomainError(
            "reward_unavailable", "Ödül kullanılamıyor.", status_code=409
        )
    branch_allowed = (
        await db.execute(
            select(LoyaltyProgramBranch.program_id).where(
                LoyaltyProgramBranch.tenant_id == tenant_id,
                LoyaltyProgramBranch.program_id == reward.program_id,
                LoyaltyProgramBranch.branch_id == order.branch_id,
            )
        )
    ).scalar_one_or_none()
    if branch_allowed is None:
        raise DomainError(
            "reward_branch_not_eligible",
            "Ödül bu şubede kullanılamaz.",
            status_code=409,
        )
    if reward.status != LoyaltyRewardStatus.AVAILABLE:
        raise DomainError("reward_unavailable", "Ödül kullanılamıyor.", status_code=409)
    if reward.expires_at is not None and as_utc(reward.expires_at) <= utcnow():
        raise DomainError("reward_expired", "Ödülün süresi dolmuş.", status_code=409)
    if order.status not in {
        OrderStatus.ACCEPTED,
        OrderStatus.PREPARING,
        OrderStatus.PARTIALLY_READY,
        OrderStatus.READY,
        OrderStatus.SERVED,
        OrderStatus.BILL_REQUESTED,
    }:
        raise DomainError(
            "order_not_discountable",
            "Ödül yalnızca kabul edilmiş ve ödemesi başlamamış siparişe uygulanabilir.",
            status_code=409,
        )
    if any(payment.status == PaymentStatus.COMPLETED for payment in order.payments):
        raise DomainError(
            "reward_after_payment_started",
            "Ödül, ödeme alınmaya başlamadan önce uygulanmalıdır.",
            status_code=409,
        )
    if order.loyalty_membership_id not in {None, reward.membership_id}:
        raise DomainError(
            "reward_membership_mismatch", "Ödül sipariş üyeliğiyle eşleşmiyor.", status_code=409
        )
    item = next((candidate for candidate in order.items if candidate.id == order_item_id), None)
    if item is None:
        raise DomainError("order_item_not_found", "Sipariş ürünü bulunamadı.", status_code=404)
    if item.status in {OrderItemStatus.CANCELLED, OrderItemStatus.VOIDED}:
        raise DomainError(
            "order_item_unavailable", "Sipariş ürünü kullanılamıyor.", status_code=409
        )
    if reward.reward_product_id is not None and item.product_id != reward.reward_product_id:
        raise DomainError(
            "reward_item_not_eligible", "Seçilen ürün bu ödül için uygun değil.", status_code=409
        )
    if reward.reward_category_id is not None:
        category_id = (
            await db.execute(
                select(Product.category_id).where(
                    Product.id == item.product_id,
                    Product.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if category_id != reward.reward_category_id:
            raise DomainError(
                "reward_item_not_eligible",
                "Seçilen ürün bu ödül için uygun değil.",
                status_code=409,
            )
    prior_discount = (
        await db.execute(
            select(func.coalesce(func.sum(Discount.amount), 0)).where(
                Discount.tenant_id == tenant_id,
                Discount.order_id == order.id,
                Discount.order_item_id == item.id,
            )
        )
    ).scalar_one()
    available_line_amount = max(Decimal("0"), item.line_total - Decimal(prior_discount))
    available_order_amount = max(
        Decimal("0"),
        min(order.total, order.subtotal - order.discount_total),
    )
    amount = money(min(item.unit_price, available_line_amount, available_order_amount))
    if amount <= 0:
        raise DomainError(
            "reward_has_no_value", "Seçilen üründe uygulanabilir tutar kalmadı.", status_code=409
        )
    discount = Discount(
        tenant_id=tenant_id,
        branch_id=order.branch_id,
        order_id=order.id,
        order_item_id=item.id,
        requested_by_user_id=identity.user_id,
        approved_by_user_id=identity.user_id,
        kind=DiscountKind.FIXED,
        value=amount,
        amount=amount,
        reason=f"Sadakat ödülü {reward.redemption_code}",
    )
    db.add(discount)
    await db.flush()
    order.loyalty_membership_id = reward.membership_id
    order.discount_total = money(order.discount_total + amount)
    order.total = money(max(Decimal("0"), order.subtotal - order.discount_total + order.tax_total))
    order.version += 1
    await _settle_fully_discounted_order(db, order)
    now = utcnow()
    reward.status = LoyaltyRewardStatus.REDEEMED
    reward.redeemed_at = now
    redemption = LoyaltyRedemption(
        tenant_id=tenant_id,
        branch_id=order.branch_id,
        membership_id=reward.membership_id,
        reward_id=reward.id,
        order_id=order.id,
        order_item_id=item.id,
        discount_id=discount.id,
        actor_user_id=identity.user_id,
        idempotency_key=idempotency_key,
        status=LoyaltyRedemptionStatus.APPLIED,
        amount=amount,
        reason="loyalty_reward",
        reward_snapshot={
            "redemption_code": reward.redemption_code,
            "reward_product_id": str(reward.reward_product_id)
            if reward.reward_product_id
            else None,
            "reward_category_id": str(reward.reward_category_id)
            if reward.reward_category_id
            else None,
        },
    )
    db.add(redemption)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        replay = (
            await db.execute(
                select(LoyaltyRedemption).where(
                    LoyaltyRedemption.tenant_id == tenant_id,
                    LoyaltyRedemption.idempotency_key == idempotency_key,
                )
            )
        ).scalar_one_or_none()
        if replay is None:
            raise
        return await _validated_redemption_replay(
            db,
            redemption=replay,
            redemption_code=redemption_code,
            tenant_id=tenant_id,
            order_id=command_order_id,
            branch_id=command_branch_id,
            order_item_id=order_item_id,
        )
    add_audit_log(
        db,
        identity=identity,
        action="loyalty.reward_redeemed",
        resource_type="loyalty_redemption",
        resource_id=redemption.id,
        branch_id=order.branch_id,
        new_value={"order_id": str(order.id), "amount": str(amount)},
    )
    return redemption


async def _settle_fully_discounted_order(db: AsyncSession, order: Order) -> None:
    if order.total != 0:
        return
    order.status = OrderStatus.PAID
    order.paid_at = utcnow()
    if order.table_session_id is None:
        return
    table_session = await db.get(TableSession, order.table_session_id)
    if table_session is None:
        return
    other_open_checks = (
        await db.execute(
            select(func.count(Order.id)).where(
                Order.tenant_id == order.tenant_id,
                Order.table_session_id == order.table_session_id,
                Order.id != order.id,
                Order.status.notin_(
                    [OrderStatus.PAID, OrderStatus.CANCELLED, OrderStatus.VOIDED]
                ),
            )
        )
    ).scalar_one()
    if other_open_checks:
        return
    table = await db.get(DiningTable, table_session.table_id)
    if table is not None:
        # A fully discounted check is settled, but the table remains occupied
        # until an operator explicitly closes this exact session.
        table.state = TableState.CLEANING
        table.version += 1


async def reward_description(db: AsyncSession, rule: LoyaltyRule) -> str:
    return await reward_target_description(
        db,
        tenant_id=rule.tenant_id,
        reward_product_id=rule.reward_product_id,
        reward_category_id=rule.reward_category_id,
    )


async def reward_target_description(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    reward_product_id: UUID | None,
    reward_category_id: UUID | None,
) -> str:
    if reward_product_id is not None:
        name = (
            await db.execute(
                select(Product.name).where(
                    Product.id == reward_product_id,
                    Product.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        return f"{name or 'Seçili ürün'} ikramı"
    name = (
        await db.execute(
            select(Category.name).where(
                Category.id == reward_category_id,
                Category.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    return f"{name or 'Seçili kategori'} ikramı"
