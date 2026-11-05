"""Allow replacing retired computers without changing their history."""

import sqlalchemy as sa

from alembic import op

revision = "0044_active_bridge_names"
down_revision = "0043_delivery_city_fingerprint"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    constraints = {
        item["name"] for item in inspector.get_unique_constraints("print_bridge_clients")
    }
    if "uq_print_bridge_scope_name" in constraints:
        with op.batch_alter_table("print_bridge_clients") as batch:
            batch.drop_constraint("uq_print_bridge_scope_name", type_="unique")
    indexes = {
        item["name"] for item in sa.inspect(op.get_bind()).get_indexes("print_bridge_clients")
    }
    if "uq_print_bridge_active_name" not in indexes:
        op.create_index(
            "uq_print_bridge_active_name",
            "print_bridge_clients",
            ["tenant_id", "branch_id", "name"],
            unique=True,
            postgresql_where=sa.text("is_active"),
            sqlite_where=sa.text("is_active = 1"),
        )


def downgrade() -> None:
    # A duplicate retired name must be renamed explicitly before downgrade;
    # database constraints reject it instead of deleting historical records.
    with op.batch_alter_table("print_bridge_clients") as batch:
        batch.create_unique_constraint(
            "uq_print_bridge_scope_name", ["tenant_id", "branch_id", "name"]
        )
    op.drop_index("uq_print_bridge_active_name", table_name="print_bridge_clients")
