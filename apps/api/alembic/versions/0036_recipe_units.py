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


def _columns(table: str) -> dict[str, dict[str, object]]:
    return {column["name"]: column for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    columns = _columns("product_recipe_items")
    unit_column = columns.get("unit")
    if unit_column is None:
        with op.batch_alter_table("product_recipe_items") as batch:
            batch.add_column(sa.Column("unit", sa.String(length=20), nullable=True))

    if unit_column is None or unit_column["nullable"]:
        if op.get_bind().dialect.name == "sqlite":
            op.execute(
                """
                UPDATE product_recipe_items
                SET unit = (
                    SELECT inventory_items.unit
                    FROM inventory_items
                    WHERE inventory_items.id = product_recipe_items.inventory_item_id
                )
                WHERE unit IS NULL
                """
            )
        else:
            op.execute(
                """
                UPDATE product_recipe_items
                SET unit = inventory_items.unit
                FROM inventory_items
                WHERE inventory_items.id = product_recipe_items.inventory_item_id
                  AND product_recipe_items.unit IS NULL
                """
            )
        with op.batch_alter_table("product_recipe_items") as batch:
            batch.alter_column("unit", existing_type=sa.String(length=20), nullable=False)


def downgrade() -> None:
    if "unit" in _columns("product_recipe_items"):
        with op.batch_alter_table("product_recipe_items") as batch:
            batch.drop_column("unit")
