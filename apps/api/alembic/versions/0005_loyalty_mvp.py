"""Add the tenant-scoped loyalty MVP ledger and redemption domain.

Revision ID: 0005_loyalty_mvp
Revises: 0004_remove_legacy_seed
Create Date: 2026-08-03
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0005_loyalty_mvp"
down_revision = "0004_remove_legacy_seed"
branch_labels = None
depends_on = None

LOYALTY_TABLES = (
    "loyalty_programs",
    "loyalty_program_branches",
    "loyalty_rules",
    "loyalty_customers",
    "loyalty_memberships",
    "loyalty_ledger_entries",
    "loyalty_rewards",
    "loyalty_redemptions",
)

campaign_type = sa.Enum(
    "VISIT_COUNT", "PRODUCT_QUANTITY", name="loyalty_campaign_type"
)
ledger_entry_type = sa.Enum("ACCRUAL", "REVERSAL", name="loyalty_ledger_entry_type")
reward_status = sa.Enum(
    "AVAILABLE", "REDEEMED", "REVERSED", name="loyalty_reward_status"
)
redemption_status = sa.Enum(
    "APPLIED", "REVERSED", name="loyalty_redemption_status"
)


def _id_and_timestamps() -> list[sa.Column[object]]:
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def _columns(table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(table_name)}


def _indexes(table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    existing_tables = set(sa.inspect(bind).get_table_names())
    if "loyalty_programs" not in existing_tables:
        _create_loyalty_tables()

    if "loyalty_membership_id" not in _columns("orders"):
        op.add_column(
            "orders",
            sa.Column(
                "loyalty_membership_id",
                sa.Uuid(),
                sa.ForeignKey("loyalty_memberships.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
    if "ix_orders_loyalty_membership_id" not in _indexes("orders"):
        op.create_index(
            "ix_orders_loyalty_membership_id", "orders", ["loyalty_membership_id"]
        )

    if "loyalty_membership_id" not in _columns("qr_order_requests"):
        op.add_column(
            "qr_order_requests",
            sa.Column(
                "loyalty_membership_id",
                sa.Uuid(),
                sa.ForeignKey("loyalty_memberships.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
    if "ix_qr_order_requests_loyalty_membership_id" not in _indexes(
        "qr_order_requests"
    ):
        op.create_index(
            "ix_qr_order_requests_loyalty_membership_id",
            "qr_order_requests",
            ["loyalty_membership_id"],
        )


def _create_loyalty_tables() -> None:
    op.create_table(
        "loyalty_programs",
        *_id_and_timestamps(),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("show_on_qr", sa.Boolean(), nullable=False),
        sa.Column("starts_at", sa.DateTime(), nullable=True),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_loyalty_program_tenant_name"),
    )
    op.create_table(
        "loyalty_program_branches",
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("program_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["program_id"], ["loyalty_programs.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("program_id", "branch_id"),
    )
    op.create_table(
        "loyalty_rules",
        *_id_and_timestamps(),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("program_id", sa.Uuid(), nullable=False),
        sa.Column("campaign_type", campaign_type, nullable=False),
        sa.Column("threshold", sa.Integer(), nullable=False),
        sa.Column("qualifying_product_id", sa.Uuid(), nullable=True),
        sa.Column("qualifying_category_id", sa.Uuid(), nullable=True),
        sa.Column("reward_product_id", sa.Uuid(), nullable=True),
        sa.Column("reward_category_id", sa.Uuid(), nullable=True),
        sa.Column("minimum_order_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("allow_multiple_same_day", sa.Boolean(), nullable=False),
        sa.Column("reward_same_order", sa.Boolean(), nullable=False),
        sa.CheckConstraint("threshold > 0", name="loyalty_rule_threshold_positive"),
        sa.CheckConstraint(
            "minimum_order_amount >= 0", name="loyalty_rule_minimum_order_nonnegative"
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["program_id"], ["loyalty_programs.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["qualifying_product_id"], ["products.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["qualifying_category_id"], ["categories.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["reward_product_id"], ["products.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["reward_category_id"], ["categories.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("program_id", name="uq_loyalty_rule_program"),
    )
    op.create_table(
        "loyalty_customers",
        *_id_and_timestamps(),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("phone_normalized", sa.String(length=32), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id", "phone_normalized", name="uq_loyalty_customer_phone"
        ),
    )
    op.create_table(
        "loyalty_memberships",
        *_id_and_timestamps(),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("program_id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("public_token_hash", sa.String(length=64), nullable=False),
        sa.Column("referral_code", sa.String(length=32), nullable=False),
        sa.Column("referred_by_membership_id", sa.Uuid(), nullable=True),
        sa.Column("consent_at", sa.DateTime(), nullable=False),
        sa.Column("consent_text_version", sa.String(length=40), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["program_id"], ["loyalty_programs.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["customer_id"], ["loyalty_customers.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["referred_by_membership_id"],
            ["loyalty_memberships.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id",
            "program_id",
            "customer_id",
            name="uq_loyalty_membership_customer_program",
        ),
        sa.UniqueConstraint(
            "tenant_id", "referral_code", name="uq_loyalty_membership_referral"
        ),
        sa.UniqueConstraint("public_token_hash", name="uq_loyalty_membership_token"),
    )
    op.create_table(
        "loyalty_ledger_entries",
        *_id_and_timestamps(),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("program_id", sa.Uuid(), nullable=False),
        sa.Column("membership_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("entry_type", ledger_entry_type, nullable=False),
        sa.Column("progress_delta", sa.Numeric(18, 6), nullable=False),
        sa.Column("source_entry_id", sa.Uuid(), nullable=True),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=160), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=False),
        sa.Column("entry_metadata", sa.JSON(), nullable=False),
        sa.CheckConstraint("progress_delta != 0", name="loyalty_ledger_delta_nonzero"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["program_id"], ["loyalty_programs.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["membership_id"], ["loyalty_memberships.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["source_entry_id"], ["loyalty_ledger_entries.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id", "idempotency_key", name="uq_loyalty_ledger_idempotency"
        ),
        sa.UniqueConstraint(
            "program_id",
            "order_id",
            "entry_type",
            name="uq_loyalty_ledger_order_program_type",
        ),
    )
    op.create_table(
        "loyalty_rewards",
        *_id_and_timestamps(),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("program_id", sa.Uuid(), nullable=False),
        sa.Column("membership_id", sa.Uuid(), nullable=False),
        sa.Column("source_ledger_entry_id", sa.Uuid(), nullable=False),
        sa.Column("reward_product_id", sa.Uuid(), nullable=True),
        sa.Column("reward_category_id", sa.Uuid(), nullable=True),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("redemption_code", sa.String(length=32), nullable=False),
        sa.Column("status", reward_status, nullable=False),
        sa.Column("issued_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("redeemed_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("ordinal > 0", name="loyalty_reward_ordinal_positive"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["program_id"], ["loyalty_programs.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["membership_id"], ["loyalty_memberships.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["source_ledger_entry_id"],
            ["loyalty_ledger_entries.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["reward_product_id"], ["products.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["reward_category_id"], ["categories.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id",
            "membership_id",
            "program_id",
            "ordinal",
            name="uq_loyalty_reward_ordinal",
        ),
        sa.UniqueConstraint(
            "tenant_id", "redemption_code", name="uq_loyalty_reward_redemption_code"
        ),
    )
    op.create_table(
        "loyalty_redemptions",
        *_id_and_timestamps(),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("membership_id", sa.Uuid(), nullable=False),
        sa.Column("reward_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("order_item_id", sa.Uuid(), nullable=False),
        sa.Column("discount_id", sa.Uuid(), nullable=True),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=160), nullable=False),
        sa.Column("status", redemption_status, nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=False),
        sa.Column("reward_snapshot", sa.JSON(), nullable=False),
        sa.CheckConstraint("amount >= 0", name="loyalty_redemption_amount_nonnegative"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["membership_id"], ["loyalty_memberships.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["reward_id"], ["loyalty_rewards.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["order_item_id"], ["order_items.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["discount_id"], ["discounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id", "idempotency_key", name="uq_loyalty_redemption_idempotency"
        ),
        sa.UniqueConstraint("reward_id", name="uq_loyalty_redemption_reward"),
    )
    _create_indexes()


def _create_indexes() -> None:
    indexes = {
        "loyalty_programs": [
            ("ix_loyalty_programs_tenant_id", ["tenant_id"]),
            ("ix_loyalty_program_tenant_active", ["tenant_id", "is_active"]),
        ],
        "loyalty_program_branches": [
            ("ix_loyalty_program_branches_tenant_id", ["tenant_id"]),
            ("ix_loyalty_program_branches_branch_id", ["branch_id"]),
        ],
        "loyalty_rules": [
            ("ix_loyalty_rules_tenant_id", ["tenant_id"]),
            ("ix_loyalty_rules_program_id", ["program_id"]),
            ("ix_loyalty_rules_qualifying_product_id", ["qualifying_product_id"]),
            ("ix_loyalty_rules_qualifying_category_id", ["qualifying_category_id"]),
            ("ix_loyalty_rules_reward_product_id", ["reward_product_id"]),
            ("ix_loyalty_rules_reward_category_id", ["reward_category_id"]),
        ],
        "loyalty_customers": [("ix_loyalty_customers_tenant_id", ["tenant_id"])],
        "loyalty_memberships": [
            ("ix_loyalty_memberships_tenant_id", ["tenant_id"]),
            ("ix_loyalty_memberships_branch_id", ["branch_id"]),
            ("ix_loyalty_memberships_program_id", ["program_id"]),
            ("ix_loyalty_memberships_customer_id", ["customer_id"]),
            (
                "ix_loyalty_memberships_referred_by_membership_id",
                ["referred_by_membership_id"],
            ),
            (
                "ix_loyalty_membership_tenant_program_active",
                ["tenant_id", "program_id", "is_active"],
            ),
        ],
        "loyalty_ledger_entries": [
            ("ix_loyalty_ledger_entries_tenant_id", ["tenant_id"]),
            ("ix_loyalty_ledger_entries_branch_id", ["branch_id"]),
            ("ix_loyalty_ledger_entries_program_id", ["program_id"]),
            ("ix_loyalty_ledger_entries_membership_id", ["membership_id"]),
            ("ix_loyalty_ledger_entries_order_id", ["order_id"]),
            ("ix_loyalty_ledger_entries_source_entry_id", ["source_entry_id"]),
            ("ix_loyalty_ledger_entries_actor_user_id", ["actor_user_id"]),
            (
                "ix_loyalty_ledger_membership_program_created",
                ["tenant_id", "membership_id", "program_id", "created_at"],
            ),
        ],
        "loyalty_rewards": [
            ("ix_loyalty_rewards_tenant_id", ["tenant_id"]),
            ("ix_loyalty_rewards_branch_id", ["branch_id"]),
            ("ix_loyalty_rewards_program_id", ["program_id"]),
            ("ix_loyalty_rewards_membership_id", ["membership_id"]),
            ("ix_loyalty_rewards_source_ledger_entry_id", ["source_ledger_entry_id"]),
            ("ix_loyalty_rewards_reward_product_id", ["reward_product_id"]),
            ("ix_loyalty_rewards_reward_category_id", ["reward_category_id"]),
            ("ix_loyalty_rewards_status", ["status"]),
            (
                "ix_loyalty_reward_membership_status",
                ["tenant_id", "membership_id", "status"],
            ),
        ],
        "loyalty_redemptions": [
            ("ix_loyalty_redemptions_tenant_id", ["tenant_id"]),
            ("ix_loyalty_redemptions_branch_id", ["branch_id"]),
            ("ix_loyalty_redemptions_membership_id", ["membership_id"]),
            ("ix_loyalty_redemptions_reward_id", ["reward_id"]),
            ("ix_loyalty_redemptions_order_id", ["order_id"]),
            ("ix_loyalty_redemptions_order_item_id", ["order_item_id"]),
            ("ix_loyalty_redemptions_discount_id", ["discount_id"]),
            ("ix_loyalty_redemptions_actor_user_id", ["actor_user_id"]),
        ],
    }
    for table_name, table_indexes in indexes.items():
        for index_name, columns in table_indexes:
            op.create_index(index_name, table_name, columns)


def downgrade() -> None:
    if "loyalty_membership_id" in _columns("qr_order_requests"):
        if "ix_qr_order_requests_loyalty_membership_id" in _indexes(
            "qr_order_requests"
        ):
            op.drop_index(
                "ix_qr_order_requests_loyalty_membership_id",
                table_name="qr_order_requests",
            )
        op.drop_column("qr_order_requests", "loyalty_membership_id")

    if "loyalty_membership_id" in _columns("orders"):
        if "ix_orders_loyalty_membership_id" in _indexes("orders"):
            op.drop_index("ix_orders_loyalty_membership_id", table_name="orders")
        op.drop_column("orders", "loyalty_membership_id")

    existing_tables = set(sa.inspect(op.get_bind()).get_table_names())
    for table_name in reversed(LOYALTY_TABLES):
        if table_name in existing_tables:
            op.drop_table(table_name)

    bind = op.get_bind()
    for enum_type in (
        redemption_status,
        reward_status,
        ledger_entry_type,
        campaign_type,
    ):
        enum_type.drop(bind, checkfirst=True)
