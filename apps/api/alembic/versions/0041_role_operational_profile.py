"""Persist custom role operational profiles without changing existing grants."""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0041_role_operational_profile"
down_revision = "0040_command_fingerprints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("roles")}
    if "operational_profile" not in columns:
        op.add_column("roles", sa.Column("operational_profile", sa.String(24), nullable=True))


def downgrade() -> None:
    op.drop_column("roles", "operational_profile")
