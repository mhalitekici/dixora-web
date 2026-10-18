"""Add campaign and loyalty reward email notification outbox.

Revision ID: 0039_loyalty_email_notifications
Revises: 0038_shift_card_reconciliation
Create Date: 2026-09-11
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0039_loyalty_email_notifications"
down_revision = "0038_shift_card_reconciliation"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    with op.batch_alter_table("loyalty_customers") as batch:
        if "marketing_email_consent" not in _columns("loyalty_customers"):
            batch.add_column(
                sa.Column(
                    "marketing_email_consent",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )
    with op.batch_alter_table("loyalty_email_verifications") as batch:
        if "marketing_email_consent" not in _columns("loyalty_email_verifications"):
            batch.add_column(
                sa.Column(
                    "marketing_email_consent",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )
    reward_columns = _columns("loyalty_rewards")
    with op.batch_alter_table("loyalty_rewards") as batch:
        if "verification_failed_attempts" not in reward_columns:
            batch.add_column(
                sa.Column(
                    "verification_failed_attempts",
                    sa.Integer(),
                    nullable=False,
                    server_default="0",
                )
            )
        if "verification_locked_until" not in reward_columns:
            batch.add_column(sa.Column("verification_locked_until", sa.DateTime(), nullable=True))
    campaign_columns = _columns("campaigns")
    with op.batch_alter_table("campaigns") as batch:
        if "notify_loyalty_members" not in campaign_columns:
            batch.add_column(
                sa.Column(
                    "notify_loyalty_members",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.true(),
                )
            )
        if "activation_version" not in campaign_columns:
            batch.add_column(
                sa.Column(
                    "activation_version",
                    sa.Integer(),
                    nullable=False,
                    server_default="0",
                )
            )

    if "email_notifications" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "email_notifications",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("notification_type", sa.String(48), nullable=False),
            sa.Column("customer_id", sa.Uuid(), nullable=False),
            sa.Column("campaign_id", sa.Uuid(), nullable=True),
            sa.Column("reward_id", sa.Uuid(), nullable=True),
            sa.Column("recipient_email", sa.String(255), nullable=False),
            sa.Column("status", sa.String(16), nullable=False, server_default="PENDING"),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("sent_at", sa.DateTime(), nullable=True),
            sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
            sa.Column("idempotency_key", sa.String(200), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.CheckConstraint("attempts >= 0", name="email_notification_attempts_nonnegative"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["customer_id"], ["loyalty_customers.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["reward_id"], ["loyalty_rewards.id"], ondelete="RESTRICT"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "idempotency_key", name="uq_email_notification_key"),
        )
        op.create_index(
            "ix_email_notification_delivery",
            "email_notifications",
            ["status", "next_attempt_at", "created_at"],
        )
        op.create_index(
            "ix_email_notification_campaign", "email_notifications", ["tenant_id", "campaign_id"]
        )
        op.create_index(
            "ix_email_notification_reward", "email_notifications", ["tenant_id", "reward_id"]
        )
        op.create_index("ix_email_notifications_tenant_id", "email_notifications", ["tenant_id"])
        op.create_index(
            "ix_email_notifications_customer_id", "email_notifications", ["customer_id"]
        )


def downgrade() -> None:
    if "email_notifications" in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table("email_notifications")
    reward_columns = _columns("loyalty_rewards")
    with op.batch_alter_table("loyalty_rewards") as batch:
        if "verification_locked_until" in reward_columns:
            batch.drop_column("verification_locked_until")
        if "verification_failed_attempts" in reward_columns:
            batch.drop_column("verification_failed_attempts")
    campaign_columns = _columns("campaigns")
    with op.batch_alter_table("campaigns") as batch:
        if "activation_version" in campaign_columns:
            batch.drop_column("activation_version")
        if "notify_loyalty_members" in campaign_columns:
            batch.drop_column("notify_loyalty_members")
    verification_columns = _columns("loyalty_email_verifications")
    with op.batch_alter_table("loyalty_email_verifications") as batch:
        if "marketing_email_consent" in verification_columns:
            batch.drop_column("marketing_email_consent")
    customer_columns = _columns("loyalty_customers")
    with op.batch_alter_table("loyalty_customers") as batch:
        if "marketing_email_consent" in customer_columns:
            batch.drop_column("marketing_email_consent")
