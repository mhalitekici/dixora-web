"""Owner-defined campaigns, separate from the single loyalty programme.

Hand-written and guarded by a table-name check, matching the surrounding
migrations: autogenerate keeps trying to drop server defaults that earlier
revisions set on purpose.

Revision ID: 0023_campaigns
Revises: 0022_delivery_orders
Create Date: 2026-08-11
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0023_campaigns"
down_revision = "0022_delivery_orders"
branch_labels = None
depends_on = None

CAMPAIGNS = "campaigns"
CAMPAIGN_BRANCHES = "campaign_branches"
APPLICATIONS = "campaign_applications"


def _timestamps() -> list[sa.Column]:
    return [
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
    ]


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    if CAMPAIGNS not in tables:
        op.create_table(
            CAMPAIGNS,
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("description", sa.String(400), nullable=True),
            sa.Column(
                "is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")
            ),
            sa.Column("buy_product_id", sa.Uuid(), nullable=True),
            sa.Column("buy_category_id", sa.Uuid(), nullable=True),
            sa.Column("buy_quantity", sa.Integer(), nullable=False, server_default="1"),
            sa.Column(
                "minimum_order_amount",
                sa.Numeric(14, 2),
                nullable=False,
                server_default="0",
            ),
            sa.Column("reward_kind", sa.String(20), nullable=False),
            sa.Column("reward_product_id", sa.Uuid(), nullable=True),
            sa.Column("reward_category_id", sa.Uuid(), nullable=True),
            sa.Column(
                "reward_quantity", sa.Integer(), nullable=False, server_default="1"
            ),
            sa.Column(
                "reward_value", sa.Numeric(14, 2), nullable=False, server_default="0"
            ),
            sa.Column(
                "audience", sa.String(20), nullable=False, server_default="EVERYONE"
            ),
            sa.Column(
                "max_uses_per_order", sa.Integer(), nullable=False, server_default="1"
            ),
            sa.Column("starts_at", sa.DateTime(), nullable=True),
            sa.Column("ends_at", sa.DateTime(), nullable=True),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            *_timestamps(),
            sa.CheckConstraint("buy_quantity > 0", name="campaign_buy_quantity_positive"),
            sa.CheckConstraint(
                "reward_quantity > 0", name="campaign_reward_quantity_positive"
            ),
            sa.CheckConstraint("max_uses_per_order > 0", name="campaign_max_uses_positive"),
            sa.CheckConstraint(
                "reward_value >= 0", name="campaign_reward_value_nonnegative"
            ),
            sa.CheckConstraint(
                "minimum_order_amount >= 0", name="campaign_minimum_order_nonnegative"
            ),
            sa.CheckConstraint(
                "reward_kind IN ('FREE_ITEM', 'PERCENT', 'AMOUNT')",
                name="campaign_reward_kind",
            ),
            sa.CheckConstraint(
                "audience IN ('EVERYONE', 'MEMBERS_ONLY')", name="campaign_audience"
            ),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(
                ["buy_product_id"], ["products.id"], ondelete="RESTRICT"
            ),
            sa.ForeignKeyConstraint(
                ["buy_category_id"], ["categories.id"], ondelete="RESTRICT"
            ),
            sa.ForeignKeyConstraint(
                ["reward_product_id"], ["products.id"], ondelete="RESTRICT"
            ),
            sa.ForeignKeyConstraint(
                ["reward_category_id"], ["categories.id"], ondelete="RESTRICT"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_campaigns_tenant_id", CAMPAIGNS, ["tenant_id"])
        op.create_index("ix_campaigns_active", CAMPAIGNS, ["tenant_id", "is_active"])
        op.create_index("ix_campaigns_buy_product_id", CAMPAIGNS, ["buy_product_id"])
        op.create_index("ix_campaigns_buy_category_id", CAMPAIGNS, ["buy_category_id"])
        op.create_index(
            "ix_campaigns_reward_product_id", CAMPAIGNS, ["reward_product_id"]
        )
        op.create_index(
            "ix_campaigns_reward_category_id", CAMPAIGNS, ["reward_category_id"]
        )

    if CAMPAIGN_BRANCHES not in tables:
        op.create_table(
            CAMPAIGN_BRANCHES,
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("campaign_id", sa.Uuid(), nullable=False),
            sa.Column("branch_id", sa.Uuid(), nullable=False),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(
                ["campaign_id"], ["campaigns.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
            sa.PrimaryKeyConstraint("campaign_id", "branch_id"),
        )
        op.create_index(
            "ix_campaign_branches_tenant_id", CAMPAIGN_BRANCHES, ["tenant_id"]
        )
        op.create_index(
            "ix_campaign_branches_branch_id", CAMPAIGN_BRANCHES, ["branch_id"]
        )

    if APPLICATIONS not in tables:
        op.create_table(
            APPLICATIONS,
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("branch_id", sa.Uuid(), nullable=False),
            sa.Column("campaign_id", sa.Uuid(), nullable=False),
            sa.Column("order_id", sa.Uuid(), nullable=False),
            sa.Column("order_item_id", sa.Uuid(), nullable=False),
            sa.Column("discount_id", sa.Uuid(), nullable=True),
            sa.Column("amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
            sa.Column("campaign_name_snapshot", sa.String(120), nullable=False),
            *_timestamps(),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(
                ["campaign_id"], ["campaigns.id"], ondelete="RESTRICT"
            ),
            sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(
                ["order_item_id"], ["order_items.id"], ondelete="RESTRICT"
            ),
            sa.ForeignKeyConstraint(
                ["discount_id"], ["discounts.id"], ondelete="RESTRICT"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "tenant_id",
                "order_id",
                "campaign_id",
                "order_item_id",
                name="uq_campaign_application_line",
            ),
        )
        op.create_index(
            "ix_campaign_applications_tenant_id", APPLICATIONS, ["tenant_id"]
        )
        op.create_index(
            "ix_campaign_applications_order", APPLICATIONS, ["tenant_id", "order_id"]
        )
        op.create_index(
            "ix_campaign_applications_branch_id", APPLICATIONS, ["branch_id"]
        )
        op.create_index(
            "ix_campaign_applications_campaign_id", APPLICATIONS, ["campaign_id"]
        )
        op.create_index(
            "ix_campaign_applications_order_item_id", APPLICATIONS, ["order_item_id"]
        )
        op.create_index(
            "ix_campaign_applications_discount_id", APPLICATIONS, ["discount_id"]
        )


def downgrade() -> None:
    op.drop_table(APPLICATIONS)
    op.drop_table(CAMPAIGN_BRANCHES)
    op.drop_table(CAMPAIGNS)
