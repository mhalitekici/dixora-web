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


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def _foreign_keys(table: str) -> set[str]:
    return {
        foreign_key["name"]
        for foreign_key in sa.inspect(op.get_bind()).get_foreign_keys(table)
        if foreign_key["name"]
    }


def upgrade() -> None:
    inventory_columns = _columns("inventory_items")
    inventory_indexes = _indexes("inventory_items")
    with op.batch_alter_table("inventory_items") as batch:
        if "category" not in inventory_columns:
            batch.add_column(sa.Column("category", sa.String(length=80), nullable=True))
        if "target_stock" not in inventory_columns:
            batch.add_column(
                sa.Column(
                    "target_stock",
                    sa.Numeric(18, 6),
                    nullable=False,
                    server_default="0",
                )
            )
        if "ix_inventory_items_category" not in inventory_indexes:
            batch.create_index("ix_inventory_items_category", ["category"])

    if "daily_receipt_counters" not in _tables():
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
                "tenant_id",
                "branch_id",
                "business_date",
                name="uq_receipt_counter_scope_day",
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

    if "receipts" not in _tables():
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
        for column in (
            "tenant_id",
            "branch_id",
            "order_id",
            "issued_by_user_id",
            "business_date",
        ):
            op.create_index(f"ix_receipts_{column}", "receipts", [column])

    print_job_columns = _columns("print_jobs")
    print_job_foreign_keys = _foreign_keys("print_jobs")
    print_job_indexes = _indexes("print_jobs")
    with op.batch_alter_table("print_jobs") as batch:
        if "receipt_id" not in print_job_columns:
            batch.add_column(sa.Column("receipt_id", sa.Uuid(), nullable=True))
        if "fk_print_jobs_receipt_id_receipts" not in print_job_foreign_keys:
            batch.create_foreign_key(
                "fk_print_jobs_receipt_id_receipts",
                "receipts",
                ["receipt_id"],
                ["id"],
                ondelete="RESTRICT",
            )
        if "ix_print_jobs_receipt_id" not in print_job_indexes:
            batch.create_index("ix_print_jobs_receipt_id", ["receipt_id"])


def downgrade() -> None:
    if "print_jobs" in _tables():
        print_job_columns = _columns("print_jobs")
        print_job_foreign_keys = _foreign_keys("print_jobs")
        print_job_indexes = _indexes("print_jobs")
        with op.batch_alter_table("print_jobs") as batch:
            if "ix_print_jobs_receipt_id" in print_job_indexes:
                batch.drop_index("ix_print_jobs_receipt_id")
            if "fk_print_jobs_receipt_id_receipts" in print_job_foreign_keys:
                batch.drop_constraint("fk_print_jobs_receipt_id_receipts", type_="foreignkey")
            if "receipt_id" in print_job_columns:
                batch.drop_column("receipt_id")
    if "receipts" in _tables():
        op.drop_table("receipts")
    if "daily_receipt_counters" in _tables():
        op.drop_table("daily_receipt_counters")
    if "inventory_items" in _tables():
        inventory_columns = _columns("inventory_items")
        inventory_indexes = _indexes("inventory_items")
        with op.batch_alter_table("inventory_items") as batch:
            if "ix_inventory_items_category" in inventory_indexes:
                batch.drop_index("ix_inventory_items_category")
            if "target_stock" in inventory_columns:
                batch.drop_column("target_stock")
            if "category" in inventory_columns:
                batch.drop_column("category")
