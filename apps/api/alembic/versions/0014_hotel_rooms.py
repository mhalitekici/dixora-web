"""Add hotel room occupancy tracking and checkout history.

Revision ID: 0014_hotel_rooms
Revises: 0013_product_calories
Create Date: 2026-08-08
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0014_hotel_rooms"
down_revision = "0013_product_calories"
branch_labels = None
depends_on = None

ROOMS_TABLE = "hotel_rooms"
CHECKOUTS_TABLE = "hotel_room_checkouts"


def upgrade() -> None:
    bind = op.get_bind()
    existing_tables = sa.inspect(bind).get_table_names()

    if ROOMS_TABLE not in existing_tables:
        op.create_table(
            ROOMS_TABLE,
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("branch_id", sa.Uuid(), nullable=False),
            sa.Column("room_number", sa.String(length=20), nullable=False),
            sa.Column(
                "status",
                sa.String(length=20),
                nullable=False,
                server_default="VACANT",
            ),
            sa.Column("guest_name", sa.String(length=160), nullable=True),
            sa.Column("checked_in_at", sa.DateTime(), nullable=True),
            sa.Column("notes", sa.String(length=500), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
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
                name="fk_hotel_rooms_tenant_id_tenants",
                ondelete="RESTRICT",
            ),
            sa.ForeignKeyConstraint(
                ["branch_id"],
                ["branches.id"],
                name="fk_hotel_rooms_branch_id_branches",
                ondelete="RESTRICT",
            ),
            sa.PrimaryKeyConstraint("id", name="pk_hotel_rooms"),
            sa.UniqueConstraint(
                "tenant_id", "branch_id", "room_number", name="uq_hotel_room_scope_number"
            ),
            sa.CheckConstraint(
                "status IN ('VACANT', 'OCCUPIED')", name="ck_hotel_rooms_status"
            ),
        )
        op.create_index("ix_hotel_rooms_tenant_id", ROOMS_TABLE, ["tenant_id"])
        op.create_index("ix_hotel_rooms_branch_id", ROOMS_TABLE, ["branch_id"])
        op.create_index("ix_hotel_rooms_status", ROOMS_TABLE, ["status"])

    if CHECKOUTS_TABLE not in existing_tables:
        op.create_table(
            CHECKOUTS_TABLE,
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("branch_id", sa.Uuid(), nullable=False),
            sa.Column("room_id", sa.Uuid(), nullable=False),
            sa.Column("room_number", sa.String(length=20), nullable=False),
            sa.Column("guest_name", sa.String(length=160), nullable=False),
            sa.Column("total_amount", sa.Numeric(14, 2), nullable=False),
            sa.Column("payment_method", sa.String(length=40), nullable=False),
            sa.Column("checked_in_at", sa.DateTime(), nullable=True),
            sa.Column("checked_out_at", sa.DateTime(), nullable=False),
            sa.Column("checked_out_by_user_id", sa.Uuid(), nullable=True),
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
                name="fk_hotel_room_checkouts_tenant_id_tenants",
                ondelete="RESTRICT",
            ),
            sa.ForeignKeyConstraint(
                ["branch_id"],
                ["branches.id"],
                name="fk_hotel_room_checkouts_branch_id_branches",
                ondelete="RESTRICT",
            ),
            sa.ForeignKeyConstraint(
                ["room_id"],
                ["hotel_rooms.id"],
                name="fk_hotel_room_checkouts_room_id_hotel_rooms",
                ondelete="RESTRICT",
            ),
            sa.ForeignKeyConstraint(
                ["checked_out_by_user_id"],
                ["users.id"],
                name="fk_hotel_room_checkouts_checked_out_by_user_id_users",
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id", name="pk_hotel_room_checkouts"),
        )
        op.create_index("ix_hotel_room_checkouts_tenant_id", CHECKOUTS_TABLE, ["tenant_id"])
        op.create_index("ix_hotel_room_checkouts_branch_id", CHECKOUTS_TABLE, ["branch_id"])
        op.create_index("ix_hotel_room_checkouts_room_id", CHECKOUTS_TABLE, ["room_id"])


def downgrade() -> None:
    bind = op.get_bind()
    existing_tables = sa.inspect(bind).get_table_names()
    if CHECKOUTS_TABLE in existing_tables:
        op.drop_table(CHECKOUTS_TABLE)
    if ROOMS_TABLE in existing_tables:
        op.drop_table(ROOMS_TABLE)
