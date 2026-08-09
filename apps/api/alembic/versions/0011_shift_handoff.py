"""Track cashier shift handoff lineage and opening notes.

Revision ID: 0011_shift_handoff
Revises: 0010_kitchen_printing
Create Date: 2026-08-07
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0011_shift_handoff"
down_revision = "0010_kitchen_printing"
branch_labels = None
depends_on = None


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("cashier_shifts")}


def upgrade() -> None:
    # The bootstrap revision creates from current metadata for new installations;
    # the guards keep this forward migration safe for both fresh and existing databases.
    columns = _existing_columns()
    if "predecessor_shift_id" not in columns:
        op.add_column(
            "cashier_shifts",
            sa.Column("predecessor_shift_id", sa.Uuid(), nullable=True),
        )
        op.create_foreign_key(
            "fk_cashier_shifts_predecessor_shift_id_cashier_shifts",
            "cashier_shifts",
            "cashier_shifts",
            ["predecessor_shift_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index(
            "ix_cashier_shifts_predecessor_shift_id",
            "cashier_shifts",
            ["predecessor_shift_id"],
        )
    if "opening_note" not in columns:
        op.add_column(
            "cashier_shifts",
            sa.Column("opening_note", sa.String(length=500), nullable=True),
        )


def downgrade() -> None:
    columns = _existing_columns()
    if "opening_note" in columns:
        op.drop_column("cashier_shifts", "opening_note")
    if "predecessor_shift_id" in columns:
        op.drop_index("ix_cashier_shifts_predecessor_shift_id", table_name="cashier_shifts")
        op.drop_constraint(
            "fk_cashier_shifts_predecessor_shift_id_cashier_shifts",
            "cashier_shifts",
            type_="foreignkey",
        )
        op.drop_column("cashier_shifts", "predecessor_shift_id")
