"""Branch-based subscription pricing.

The standard plan becomes "base price covers N branches, each further active
branch adds a fixed amount" instead of a flat price with a hard branch cap.

Revision ID: 0017_branch_based_pricing
Revises: 0016_branch_memberships
Create Date: 2026-08-09
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0017_branch_based_pricing"
down_revision = "0016_branch_memberships"
branch_labels = None
depends_on = None

TABLE_NAME = "subscription_plans"

BASE_MONTHLY_PRICE = "1200.00"
ADDITIONAL_BRANCH_PRICE = "850.00"


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns(TABLE_NAME)}

    if "included_branches" not in columns:
        op.add_column(
            TABLE_NAME,
            sa.Column(
                "included_branches", sa.Integer(), nullable=False, server_default="1"
            ),
        )
    if "additional_branch_price" not in columns:
        op.add_column(
            TABLE_NAME,
            sa.Column(
                "additional_branch_price",
                sa.Numeric(14, 2),
                nullable=False,
                server_default="0",
            ),
        )

    # Move the standard plan onto per-branch pricing and lift its hard branch cap:
    # additional branches are now billed rather than blocked.
    op.execute(
        sa.text(
            f"""
            UPDATE {TABLE_NAME}
               SET monthly_price = {BASE_MONTHLY_PRICE},
                   included_branches = 1,
                   additional_branch_price = {ADDITIONAL_BRANCH_PRICE},
                   max_branches = NULL
             WHERE code = 'STANDARD'
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns(TABLE_NAME)}
    if "additional_branch_price" in columns:
        op.drop_column(TABLE_NAME, "additional_branch_price")
    if "included_branches" in columns:
        op.drop_column(TABLE_NAME, "included_branches")
