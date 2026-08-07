"""Persist category presentation color.

Revision ID: 0002_category_color
Revises: 0001_initial
Create Date: 2026-07-30
"""

import sqlalchemy as sa

from alembic import op

revision = "0002_category_color"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def _has_color_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == "color" for column in inspector.get_columns("categories"))


def upgrade() -> None:
    # The bootstrap revision creates from current metadata for new installations;
    # the guard keeps this forward migration safe for both fresh and existing databases.
    if not _has_color_column():
        op.add_column(
            "categories",
            sa.Column(
                "color",
                sa.String(length=16),
                nullable=False,
                server_default="#EC5A20",
            ),
        )


def downgrade() -> None:
    if _has_color_column():
        op.drop_column("categories", "color")
