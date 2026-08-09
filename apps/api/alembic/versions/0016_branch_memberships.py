"""Multi-branch memberships and branch archival.

Adds `user_branch_memberships` so one user (typically a regional manager) can
operate across several branches without being granted business-wide access, and
`branches.archived_at` so a retired location keeps all of its history instead of
being deleted.

Backfill is deliberately conservative: users already pinned to a branch get a
single membership row for exactly that branch, which reproduces their current
access precisely. Users with no primary branch already span the whole business
and intentionally get no rows.

Revision ID: 0016_branch_memberships
Revises: 0015_content_translations
Create Date: 2026-08-09
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0016_branch_memberships"
down_revision = "0015_content_translations"
branch_labels = None
depends_on = None

TABLE_NAME = "user_branch_memberships"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    branch_columns = {column["name"] for column in inspector.get_columns("branches")}
    if "archived_at" not in branch_columns:
        op.add_column("branches", sa.Column("archived_at", sa.DateTime(), nullable=True))

    if TABLE_NAME in inspector.get_table_names():
        return

    op.create_table(
        TABLE_NAME,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
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
            ["tenant_id"],
            ["tenants.id"],
            name="fk_user_branch_memberships_tenant_id_tenants",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_user_branch_memberships_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["branch_id"],
            ["branches.id"],
            name="fk_user_branch_memberships_branch_id_branches",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_user_branch_memberships"),
        sa.UniqueConstraint("user_id", "branch_id", name="uq_user_branch_membership"),
    )
    op.create_index("ix_user_branch_memberships_tenant_id", TABLE_NAME, ["tenant_id"])
    op.create_index("ix_user_branch_memberships_user_id", TABLE_NAME, ["user_id"])
    op.create_index("ix_user_branch_memberships_branch_id", TABLE_NAME, ["branch_id"])
    op.create_index(
        "ix_user_branch_memberships_user_active", TABLE_NAME, ["user_id", "is_active"]
    )

    # Backfill: mirror each user's existing primary branch as a membership row.
    # The join guarantees we never assign a branch from a different tenant.
    if bind.dialect.name == "postgresql":
        new_id = "gen_random_uuid()"
    else:
        new_id = "lower(hex(randomblob(16)))"
    op.execute(
        sa.text(
            f"""
            INSERT INTO {TABLE_NAME} (id, tenant_id, user_id, branch_id, is_active)
            SELECT {new_id}, u.tenant_id, u.id, u.branch_id, true
            FROM users u
            JOIN branches b
              ON b.id = u.branch_id
             AND b.tenant_id = u.tenant_id
            WHERE u.branch_id IS NOT NULL
              AND u.tenant_id IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE_NAME in inspector.get_table_names():
        op.drop_table(TABLE_NAME)
    branch_columns = {column["name"] for column in inspector.get_columns("branches")}
    if "archived_at" in branch_columns:
        op.drop_column("branches", "archived_at")
