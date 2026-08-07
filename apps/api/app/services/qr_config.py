from __future__ import annotations

from uuid import UUID

from app.models import QrMenuConfig
from app.models.enums import QrOrderMode


def new_qr_menu_config(*, tenant_id: UUID, branch_id: UUID) -> QrMenuConfig:
    """Create a safe, fully initialized config before SQLAlchemy defaults are flushed."""
    return QrMenuConfig(
        tenant_id=tenant_id,
        branch_id=branch_id,
        menu_name="Menü",
        is_enabled=False,
        order_mode=QrOrderMode.WAITER_APPROVAL,
        logo_url=None,
        cover_image_url=None,
        primary_color="#F4511E",
        language="tr",
        currency="TRY",
        service_hours={},
        out_of_hours_message=None,
        customer_notes_enabled=True,
        allergens_visible=True,
        max_order_amount=None,
        contact_info={},
        social_links={},
    )
