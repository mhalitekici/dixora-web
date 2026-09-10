"""Add operational stock fields and daily branch receipts.

Revision ID: 0035_stock_receipts
Revises: 0034_cashier_printer_comp
Create Date: 2026-09-09
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0035_stock_receipts"
down_revision = "0034_cashier_printer_comp"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("inventory_items") as batch:
        batch.add_column(sa.Column("category", sa.String(length=80), nullable=True))
        batch.add_column(
            sa.Column(
                "target_stock",
                sa.Numeric(18, 6),
                nullable=False,
                server_default="0",
            )
        )
        batch.create_index("ix_inventory_items_category", ["category"])

    op.create_table(
        "daily_receipt_counters",
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("business_date", sa.Date(), nullable=False),
        sa.Column("last_number", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id", "branch_id", "business_date", name="uq_receipt_counter_scope_day"
        ),
    )
    op.create_index(
        "ix_daily_receipt_counters_tenant_id", "daily_receipt_counters", ["tenant_id"]
    )
    op.create_index(
        "ix_daily_receipt_counters_branch_id", "daily_receipt_counters", ["branch_id"]
    )
    op.create_index(
        "ix_daily_receipt_counters_business_date",
        "daily_receipt_counters",
        ["business_date"],
    )

    op.create_table(
        "receipts",
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("issued_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("business_date", sa.Date(), nullable=False),
        sa.Column("daily_number", sa.Integer(), nullable=False),
        sa.Column("issued_at", sa.DateTime(), nullable=False),
        sa.Column("reprint_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["issued_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "order_id", name="uq_receipt_tenant_order"),
        sa.UniqueConstraint(
            "tenant_id",
            "branch_id",
            "business_date",
            "daily_number",
            name="uq_receipt_scope_day_number",
        ),
    )
    for column in ("tenant_id", "branch_id", "order_id", "issued_by_user_id", "business_date"):
        op.create_index(f"ix_receipts_{column}", "receipts", [column])

    with op.batch_alter_table("print_jobs") as batch:
        batch.add_column(sa.Column("receipt_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key(
            "fk_print_jobs_receipt_id_receipts",
            "receipts",
            ["receipt_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch.create_index("ix_print_jobs_receipt_id", ["receipt_id"])


def downgrade() -> None:
    with op.batch_alter_table("print_jobs") as batch:
        batch.drop_index("ix_print_jobs_receipt_id")
        batch.drop_constraint("fk_print_jobs_receipt_id_receipts", type_="foreignkey")
        batch.drop_column("receipt_id")
    op.drop_table("receipts")
    op.drop_table("daily_receipt_counters")
    with op.batch_alter_table("inventory_items") as batch:
        batch.drop_index("ix_inventory_items_category")
        batch.drop_column("target_stock")
        batch.drop_column("category")
