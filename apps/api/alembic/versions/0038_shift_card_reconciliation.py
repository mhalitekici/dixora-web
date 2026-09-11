"""Add manual card reconciliation to cashier shifts.

Revision ID: 0038_shift_card_reconciliation
Revises: 0037_cashier_reconciliation
Create Date: 2026-09-10
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0038_shift_card_reconciliation"
down_revision = "0037_cashier_reconciliation"
branch_labels = None
depends_on = None


def _columns() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns("cashier_shifts")}


def upgrade() -> None:
    columns = _columns()
    with op.batch_alter_table("cashier_shifts") as batch:
        if "reported_card_total" not in columns:
            batch.add_column(sa.Column("reported_card_total", sa.Numeric(14, 2), nullable=True))
        if "card_variance" not in columns:
            batch.add_column(sa.Column("card_variance", sa.Numeric(14, 2), nullable=True))


def downgrade() -> None:
    columns = _columns()
    with op.batch_alter_table("cashier_shifts") as batch:
        if "card_variance" in columns:
            batch.drop_column("card_variance")
        if "reported_card_total" in columns:
            batch.drop_column("reported_card_total")
