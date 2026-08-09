"""Add optional calorie count to products.

Revision ID: 0013_product_calories
Revises: 0012_shift_cashier_name
Create Date: 2026-08-07
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0013_product_calories"
down_revision = "0012_shift_cashier_name"
branch_labels = None
depends_on = None


def _has_calories_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == "calories" for column in inspector.get_columns("products"))


def upgrade() -> None:
    if not _has_calories_column():
        op.add_column(
            "products",
            sa.Column("calories", sa.Integer(), nullable=True),
        )


def downgrade() -> None:
    if _has_calories_column():
        op.drop_column("products", "calories")
