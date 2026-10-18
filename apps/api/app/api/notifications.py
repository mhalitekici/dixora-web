from typing import Annotated, cast

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from app.config import Settings
from app.dependencies import (
    DbSession,
    Identity,
    get_app_settings,
    require_permissions,
    require_tenant,
)
from app.models import EmailNotification
from app.notification_schemas import NotificationOut, NotificationOverview, NotificationStatus
from app.security import as_utc
from app.services.email import get_email_sender
from app.services.email_notifications import MAX_DELIVERY_ATTEMPTS
from app.services.loyalty import mask_email

router = APIRouter(prefix="/notifications", tags=["notifications"])
NotificationReader = Annotated[Identity, Depends(require_permissions("loyalty.manage"))]


@router.get("", response_model=NotificationOverview)
async def list_notifications(
    identity: NotificationReader,
    db: DbSession,
    settings: Annotated[Settings, Depends(get_app_settings)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> NotificationOverview:
    tenant_id = require_tenant(identity)
    counts = {status: 0 for status in ("PENDING", "SENT", "FAILED", "CANCELLED")}
    rows = (
        await db.execute(
            select(EmailNotification.status, func.count(EmailNotification.id))
            .where(EmailNotification.tenant_id == tenant_id)
            .group_by(EmailNotification.status)
        )
    ).all()
    counts.update({status: int(count) for status, count in rows})
    notifications = (
        await db.scalars(
            select(EmailNotification)
            .where(EmailNotification.tenant_id == tenant_id)
            .order_by(EmailNotification.created_at.desc(), EmailNotification.id.desc())
            .limit(limit)
        )
    ).all()
    return NotificationOverview(
        delivery_mode=get_email_sender(settings).mode,
        counts=counts,
        items=[
            NotificationOut(
                id=item.id,
                notification_type=item.notification_type,
                recipient=mask_email(item.recipient_email),
                title=str(
                    item.payload.get("campaign_name")
                    or item.payload.get("reward_description")
                    or "Müşteri bildirimi"
                ),
                status=cast(NotificationStatus, item.status),
                attempts=item.attempts,
                retry_scheduled=(
                    item.status == "FAILED" and item.attempts < MAX_DELIVERY_ATTEMPTS
                ),
                created_at=as_utc(item.created_at),
                sent_at=as_utc(item.sent_at) if item.sent_at else None,
                next_attempt_at=as_utc(item.next_attempt_at) if item.next_attempt_at else None,
            )
            for item in notifications
        ],
    )
