"""Cashier-led, email-verified loyalty enrolment.

Loyalty membership moves from "customer self-enrols from the QR menu with a
phone number and an SMS code" to "a cashier enrols the customer at the till,
the customer confirms a code sent to their email, and receives a membership
card code by email".

Existing phone-enrolled customers keep working: `phone_normalized` becomes
nullable rather than being dropped, and no rows are deleted.

Revision ID: 0018_loyalty_email_enrollment
Revises: 0017_branch_based_pricing
Create Date: 2026-08-09
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0018_loyalty_email_enrollment"
down_revision = "0017_branch_based_pricing"
branch_labels = None
depends_on = None

TABLE_NAME = "loyalty_email_verifications"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    customer_columns = {c["name"] for c in inspector.get_columns("loyalty_customers")}
    if "email_normalized" not in customer_columns:
        op.add_column(
            "loyalty_customers", sa.Column("email_normalized", sa.String(255), nullable=True)
        )
    if "first_name" not in customer_columns:
        op.add_column("loyalty_customers", sa.Column("first_name", sa.String(80), nullable=True))
    if "last_name" not in customer_columns:
        op.add_column("loyalty_customers", sa.Column("last_name", sa.String(80), nullable=True))
    if "birth_date" not in customer_columns:
        op.add_column("loyalty_customers", sa.Column("birth_date", sa.Date(), nullable=True))

    # Phone is no longer collected, so it must be allowed to be absent. SQLite
    # cannot alter a column in place; it is only used by the test suite, which
    # builds its schema from the models rather than from migrations.
    if bind.dialect.name != "sqlite":
        op.alter_column(
            "loyalty_customers",
            "phone_normalized",
            existing_type=sa.String(32),
            nullable=True,
        )

    existing_constraints = {
        c["name"] for c in inspector.get_unique_constraints("loyalty_customers")
    }
    if "uq_loyalty_customer_email" not in existing_constraints:
        op.create_unique_constraint(
            "uq_loyalty_customer_email",
            "loyalty_customers",
            ["tenant_id", "email_normalized"],
        )

    if TABLE_NAME in inspector.get_table_names():
        return

    op.create_table(
        TABLE_NAME,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("program_id", sa.Uuid(), nullable=False),
        sa.Column("started_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("email_normalized", sa.String(255), nullable=False),
        sa.Column("first_name", sa.String(80), nullable=False),
        sa.Column("last_name", sa.String(80), nullable=False),
        sa.Column("birth_date", sa.Date(), nullable=True),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenants.id"], name=f"fk_{TABLE_NAME}_tenant", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["branch_id"], ["branches.id"], name=f"fk_{TABLE_NAME}_branch", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["program_id"],
            ["loyalty_programs.id"],
            name=f"fk_{TABLE_NAME}_program",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["started_by_user_id"],
            ["users.id"],
            name=f"fk_{TABLE_NAME}_user",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=f"pk_{TABLE_NAME}"),
    )
    op.create_index(f"ix_{TABLE_NAME}_tenant_id", TABLE_NAME, ["tenant_id"])
    op.create_index(f"ix_{TABLE_NAME}_branch_id", TABLE_NAME, ["branch_id"])
    op.create_index(f"ix_{TABLE_NAME}_program_id", TABLE_NAME, ["program_id"])
    op.create_index(f"ix_{TABLE_NAME}_expires_at", TABLE_NAME, ["expires_at"])
    op.create_index(
        "ix_loyalty_email_verification_lookup",
        TABLE_NAME,
        ["tenant_id", "email_normalized", "consumed_at"],
    )

    # Loyalty is no longer offered through the public QR menu.
    op.execute(sa.text("UPDATE loyalty_programs SET show_on_qr = false"))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE_NAME in inspector.get_table_names():
        op.drop_table(TABLE_NAME)
    constraints = {c["name"] for c in inspector.get_unique_constraints("loyalty_customers")}
    if "uq_loyalty_customer_email" in constraints:
        op.drop_constraint("uq_loyalty_customer_email", "loyalty_customers", type_="unique")
    columns = {c["name"] for c in inspector.get_columns("loyalty_customers")}
    for name in ("birth_date", "last_name", "first_name", "email_normalized"):
        if name in columns:
            op.drop_column("loyalty_customers", name)
