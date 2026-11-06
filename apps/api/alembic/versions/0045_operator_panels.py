"""Separate manager operation sessions from observation grants."""

import sqlalchemy as sa

from alembic import op

revision = "0045_operator_panels"
down_revision = "0044_active_bridge_names"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "mode" not in {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("operation_grants")
    }:
        op.add_column(
            "operation_grants",
            sa.Column("mode", sa.String(12), nullable=False, server_default="support"),
        )
    op.drop_index("uq_cashier_shift_open_actor", table_name="cashier_shifts")
    op.create_index(
        "uq_cashier_shift_open_actor",
        "cashier_shifts",
        ["tenant_id", "branch_id", "opened_by_user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'OPEN' AND opened_by_user_id <> user_id"),
        sqlite_where=sa.text("status = 'OPEN' AND opened_by_user_id <> user_id"),
    )


def downgrade() -> None:
    # Refuse downgrade if existing personal/hosted shifts conflict; never close
    # or reassign historical shifts to make a constraint fit.
    op.drop_index("uq_cashier_shift_open_actor", table_name="cashier_shifts")
    op.create_index(
        "uq_cashier_shift_open_actor",
        "cashier_shifts",
        ["tenant_id", "branch_id", "opened_by_user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'OPEN'"),
        sqlite_where=sa.text("status = 'OPEN'"),
    )
    op.drop_column("operation_grants", "mode")
