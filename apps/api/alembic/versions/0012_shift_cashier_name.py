"""Capture the physical cashier's typed name on shift open/handoff.

Revision ID: 0012_shift_cashier_name
Revises: 0011_shift_handoff
Create Date: 2026-08-07
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0012_shift_cashier_name"
down_revision = "0011_shift_handoff"
branch_labels = None
depends_on = None


def _has_cashier_name_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(
        column["name"] == "cashier_name" for column in inspector.get_columns("cashier_shifts")
    )


def upgrade() -> None:
    if not _has_cashier_name_column():
        op.add_column(
            "cashier_shifts",
            sa.Column("cashier_name", sa.String(length=120), nullable=True),
        )


def downgrade() -> None:
    if _has_cashier_name_column():
        op.drop_column("cashier_shifts", "cashier_name")
