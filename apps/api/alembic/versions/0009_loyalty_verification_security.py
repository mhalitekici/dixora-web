"""Persist one-time loyalty verification challenges and atomic rate limits.

Revision ID: 0009_loyalty_verify_security
Revises: 0008_trusted_devices
Create Date: 2026-08-04
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0009_loyalty_verify_security"
down_revision = "0008_trusted_devices"
branch_labels = None
depends_on = None

CHALLENGE_TABLE = "loyalty_verification_challenges"
RATE_LIMIT_TABLE = "loyalty_verification_rate_limits"


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if CHALLENGE_TABLE not in tables:
        op.create_table(
            CHALLENGE_TABLE,
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("branch_id", sa.Uuid(), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("phone_hash", sa.String(length=64), nullable=False),
            sa.Column("request_ip_hash", sa.String(length=64), nullable=True),
            sa.Column("mode", sa.String(length=20), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("consumed_at", sa.DateTime(), nullable=True),
            sa.Column("failed_attempts", sa.Integer(), server_default="0", nullable=False),
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
            sa.CheckConstraint(
                "failed_attempts >= 0",
                name="ck_loyalty_verification_challenges_failed_attempts_nonnegative",
            ),
            sa.ForeignKeyConstraint(
                ["branch_id"],
                ["branches.id"],
                name="fk_loyalty_verification_challenges_branch_id_branches",
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["tenant_id"],
                ["tenants.id"],
                name="fk_loyalty_verification_challenges_tenant_id_tenants",
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id", name="pk_loyalty_verification_challenges"),
            sa.UniqueConstraint(
                "token_hash", name="uq_loyalty_verification_challenges_token_hash"
            ),
        )
        op.create_index(
            "ix_loyalty_verification_challenge_tenant_branch_expires",
            CHALLENGE_TABLE,
            ["tenant_id", "branch_id", "expires_at"],
        )
        op.create_index(
            "ix_loyalty_verification_challenges_branch_id", CHALLENGE_TABLE, ["branch_id"]
        )
        op.create_index(
            "ix_loyalty_verification_challenges_expires_at", CHALLENGE_TABLE, ["expires_at"]
        )
        op.create_index(
            "ix_loyalty_verification_challenges_tenant_id", CHALLENGE_TABLE, ["tenant_id"]
        )

    if RATE_LIMIT_TABLE not in tables:
        op.create_table(
            RATE_LIMIT_TABLE,
            sa.Column("scope_hash", sa.String(length=64), nullable=False),
            sa.Column("bucket_start", sa.DateTime(), nullable=False),
            sa.Column("attempts", sa.Integer(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.CheckConstraint(
                "attempts > 0",
                name="ck_loyalty_verification_rate_limits_attempts_positive",
            ),
            sa.PrimaryKeyConstraint(
                "scope_hash", "bucket_start", name="pk_loyalty_verification_rate_limits"
            ),
        )
        op.create_index(
            "ix_loyalty_verification_rate_limits_expires_at", RATE_LIMIT_TABLE, ["expires_at"]
        )


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if RATE_LIMIT_TABLE in tables:
        op.drop_table(RATE_LIMIT_TABLE)
    if CHALLENGE_TABLE in tables:
        op.drop_table(CHALLENGE_TABLE)
