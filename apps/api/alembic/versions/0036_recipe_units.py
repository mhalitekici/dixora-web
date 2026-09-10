"""Store the unit used by each recipe ingredient.

Revision ID: 0036_recipe_units
Revises: 0035_stock_receipts
Create Date: 2026-09-10
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0036_recipe_units"
down_revision = "0035_stock_receipts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("product_recipe_items") as batch:
        batch.add_column(sa.Column("unit", sa.String(length=20), nullable=True))
    if op.get_bind().dialect.name == "sqlite":
        op.execute(
            """
            UPDATE product_recipe_items
            SET unit = (
                SELECT inventory_items.unit
                FROM inventory_items
                WHERE inventory_items.id = product_recipe_items.inventory_item_id
            )
            """
        )
    else:
        op.execute(
            """
            UPDATE product_recipe_items
            SET unit = inventory_items.unit
            FROM inventory_items
            WHERE inventory_items.id = product_recipe_items.inventory_item_id
            """
        )
    with op.batch_alter_table("product_recipe_items") as batch:
        batch.alter_column("unit", existing_type=sa.String(length=20), nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("product_recipe_items") as batch:
        batch.drop_column("unit")
