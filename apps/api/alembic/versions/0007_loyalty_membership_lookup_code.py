"""Separate private membership lookup codes from shareable referral codes.

Revision ID: 0007_loyalty_lookup
Revises: 0006_management
Create Date: 2026-08-03
"""

from __future__ import annotations

import secrets

import sqlalchemy as sa

from alembic import op

revision = "0007_loyalty_lookup"
down_revision = "0006_management"
branch_labels = None
depends_on = None

TABLE_NAME = "loyalty_memberships"
CONSTRAINT_NAME = "uq_loyalty_membership_lookup_code"


def _new_lookup_code() -> str:
    value = secrets.token_urlsafe(12).replace("-", "").replace("_", "").upper()
    return f"MB-{value[:16]}"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE_NAME not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns(TABLE_NAME)}
    if "lookup_code" not in columns:
        op.add_column(
            TABLE_NAME,
            sa.Column("lookup_code", sa.String(length=32), nullable=True),
        )

        rows = bind.execute(
            sa.text(f"SELECT id, tenant_id FROM {TABLE_NAME}")
        ).mappings()
        generated: dict[object, set[str]] = {}
        for row in rows:
            tenant_codes = generated.setdefault(row["tenant_id"], set())
            code = _new_lookup_code()
            while code in tenant_codes:
                code = _new_lookup_code()
            tenant_codes.add(code)
            bind.execute(
                sa.text(
                    f"UPDATE {TABLE_NAME} SET lookup_code = :code WHERE id = :id"
                ),
                {"code": code, "id": row["id"]},
            )

        op.alter_column(
            TABLE_NAME,
            "lookup_code",
            existing_type=sa.String(length=32),
            nullable=False,
        )

    inspector = sa.inspect(bind)
    constraints = {
        constraint["name"]
        for constraint in inspector.get_unique_constraints(TABLE_NAME)
    }
    if CONSTRAINT_NAME not in constraints:
        op.create_unique_constraint(
            CONSTRAINT_NAME,
            TABLE_NAME,
            ["tenant_id", "lookup_code"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE_NAME not in inspector.get_table_names():
        return

    constraints = {
        constraint["name"]
        for constraint in inspector.get_unique_constraints(TABLE_NAME)
    }
    if CONSTRAINT_NAME in constraints:
        op.drop_constraint(CONSTRAINT_NAME, TABLE_NAME, type_="unique")

    columns = {column["name"] for column in sa.inspect(bind).get_columns(TABLE_NAME)}
    if "lookup_code" in columns:
        op.drop_column(TABLE_NAME, "lookup_code")
