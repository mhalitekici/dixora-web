"""Free-text guest label on a dining table.

Lets the floor show "B1 · Ahmet" so staff can find a party at a glance.

Revision ID: 0019_table_guest_label
Revises: 0018_loyalty_email_enrollment
Create Date: 2026-08-09
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0019_table_guest_label"
down_revision = "0018_loyalty_email_enrollment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {c["name"] for c in sa.inspect(bind).get_columns("dining_tables")}
    if "guest_label" not in columns:
        op.add_column("dining_tables", sa.Column("guest_label", sa.String(60), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {c["name"] for c in sa.inspect(bind).get_columns("dining_tables")}
    if "guest_label" in columns:
        op.drop_column("dining_tables", "guest_label")
