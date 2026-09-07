"""Keep uncertain physical print attempts out of automatic retries.

Revision ID: 0032_print_bridge_manual_retry
Revises: 0031_print_bridge_acks
Create Date: 2026-09-07
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0032_print_bridge_manual_retry"
down_revision = "0031_print_bridge_acks"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "manual_retry_required" in _columns("print_jobs"):
        return
    with op.batch_alter_table("print_jobs") as batch:
        batch.add_column(
            sa.Column(
                "manual_retry_required",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch.create_index(
            "ix_print_jobs_manual_retry_required", ["manual_retry_required"]
        )


def downgrade() -> None:
    if "manual_retry_required" not in _columns("print_jobs"):
        return
    with op.batch_alter_table("print_jobs") as batch:
        batch.drop_index("ix_print_jobs_manual_retry_required")
        batch.drop_column("manual_retry_required")
