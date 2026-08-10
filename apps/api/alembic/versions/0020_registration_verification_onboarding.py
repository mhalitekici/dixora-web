"""Email-verified business signup and the post-signup questionnaire.

Signing up now proves the owner's email before anything is provisioned, and the
answers we collect straight afterwards (delivery marketplaces in particular)
drive which integrations get built next.

Revision ID: 0020_registration_onboarding
Revises: 0019_table_guest_label
Create Date: 2026-08-09
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0020_registration_onboarding"
down_revision = "0019_table_guest_label"
branch_labels = None
depends_on = None

VERIFICATIONS = "business_registration_verifications"
ONBOARDING = "tenant_onboarding"


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    if VERIFICATIONS not in tables:
        op.create_table(
            VERIFICATIONS,
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("business_name", sa.String(140), nullable=False),
            sa.Column("business_type", sa.String(50), nullable=False),
            sa.Column("owner_name", sa.String(160), nullable=False),
            sa.Column("email", sa.String(255), nullable=False),
            sa.Column("phone", sa.String(32), nullable=False),
            sa.Column("password_hash", sa.String(512), nullable=False),
            sa.Column("contract_version", sa.String(40), nullable=False),
            sa.Column("code_hash", sa.String(64), nullable=False),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("ip_address", sa.String(64), nullable=True),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("consumed_at", sa.DateTime(), nullable=True),
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
            sa.PrimaryKeyConstraint("id", name=f"pk_{VERIFICATIONS}"),
        )
        op.create_index(f"ix_{VERIFICATIONS}_email", VERIFICATIONS, ["email"])
        op.create_index(f"ix_{VERIFICATIONS}_expires_at", VERIFICATIONS, ["expires_at"])
        op.create_index(
            "ix_business_registration_email", VERIFICATIONS, ["email", "consumed_at"]
        )

    if ONBOARDING not in tables:
        op.create_table(
            ONBOARDING,
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("offers_delivery", sa.Boolean(), nullable=True),
            sa.Column("delivery_platforms", sa.JSON(), nullable=False),
            sa.Column("monthly_order_volume", sa.String(40), nullable=True),
            sa.Column("table_count", sa.Integer(), nullable=True),
            sa.Column("heard_from", sa.String(60), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
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
                name=f"fk_{ONBOARDING}_tenant",
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id", name=f"pk_{ONBOARDING}"),
            sa.UniqueConstraint("tenant_id", name="uq_tenant_onboarding_tenant"),
        )
        op.create_index(f"ix_{ONBOARDING}_tenant_id", ONBOARDING, ["tenant_id"])


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if ONBOARDING in tables:
        op.drop_table(ONBOARDING)
    if VERIFICATIONS in tables:
        op.drop_table(VERIFICATIONS)
