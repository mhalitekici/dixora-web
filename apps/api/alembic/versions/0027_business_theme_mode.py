"""Let a business pin the colour scheme of its guest and staff screens.

Revision ID: 0027_business_theme_mode
Revises: 0026_branch_catalog_sync
Create Date: 2026-09-06
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0027_business_theme_mode"
down_revision = "0026_branch_catalog_sync"
branch_labels = None
depends_on = None

# SYSTEM is what every business did before this column existed: the QR menu and
# the staff phone screens followed the device's prefers-color-scheme. Backfilling
# anything else would silently change how existing menus look.
_DEFAULT = "SYSTEM"

# Named to match what `create_all` produces from the metadata naming convention,
# so a database upgraded through this revision and a freshly bootstrapped one end
# up with the same constraint rather than two spellings of it.
_CHECK = "ck_tenants_theme_mode"


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _check_constraints(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {
        item["name"]
        for item in inspector.get_check_constraints(table)
        if item["name"]
    }


def upgrade() -> None:
    if "theme_mode" in _columns("tenants"):
        return
    # Batch mode so SQLite gets the constraint too: it cannot ALTER one into an
    # existing table, and a plain add would leave the column unconstrained there.
    # On PostgreSQL this is the ordinary ADD COLUMN.
    with op.batch_alter_table("tenants") as batch:
        batch.add_column(
            sa.Column(
                "theme_mode",
                # The CHECK is added separately, under a predictable name; asking
                # the type for one here produces a second, differently named copy.
                sa.String(length=6),
                nullable=False,
                server_default=_DEFAULT,
            )
        )
        batch.create_check_constraint(
            _CHECK, sa.text("theme_mode IN ('LIGHT', 'DARK', 'SYSTEM')")
        )


def downgrade() -> None:
    if "theme_mode" not in _columns("tenants"):
        return
    with op.batch_alter_table("tenants") as batch:
        if _CHECK in _check_constraints("tenants"):
            batch.drop_constraint(_CHECK, type_="check")
        batch.drop_column("theme_mode")
