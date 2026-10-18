from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

NotificationStatus = Literal["PENDING", "SENT", "FAILED", "CANCELLED"]


class NotificationOut(BaseModel):
    id: UUID
    notification_type: str
    recipient: str
    title: str
    status: NotificationStatus
    attempts: int
    retry_scheduled: bool
    created_at: datetime
    sent_at: datetime | None
    next_attempt_at: datetime | None


class NotificationOverview(BaseModel):
    delivery_mode: str
    counts: dict[str, int]
    items: list[NotificationOut]
