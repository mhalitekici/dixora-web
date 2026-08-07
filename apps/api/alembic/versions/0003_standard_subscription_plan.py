"""Add the public self-service subscription plan.

Revision ID: 0003_standard_plan
Revises: 0002_category_color
Create Date: 2026-08-01
"""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

import sqlalchemy as sa

from alembic import op

revision = "0003_standard_plan"
down_revision = "0002_category_color"
branch_labels = None
depends_on = None

PLAN_ID = UUID("7df89a1d-fd97-42d6-a157-27a236aca818")
FEATURES = (
    (UUID("5d30be2a-e296-4359-81ec-710c9ca5fb43"), "QR_MENU"),
    (UUID("d017b2da-1023-49a8-b251-7e339d01b932"), "QR_ORDERING"),
    (UUID("a9b63245-a825-4681-99ec-cfddcf12d450"), "INVENTORY"),
    (UUID("e4d3ce4b-6e1a-433e-832a-74d3c8a85234"), "KITCHEN_DISPLAY"),
    (UUID("ebec47f9-6d60-4a70-988f-fb80952c3a79"), "PRINT_BRIDGE"),
    (UUID("7757da0e-fcdc-4e72-aee1-6ebdb019a63a"), "REPORTS"),
)


def upgrade() -> None:
    connection = op.get_bind()
    exists = connection.execute(
        sa.text("SELECT 1 FROM subscription_plans WHERE code = :code"),
        {"code": "STANDARD"},
    ).scalar_one_or_none()
    if exists is not None:
        return

    now = datetime.now(UTC).replace(tzinfo=None)
    plans = sa.table(
        "subscription_plans",
        sa.column("id", sa.Uuid()),
        sa.column("code", sa.String()),
        sa.column("name", sa.String()),
        sa.column("monthly_price", sa.Numeric(14, 2)),
        sa.column("currency", sa.String()),
        sa.column("max_branches", sa.Integer()),
        sa.column("max_users", sa.Integer()),
        sa.column("is_active", sa.Boolean()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    features = sa.table(
        "subscription_features",
        sa.column("id", sa.Uuid()),
        sa.column("plan_id", sa.Uuid()),
        sa.column("feature_code", sa.String()),
        sa.column("is_enabled", sa.Boolean()),
        sa.column("limits", sa.JSON()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    op.bulk_insert(
        plans,
        [
            {
                "id": PLAN_ID,
                "code": "STANDARD",
                "name": "Dixora Standard",
                "monthly_price": Decimal("1499.99"),
                "currency": "TRY",
                "max_branches": 1,
                "max_users": 50,
                "is_active": True,
                "created_at": now,
                "updated_at": now,
            }
        ],
    )
    op.bulk_insert(
        features,
        [
            {
                "id": feature_id,
                "plan_id": PLAN_ID,
                "feature_code": feature_code,
                "is_enabled": True,
                "limits": {},
                "created_at": now,
                "updated_at": now,
            }
            for feature_id, feature_code in FEATURES
        ],
    )


def downgrade() -> None:
    connection = op.get_bind()
    in_use = connection.execute(
        sa.text("SELECT 1 FROM subscriptions WHERE plan_id = :plan_id LIMIT 1"),
        {"plan_id": PLAN_ID},
    ).scalar_one_or_none()
    if in_use is not None:
        return
    connection.execute(
        sa.text("DELETE FROM subscription_features WHERE plan_id = :plan_id"),
        {"plan_id": PLAN_ID},
    )
    connection.execute(
        sa.text("DELETE FROM subscription_plans WHERE id = :plan_id"),
        {"plan_id": PLAN_ID},
    )
