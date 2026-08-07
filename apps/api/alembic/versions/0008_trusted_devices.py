"""Add branch-scoped trusted-device credentials for PIN login.

Revision ID: 0008_trusted_devices
Revises: 0007_loyalty_lookup
Create Date: 2026-08-04
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0008_trusted_devices"
down_revision = "0007_loyalty_lookup"
branch_labels = None
depends_on = None

TABLE_NAME = "trusted_devices"


def upgrade() -> None:
    bind = op.get_bind()
    if TABLE_NAME in sa.inspect(bind).get_table_names():
        return

    op.create_table(
        TABLE_NAME,
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("credential_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("last_ip_address", sa.String(length=64), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
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
            ["branch_id"],
            ["branches.id"],
            name="fk_trusted_devices_branch_id_branches",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name="fk_trusted_devices_created_by_user_id_users",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_trusted_devices_tenant_id_tenants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_trusted_devices"),
        sa.UniqueConstraint(
            "credential_hash",
            name="uq_trusted_devices_credential_hash",
        ),
    )
    op.create_index(
        "ix_trusted_devices_branch_id",
        TABLE_NAME,
        ["branch_id"],
        unique=False,
    )
    op.create_index(
        "ix_trusted_devices_created_by_user_id",
        TABLE_NAME,
        ["created_by_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_trusted_devices_expires_at",
        TABLE_NAME,
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_trusted_devices_tenant_branch_expires",
        TABLE_NAME,
        ["tenant_id", "branch_id", "expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_trusted_devices_tenant_id",
        TABLE_NAME,
        ["tenant_id"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()
    if TABLE_NAME not in sa.inspect(bind).get_table_names():
        return
    op.drop_table(TABLE_NAME)
