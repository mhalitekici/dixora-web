from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import timedelta
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import (
    Branch,
    Campaign,
    CampaignBranch,
    Category,
    EmailNotification,
    LoyaltyCustomer,
    LoyaltyMembership,
    LoyaltyReward,
    Product,
    Tenant,
)
from app.models.enums import CampaignRewardKind
from app.security import utcnow
from app.services.campaigns import campaign_summary
from app.services.email import OutgoingEmail, get_email_sender
from app.services.email_templates import (
    campaign_announcement_email,
    loyalty_reward_available_email,
)

logger = logging.getLogger(__name__)

CAMPAIGN_ANNOUNCEMENT = "CAMPAIGN_ANNOUNCEMENT"
LOYALTY_REWARD_AVAILABLE = "LOYALTY_REWARD_AVAILABLE"
MAX_DELIVERY_ATTEMPTS = 5


def reward_verification_code(settings: Settings, *, tenant_id: UUID, reward_id: UUID) -> str:
    """Stable six digits without persisting or logging the customer secret."""

    digest = hmac.new(
        settings.jwt_secret.get_secret_value().encode("utf-8"),
        f"loyalty-reward:{tenant_id}:{reward_id}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return f"{int.from_bytes(digest[:8], 'big') % 1_000_000:06d}"


def _campaign_details(campaign: Campaign, branch_names: list[str]) -> str:
    parts: list[str] = []
    if branch_names:
        parts.append("Geçerli şubeler: " + ", ".join(branch_names))
    if campaign.starts_at:
        parts.append("Başlangıç: " + campaign.starts_at.strftime("%d.%m.%Y %H:%M"))
    if campaign.ends_at:
        parts.append("Bitiş: " + campaign.ends_at.strftime("%d.%m.%Y %H:%M"))
    return " · ".join(parts)


async def queue_campaign_announcements(
    db: AsyncSession, *, campaign: Campaign
) -> int:
    if not campaign.is_active or not campaign.notify_loyalty_members:
        return 0
    branch_ids = list(
        (
            await db.execute(
                select(CampaignBranch.branch_id).where(
                    CampaignBranch.tenant_id == campaign.tenant_id,
                    CampaignBranch.campaign_id == campaign.id,
                )
            )
        ).scalars()
    )
    if not branch_ids:
        return 0
    tenant = await db.get(Tenant, campaign.tenant_id)
    if tenant is None:
        return 0
    rows = (
        await db.execute(
            select(LoyaltyCustomer)
            .join(LoyaltyMembership, LoyaltyMembership.customer_id == LoyaltyCustomer.id)
            .where(
                LoyaltyCustomer.tenant_id == campaign.tenant_id,
                LoyaltyCustomer.is_active.is_(True),
                LoyaltyCustomer.marketing_email_consent.is_(True),
                LoyaltyCustomer.email_normalized.is_not(None),
                LoyaltyMembership.tenant_id == campaign.tenant_id,
                LoyaltyMembership.is_active.is_(True),
                LoyaltyMembership.branch_id.in_(branch_ids),
            )
            .distinct()
        )
    ).scalars().all()
    branch_names = list(
        (
            await db.execute(
                select(Branch.name).where(
                    Branch.tenant_id == campaign.tenant_id, Branch.id.in_(branch_ids)
                )
            )
        ).scalars()
    )
    offer = await campaign_summary(db, tenant_id=campaign.tenant_id, campaign=campaign)
    details = _campaign_details(campaign, branch_names)
    for customer in rows:
        assert customer.email_normalized is not None
        db.add(
            EmailNotification(
                tenant_id=campaign.tenant_id,
                notification_type=CAMPAIGN_ANNOUNCEMENT,
                customer_id=customer.id,
                campaign_id=campaign.id,
                recipient_email=customer.email_normalized,
                idempotency_key=(
                    f"campaign:{campaign.id}:customer:{customer.id}:"
                    f"activation:{campaign.activation_version}"
                ),
                payload={
                    "greeting_name": customer.first_name or "",
                    "business_name": tenant.name,
                    "campaign_name": campaign.name,
                    "offer": offer,
                    "details": details,
                },
            )
        )
    await db.flush()
    return len(rows)


async def queue_reward_notification(
    db: AsyncSession, *, reward: LoyaltyReward
) -> bool:
    membership = (
        await db.execute(
            select(LoyaltyMembership).where(
                LoyaltyMembership.id == reward.membership_id,
                LoyaltyMembership.tenant_id == reward.tenant_id,
                LoyaltyMembership.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        return False
    customer = (
        await db.execute(
            select(LoyaltyCustomer).where(
                LoyaltyCustomer.id == membership.customer_id,
                LoyaltyCustomer.tenant_id == reward.tenant_id,
                LoyaltyCustomer.is_active.is_(True),
                LoyaltyCustomer.email_normalized.is_not(None),
            )
        )
    ).scalar_one_or_none()
    tenant = await db.get(Tenant, reward.tenant_id)
    if customer is None or tenant is None or customer.email_normalized is None:
        return False
    if reward.reward_product_id:
        target = (
            await db.execute(
                select(Product.name).where(
                    Product.id == reward.reward_product_id,
                    Product.tenant_id == reward.tenant_id,
                )
            )
        ).scalar_one_or_none() or "Seçili ürün"
        description = f"1 x {target} — Ücretsiz"
    else:
        target = (
            await db.execute(
                select(Category.name).where(
                    Category.id == reward.reward_category_id,
                    Category.tenant_id == reward.tenant_id,
                )
            )
        ).scalar_one_or_none() or "Seçili kategori"
        description = f"{target} kategorisinden 1 ürün ücretsiz."
    db.add(
        EmailNotification(
            tenant_id=reward.tenant_id,
            notification_type=LOYALTY_REWARD_AVAILABLE,
            customer_id=customer.id,
            reward_id=reward.id,
            recipient_email=customer.email_normalized,
            idempotency_key=f"loyalty-reward:{reward.id}:available",
            payload={
                "greeting_name": customer.first_name or "",
                "business_name": tenant.name,
                "reward_description": description,
            },
        )
    )
    await db.flush()
    return True


def _message(notification: EmailNotification, settings: Settings) -> OutgoingEmail:
    payload = notification.payload
    business = str(payload["business_name"])
    greeting = str(payload.get("greeting_name", ""))
    if notification.notification_type == CAMPAIGN_ANNOUNCEMENT:
        campaign_name = str(payload["campaign_name"])
        offer = str(payload["offer"])
        details = str(payload.get("details", "")) or None
        return OutgoingEmail(
            to=notification.recipient_email,
            subject=f"{business}’de yeni kampanya: {campaign_name}",
            text_body=(
                f"Merhaba {greeting or 'Değerli üyemiz'},\n\n{business}’de yeni bir kampanya başladı.\n\n"
                f"Kampanya:\n{offer}\n\n{details or ''}\n\n"
                f"Sizi tekrar aramızda görmekten mutluluk duyarız.\n\n{business}"
            ),
            html_body=campaign_announcement_email(
                greeting_name=greeting,
                business_name=business,
                campaign_name=campaign_name,
                offer=offer,
                details=details,
            ),
        )
    if notification.notification_type != LOYALTY_REWARD_AVAILABLE or notification.reward_id is None:
        raise ValueError("Unsupported email notification type")
    code = reward_verification_code(
        settings, tenant_id=notification.tenant_id, reward_id=notification.reward_id
    )
    description = str(payload["reward_description"])
    return OutgoingEmail(
        to=notification.recipient_email,
        subject=f"{greeting or 'Tebrikler'}, {description} ödülünüz hazır!",
        text_body=(
            f"Merhaba {greeting or 'Değerli üyemiz'},\n\nTebrikler!\n\n"
            f"{business} sadakat programında ödül kazandınız.\n\n"
            f"Ödülünüz:\n{description}\n\nDoğrulama kodu: {code}\n\n"
            "Bu kod yalnızca bu ödül için ve bir kez kullanılabilir.\n\n"
            f"{business}"
        ),
        html_body=loyalty_reward_available_email(
            greeting_name=greeting,
            business_name=business,
            reward_description=description,
            code=code,
        ),
    )


async def process_email_notifications(
    db: AsyncSession, settings: Settings, *, limit: int = 100
) -> tuple[int, int]:
    sent = failed = 0
    sender = get_email_sender(settings)
    for _ in range(limit):
        now = utcnow()
        notification = (
            await db.execute(
                select(EmailNotification)
                .where(
                    EmailNotification.status.in_(["PENDING", "FAILED"]),
                    EmailNotification.attempts < MAX_DELIVERY_ATTEMPTS,
                    or_(
                        EmailNotification.next_attempt_at.is_(None),
                        EmailNotification.next_attempt_at <= now,
                    ),
                )
                .order_by(EmailNotification.created_at)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
        ).scalar_one_or_none()
        if notification is None:
            break
        notification.attempts += 1
        try:
            await sender.send(_message(notification, settings))
        except Exception as exc:
            failed += 1
            notification.status = "FAILED"
            notification.last_error = type(exc).__name__
            notification.next_attempt_at = now + timedelta(
                minutes=min(60, 2 ** notification.attempts)
            )
            logger.warning(
                "email.notification_failed id=%s type=%s attempt=%s",
                notification.id,
                notification.notification_type,
                notification.attempts,
                exc_info=True,
            )
        else:
            sent += 1
            notification.status = "SENT"
            notification.sent_at = now
            notification.last_error = None
            notification.next_attempt_at = None
        await db.commit()
    return sent, failed


async def campaign_notification_status(
    db: AsyncSession, *, campaign: Campaign
) -> tuple[str, int]:
    if not campaign.notify_loyalty_members or campaign.activation_version == 0:
        return "NOT_REQUESTED", 0
    rows = (
        await db.execute(
            select(EmailNotification.status, func.count(EmailNotification.id))
            .where(
                EmailNotification.tenant_id == campaign.tenant_id,
                EmailNotification.campaign_id == campaign.id,
                EmailNotification.idempotency_key.like(
                    f"%:activation:{campaign.activation_version}"
                ),
            )
            .group_by(EmailNotification.status)
        )
    ).all()
    counts = {status: int(count) for status, count in rows}
    total = sum(counts.values())
    if total == 0:
        return "PENDING", 0
    if counts.get("FAILED"):
        return "FAILED", total
    if counts.get("PENDING"):
        return "PENDING", total
    return "SENT", total
