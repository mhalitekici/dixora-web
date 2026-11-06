"""Add nullable city and retry fingerprint; preserve all historical orders."""

import sqlalchemy as sa

from alembic import op

revision = "0043_delivery_city_fingerprint"
down_revision = "0042_operation_grants"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("delivery_orders")
    }
    for name, length in (("city", 120), ("request_hash", 64)):
        if name not in columns:
            op.add_column("delivery_orders", sa.Column(name, sa.String(length), nullable=True))


def downgrade() -> None:
    op.drop_column("delivery_orders", "request_hash")
    op.drop_column("delivery_orders", "city")
