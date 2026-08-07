"""Add fixed management presets, employee scope and branch contact fields.

Revision ID: 0006_management
Revises: 0005_loyalty_mvp
Create Date: 2026-08-03
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import NAMESPACE_URL, UUID, uuid5

import sqlalchemy as sa

from alembic import op

revision = "0006_management"
down_revision = "0005_loyalty_mvp"
branch_labels = None
depends_on = None

ROLE_PRESETS: dict[str, tuple[str, set[str]]] = {
    "BUSINESS_ADMIN": (
        "Yönetici",
        {
            "dashboard.read",
            "catalog.read",
            "catalog.manage",
            "products.manage",
            "tables.read",
            "tables.manage",
            "tables.operate",
            "tables.transfer",
            "orders.read",
            "orders.create",
            "orders.manage",
            "payments.manage",
            "discounts.request",
            "discounts.approve",
            "kitchen.read",
            "kitchen.manage",
            "inventory.read",
            "inventory.manage",
            "inventory.override",
            "qr.read",
            "qr.manage",
            "qr.approve",
            "reports.read",
            "printing.read",
            "printing.manage",
            "users.manage",
            "roles.read",
            "audit.read",
            "settings.manage",
            "loyalty.read",
            "loyalty.manage",
            "loyalty.redeem",
        },
    ),
    "BUSINESS_MANAGER": (
        "Müdür",
        {
            "dashboard.read",
            "catalog.read",
            "catalog.manage",
            "products.manage",
            "tables.read",
            "tables.manage",
            "tables.operate",
            "tables.transfer",
            "orders.read",
            "orders.create",
            "orders.manage",
            "payments.manage",
            "discounts.request",
            "discounts.approve",
            "kitchen.read",
            "kitchen.manage",
            "inventory.read",
            "inventory.manage",
            "qr.read",
            "qr.manage",
            "qr.approve",
            "reports.read",
            "printing.read",
            "printing.manage",
            "audit.read",
            "loyalty.read",
            "loyalty.redeem",
        },
    ),
    "WAITER": (
        "Garson",
        {
            "catalog.read",
            "tables.read",
            "tables.operate",
            "orders.read",
            "orders.create",
            "discounts.request",
            "kitchen.read",
            "qr.read",
            "qr.approve",
            "loyalty.read",
            "loyalty.redeem",
        },
    ),
    "KITCHEN": ("Aşçı", {"kitchen.read", "kitchen.manage", "orders.read"}),
}

LEGACY_PERMISSION_ADDITIONS: dict[str, set[str]] = {
    "BUSINESS_OWNER": {"loyalty.read", "loyalty.manage", "loyalty.redeem"},
    "CASHIER": {"loyalty.read", "loyalty.redeem"},
}


def _columns(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def _indexes(table_name: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table_name)}


def _backfill_role_presets() -> None:
    connection = op.get_bind()
    now = datetime.now(UTC).replace(tzinfo=None)
    tenants = [UUID(str(row[0])) for row in connection.execute(sa.text("SELECT id FROM tenants"))]

    permission_codes = set().union(
        *(codes for _, codes in ROLE_PRESETS.values()),
        *LEGACY_PERMISSION_ADDITIONS.values(),
    )
    permission_rows = {
        row[1]: UUID(str(row[0]))
        for row in connection.execute(sa.text("SELECT id, code FROM permissions"))
    }
    for code in sorted(permission_codes - permission_rows.keys()):
        permission_id = uuid5(NAMESPACE_URL, f"dixora:permission:{code}")
        connection.execute(
            sa.text(
                "INSERT INTO permissions (id, code, description, created_at, updated_at) "
                "VALUES (:id, :code, :description, :created_at, :updated_at)"
            ),
            {
                "id": str(permission_id),
                "code": code,
                "description": "Read assignable role presets" if code == "roles.read" else code,
                "created_at": now,
                "updated_at": now,
            },
        )
        permission_rows[code] = permission_id

    for tenant_id in tenants:
        existing = {
            row[1]: UUID(str(row[0]))
            for row in connection.execute(
                sa.text("SELECT id, code FROM roles WHERE tenant_id = :tenant_id"),
                {"tenant_id": str(tenant_id)},
            )
        }
        for code, (name, permissions) in ROLE_PRESETS.items():
            role_id = existing.get(code)
            if role_id is None:
                role_id = uuid5(NAMESPACE_URL, f"dixora:tenant:{tenant_id}:role:{code}")
                connection.execute(
                    sa.text(
                        "INSERT INTO roles "
                        "(id, tenant_id, code, name, is_system, is_active, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, :code, :name, :is_system, :is_active, "
                        ":created_at, :updated_at)"
                    ),
                    {
                        "id": str(role_id),
                        "tenant_id": str(tenant_id),
                        "code": code,
                        "name": name,
                        "is_system": True,
                        "is_active": True,
                        "created_at": now,
                        "updated_at": now,
                    },
                )
            else:
                connection.execute(
                    sa.text(
                        "UPDATE roles SET name = :name, is_system = :is_system, "
                        "is_active = :is_active, updated_at = :updated_at WHERE id = :id"
                    ),
                    {
                        "id": str(role_id),
                        "name": name,
                        "is_system": True,
                        "is_active": True,
                        "updated_at": now,
                    },
                )
            connection.execute(
                sa.text("DELETE FROM role_permissions WHERE role_id = :role_id"),
                {"role_id": str(role_id)},
            )
            for permission_code in sorted(permissions):
                connection.execute(
                    sa.text(
                        "INSERT INTO role_permissions (role_id, permission_id) "
                        "VALUES (:role_id, :permission_id)"
                    ),
                    {
                        "role_id": str(role_id),
                        "permission_id": str(permission_rows[permission_code]),
                    },
                )
        for code, permissions in LEGACY_PERMISSION_ADDITIONS.items():
            role_id = existing.get(code)
            if role_id is None:
                continue
            linked_permission_ids = {
                UUID(str(row[0]))
                for row in connection.execute(
                    sa.text("SELECT permission_id FROM role_permissions WHERE role_id = :role_id"),
                    {"role_id": str(role_id)},
                )
            }
            for permission_code in sorted(permissions):
                permission_id = permission_rows[permission_code]
                if permission_id in linked_permission_ids:
                    continue
                connection.execute(
                    sa.text(
                        "INSERT INTO role_permissions (role_id, permission_id) "
                        "VALUES (:role_id, :permission_id)"
                    ),
                    {
                        "role_id": str(role_id),
                        "permission_id": str(permission_id),
                    },
                )


def upgrade() -> None:
    branch_columns = _columns("branches")
    if "address" not in branch_columns:
        op.add_column("branches", sa.Column("address", sa.String(length=500), nullable=True))
    if "phone" not in branch_columns:
        op.add_column("branches", sa.Column("phone", sa.String(length=32), nullable=True))
    if "working_hours" not in branch_columns:
        op.add_column(
            "branches",
            sa.Column(
                "working_hours",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'{}'"),
            ),
        )

    user_columns = _columns("users")
    if "phone" not in user_columns:
        op.add_column("users", sa.Column("phone", sa.String(length=32), nullable=True))
    if "preparation_station_id" not in user_columns:
        op.add_column(
            "users",
            sa.Column(
                "preparation_station_id",
                sa.Uuid(),
                sa.ForeignKey("preparation_stations.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
    if "ix_users_preparation_station_id" not in _indexes("users"):
        op.create_index(
            "ix_users_preparation_station_id",
            "users",
            ["preparation_station_id"],
        )
    _backfill_role_presets()


def downgrade() -> None:
    if "preparation_station_id" in _columns("users"):
        if "ix_users_preparation_station_id" in _indexes("users"):
            op.drop_index("ix_users_preparation_station_id", table_name="users")
        op.drop_column("users", "preparation_station_id")
    if "phone" in _columns("users"):
        op.drop_column("users", "phone")
    for column in ("working_hours", "phone", "address"):
        if column in _columns("branches"):
            op.drop_column("branches", column)
