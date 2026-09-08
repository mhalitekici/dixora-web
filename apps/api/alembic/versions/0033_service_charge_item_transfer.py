"""Add branch service charges and order snapshots.

Revision ID: 0033_service_charge_transfer
Revises: 0032_print_bridge_manual_retry
Create Date: 2026-09-07
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0033_service_charge_transfer"
down_revision = "0032_print_bridge_manual_retry"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    branch_columns = _columns("branches")
    with op.batch_alter_table("branches") as batch:
        if "service_charge_enabled" not in branch_columns:
            batch.add_column(
                sa.Column(
                    "service_charge_enabled",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )
        if "service_charge_type" not in branch_columns:
            batch.add_column(
                sa.Column(
                    "service_charge_type",
                    sa.String(length=20),
                    nullable=False,
                    server_default="PERCENTAGE",
                )
            )
        if "service_charge_value" not in branch_columns:
            batch.add_column(
                sa.Column(
                    "service_charge_value", sa.Numeric(14, 2), nullable=False, server_default="0.00"
                )
            )

    order_columns = _columns("orders")
    with op.batch_alter_table("orders") as batch:
        if "service_charge_type" not in order_columns:
            batch.add_column(sa.Column("service_charge_type", sa.String(length=20), nullable=True))
        if "service_charge_value" not in order_columns:
            batch.add_column(
                sa.Column(
                    "service_charge_value", sa.Numeric(14, 2), nullable=False, server_default="0.00"
                )
            )
        if "service_charge_amount" not in order_columns:
            batch.add_column(
                sa.Column(
                    "service_charge_amount",
                    sa.Numeric(14, 2),
                    nullable=False,
                    server_default="0.00",
                )
            )


def downgrade() -> None:
    order_columns = _columns("orders")
    with op.batch_alter_table("orders") as batch:
        if "service_charge_amount" in order_columns:
            batch.drop_column("service_charge_amount")
        if "service_charge_value" in order_columns:
            batch.drop_column("service_charge_value")
        if "service_charge_type" in order_columns:
            batch.drop_column("service_charge_type")

    branch_columns = _columns("branches")
    with op.batch_alter_table("branches") as batch:
        if "service_charge_value" in branch_columns:
            batch.drop_column("service_charge_value")
        if "service_charge_type" in branch_columns:
            batch.drop_column("service_charge_type")
        if "service_charge_enabled" in branch_columns:
            batch.drop_column("service_charge_enabled")
