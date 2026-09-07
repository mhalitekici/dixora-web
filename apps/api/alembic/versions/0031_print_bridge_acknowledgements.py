"""Persist bridge acknowledgements and physical print results.

Revision ID: 0031_print_bridge_acks
Revises: 0030_print_bridge_mappings
Create Date: 2026-09-07
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0031_print_bridge_acks"
down_revision = "0030_print_bridge_mappings"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    job_columns = _columns("print_jobs")
    if "print_result" not in job_columns:
        with op.batch_alter_table("print_jobs") as batch:
            batch.add_column(sa.Column("print_result", sa.JSON(), nullable=True))

    if "print_job_acknowledgements" in _tables():
        return
    op.create_table(
        "print_job_acknowledgements",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column(
            "tenant_id",
            sa.Uuid(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "branch_id",
            sa.Uuid(),
            sa.ForeignKey("branches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "print_job_id",
            sa.Uuid(),
            sa.ForeignKey("print_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "bridge_id",
            sa.Uuid(),
            sa.ForeignKey("print_bridge_clients.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("idempotency_key", sa.String(length=200), nullable=False),
        sa.UniqueConstraint(
            "tenant_id", "idempotency_key", name="uq_print_job_ack_idempotency"
        ),
        sa.UniqueConstraint(
            "print_job_id",
            "bridge_id",
            "attempt_count",
            "status",
            name="uq_print_job_ack_attempt_status",
        ),
    )
    for column in ("tenant_id", "branch_id", "print_job_id", "bridge_id"):
        op.create_index(
            f"ix_print_job_acknowledgements_{column}",
            "print_job_acknowledgements",
            [column],
        )


def downgrade() -> None:
    if "print_job_acknowledgements" in _tables():
        op.drop_table("print_job_acknowledgements")
    job_columns = _columns("print_jobs")
    if "print_result" in job_columns:
        with op.batch_alter_table("print_jobs") as batch:
            batch.drop_column("print_result")
