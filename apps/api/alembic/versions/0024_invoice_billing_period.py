"""Give invoices a billing period, a price breakdown and a uniqueness rule.

The table existed but nothing ever wrote to it, so it carried no period and no
way to tell one month's bill from another. Without the unique constraint a
re-run of the billing job would invoice the same month twice.

Revision ID: 0024_invoice_billing_period
Revises: 0023_campaigns
Create Date: 2026-08-13
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0024_invoice_billing_period"
down_revision = "0023_campaigns"
branch_labels = None
depends_on = None

TABLE = "invoices"

NEW_COLUMNS = (
    ("paid_at", sa.Column("paid_at", sa.DateTime(), nullable=True)),
    ("period_start", sa.Column("period_start", sa.Date(), nullable=True)),
    ("period_end", sa.Column("period_end", sa.Date(), nullable=True)),
    (
        "branch_count",
        sa.Column("branch_count", sa.Integer(), nullable=False, server_default="0"),
    ),
    (
        "base_amount",
        sa.Column("base_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
    ),
    (
        "extra_branch_amount",
        sa.Column(
            "extra_branch_amount", sa.Numeric(14, 2), nullable=False, server_default="0"
        ),
    ),
    ("failure_reason", sa.Column("failure_reason", sa.String(255), nullable=True)),
    (
        "attempt_count",
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
    ),
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE not in set(inspector.get_table_names()):
        return

    existing = {column["name"] for column in inspector.get_columns(TABLE)}
    for name, column in NEW_COLUMNS:
        if name not in existing:
            op.add_column(TABLE, column)

    # The period is required going forward. Any pre-existing draft rows are
    # backfilled to the current month so the NOT NULL can be applied without
    # inventing a period that looks like a real historical bill.
    op.execute(
        sa.text(
            "UPDATE invoices SET period_start = date_trunc('month', CURRENT_DATE)::date "
            "WHERE period_start IS NULL"
        )
    )
    op.execute(
        sa.text(
            "UPDATE invoices SET period_end = "
            "(date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date "
            "WHERE period_end IS NULL"
        )
    )
    op.alter_column(TABLE, "period_start", nullable=False)
    op.alter_column(TABLE, "period_end", nullable=False)

    constraints = {c["name"] for c in inspector.get_unique_constraints(TABLE)}
    if "uq_invoice_subscription_period" not in constraints:
        op.create_unique_constraint(
            "uq_invoice_subscription_period", TABLE, ["subscription_id", "period_start"]
        )

    indexes = {i["name"] for i in inspector.get_indexes(TABLE)}
    if "ix_invoices_tenant_status" not in indexes:
        op.create_index("ix_invoices_tenant_status", TABLE, ["tenant_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_invoices_tenant_status", table_name=TABLE)
    op.drop_constraint("uq_invoice_subscription_period", TABLE, type_="unique")
    for name, _ in NEW_COLUMNS:
        op.drop_column(TABLE, name)
