"""Payment-method and meal-card answers on the onboarding questionnaire.

These drive which POS and marketplace integrations get built next, so they are
first-class columns rather than free text.

Revision ID: 0021_onboarding_payments
Revises: 0020_registration_onboarding
Create Date: 2026-08-10
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0021_onboarding_payments"
down_revision = "0020_registration_onboarding"
branch_labels = None
depends_on = None

TABLE = "tenant_onboarding"


def upgrade() -> None:
    bind = op.get_bind()
    columns = {c["name"] for c in sa.inspect(bind).get_columns(TABLE)}
    if "payment_methods" not in columns:
        op.add_column(
            TABLE,
            sa.Column("payment_methods", sa.JSON(), nullable=False, server_default="[]"),
        )
    if "accepts_meal_cards" not in columns:
        op.add_column(TABLE, sa.Column("accepts_meal_cards", sa.Boolean(), nullable=True))
    if "meal_card_providers" not in columns:
        op.add_column(
            TABLE,
            sa.Column(
                "meal_card_providers", sa.JSON(), nullable=False, server_default="[]"
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    columns = {c["name"] for c in sa.inspect(bind).get_columns(TABLE)}
    for name in ("meal_card_providers", "accepts_meal_cards", "payment_methods"):
        if name in columns:
            op.drop_column(TABLE, name)
