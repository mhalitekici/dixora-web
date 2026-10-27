"""Add nullable request fingerprints without rewriting historical records."""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0040_command_fingerprints"
down_revision = "0039_loyalty_email_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("orders", "print_jobs", "qr_order_requests"):
        columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}
        if "request_hash" not in columns:
            op.add_column(table, sa.Column("request_hash", sa.String(64), nullable=True))


def downgrade() -> None:
    for table in ("qr_order_requests", "print_jobs", "orders"):
        op.drop_column(table, "request_hash")
