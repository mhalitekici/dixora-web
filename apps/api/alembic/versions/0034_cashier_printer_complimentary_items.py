"""Add explicit printer purposes and complimentary order items.

Revision ID: 0034_cashier_printer_comp
Revises: 0033_service_charge_transfer
Create Date: 2026-09-08
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid5

import sqlalchemy as sa

from alembic import op

revision = "0034_cashier_printer_comp"
down_revision = "0033_service_charge_transfer"
branch_labels = None
depends_on = None

PERMISSION_CODE = "orders.comp"


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    printer_columns = _columns("printer_devices")
    with op.batch_alter_table("printer_devices") as batch:
        if "purpose" not in printer_columns:
            batch.add_column(
                sa.Column(
                    "purpose",
                    sa.String(length=20),
                    nullable=False,
                    server_default="PREPARATION",
                )
            )

    item_columns = _columns("order_items")
    with op.batch_alter_table("order_items") as batch:
        if "is_complimentary" not in item_columns:
            batch.add_column(
                sa.Column(
                    "is_complimentary",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )
        if "complimentary_by_user_id" not in item_columns:
            batch.add_column(sa.Column("complimentary_by_user_id", sa.Uuid(), nullable=True))
            batch.create_foreign_key(
                "fk_order_items_complimentary_by_user_id_users",
                "users",
                ["complimentary_by_user_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if "complimentary_at" not in item_columns:
            batch.add_column(sa.Column("complimentary_at", sa.DateTime(), nullable=True))
        if "complimentary_reason" not in item_columns:
            batch.add_column(
                sa.Column("complimentary_reason", sa.String(length=255), nullable=True)
            )

    connection = op.get_bind()
    now = datetime.now(UTC).replace(tzinfo=None)
    permission_id = str(uuid5(NAMESPACE_URL, f"dixora:permission:{PERMISSION_CODE}"))
    connection.execute(
        sa.text(
            "INSERT INTO permissions (id, code, description, created_at, updated_at) "
            "SELECT CAST(:id AS UUID), CAST(:code_insert AS VARCHAR(100)), "
            "CAST(:description AS VARCHAR(255)), :created_at, :updated_at "
            "WHERE NOT EXISTS ("
            "SELECT 1 FROM permissions WHERE code = CAST(:code_lookup AS VARCHAR(100))"
            ")"
        ),
        {
            "id": permission_id,
            "code_insert": PERMISSION_CODE,
            "code_lookup": PERMISSION_CODE,
            "description": "Mark order items as complimentary",
            "created_at": now,
            "updated_at": now,
        },
    )
    connection.execute(
        sa.text(
            "INSERT INTO role_permissions (role_id, permission_id) "
            "SELECT roles.id, permissions.id FROM roles "
            "JOIN permissions ON permissions.code = :code "
            "WHERE roles.code IN ('BUSINESS_OWNER', 'BUSINESS_ADMIN', 'BUSINESS_MANAGER') "
            "AND NOT EXISTS (SELECT 1 FROM role_permissions existing "
            "WHERE existing.role_id = roles.id AND existing.permission_id = permissions.id)"
        ),
        {"code": PERMISSION_CODE},
    )


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "DELETE FROM role_permissions WHERE permission_id = "
            "(SELECT id FROM permissions WHERE code = :code)"
        ),
        {"code": PERMISSION_CODE},
    )
    connection.execute(
        sa.text("DELETE FROM permissions WHERE code = :code"), {"code": PERMISSION_CODE}
    )

    item_columns = _columns("order_items")
    with op.batch_alter_table("order_items") as batch:
        if "complimentary_reason" in item_columns:
            batch.drop_column("complimentary_reason")
        if "complimentary_at" in item_columns:
            batch.drop_column("complimentary_at")
        if "complimentary_by_user_id" in item_columns:
            batch.drop_constraint(
                "fk_order_items_complimentary_by_user_id_users", type_="foreignkey"
            )
            batch.drop_column("complimentary_by_user_id")
        if "is_complimentary" in item_columns:
            batch.drop_column("is_complimentary")

    if "purpose" in _columns("printer_devices"):
        with op.batch_alter_table("printer_devices") as batch:
            batch.drop_column("purpose")
