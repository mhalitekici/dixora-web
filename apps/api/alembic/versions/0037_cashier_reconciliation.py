"""Add authenticated cashier shifts and business-day reconciliation.

Revision ID: 0037_cashier_reconciliation
Revises: 0036_recipe_units
Create Date: 2026-09-10
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid5

import sqlalchemy as sa

from alembic import op

revision = "0037_cashier_reconciliation"
down_revision = "0036_recipe_units"
branch_labels = None
depends_on = None

PERMISSIONS = {
    "cashier.shift.manage": (
        "Open and close cashier shifts",
        ("BUSINESS_OWNER", "BUSINESS_ADMIN", "BUSINESS_MANAGER", "CASHIER"),
    ),
    "cashier.day.close": (
        "Close and reconcile a branch business day",
        ("BUSINESS_OWNER", "BUSINESS_ADMIN", "BUSINESS_MANAGER"),
    ),
}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    shift_columns = _columns("cashier_shifts")
    additions = [
        sa.Column("opened_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("closed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("business_date", sa.Date(), nullable=True),
        sa.Column("cash_refunds", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("card_refunds", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("expected_cash", sa.Numeric(14, 2), nullable=False, server_default="0"),
    ]
    with op.batch_alter_table("cashier_shifts") as batch:
        for column in additions:
            if column.name not in shift_columns:
                batch.add_column(column)
        if "opened_by_user_id" not in shift_columns:
            batch.create_foreign_key(
                "fk_cashier_shifts_opened_by_user_id_users",
                "users",
                ["opened_by_user_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if "closed_by_user_id" not in shift_columns:
            batch.create_foreign_key(
                "fk_cashier_shifts_closed_by_user_id_users",
                "users",
                ["closed_by_user_id"],
                ["id"],
                ondelete="SET NULL",
            )
    op.execute(
        "UPDATE cashier_shifts SET opened_by_user_id = user_id WHERE opened_by_user_id IS NULL"
    )
    op.execute(
        "UPDATE cashier_shifts SET closed_by_user_id = user_id "
        "WHERE status = 'CLOSED' AND closed_by_user_id IS NULL"
    )
    op.execute(
        "UPDATE cashier_shifts SET business_date = CAST(opened_at AS DATE) "
        "WHERE business_date IS NULL"
    )
    op.execute("UPDATE cashier_shifts SET expected_cash = opening_cash + cash_sales - cash_refunds")
    with op.batch_alter_table("cashier_shifts") as batch:
        batch.alter_column("business_date", existing_type=sa.Date(), nullable=False)
    indexes = {item["name"] for item in sa.inspect(op.get_bind()).get_indexes("cashier_shifts")}
    for column in ("opened_by_user_id", "closed_by_user_id", "business_date"):
        index = f"ix_cashier_shifts_{column}"
        if index not in indexes:
            op.create_index(index, "cashier_shifts", [column])
    if "uq_cashier_shift_open_cashier" not in indexes:
        op.create_index(
            "uq_cashier_shift_open_cashier",
            "cashier_shifts",
            ["tenant_id", "branch_id", "user_id"],
            unique=True,
            postgresql_where=sa.text("status = 'OPEN'"),
            sqlite_where=sa.text("status = 'OPEN'"),
        )
    if "uq_cashier_shift_open_actor" not in indexes:
        op.create_index(
            "uq_cashier_shift_open_actor",
            "cashier_shifts",
            ["tenant_id", "branch_id", "opened_by_user_id"],
            unique=True,
            postgresql_where=sa.text("status = 'OPEN'"),
            sqlite_where=sa.text("status = 'OPEN'"),
        )

    payment_columns = _columns("payments")
    with op.batch_alter_table("payments") as batch:
        for name in ("shift_id", "refund_shift_id"):
            if name not in payment_columns:
                batch.add_column(sa.Column(name, sa.Uuid(), nullable=True))
                batch.create_foreign_key(
                    f"fk_payments_{name}_cashier_shifts",
                    "cashier_shifts",
                    [name],
                    ["id"],
                    ondelete="SET NULL",
                )
        if "refunded_by_user_id" not in payment_columns:
            batch.add_column(sa.Column("refunded_by_user_id", sa.Uuid(), nullable=True))
            batch.create_foreign_key(
                "fk_payments_refunded_by_user_id_users",
                "users",
                ["refunded_by_user_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if "refunded_at" not in payment_columns:
            batch.add_column(sa.Column("refunded_at", sa.DateTime(), nullable=True))
        if "refund_reason" not in payment_columns:
            batch.add_column(sa.Column("refund_reason", sa.String(255), nullable=True))
    payment_indexes = {item["name"] for item in sa.inspect(op.get_bind()).get_indexes("payments")}
    for name in ("shift_id", "refund_shift_id"):
        index = f"ix_payments_{name}"
        if index not in payment_indexes:
            op.create_index(index, "payments", [name])

    if "business_day_closes" not in _tables():
        op.create_table(
            "business_day_closes",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column(
                "tenant_id",
                sa.Uuid(),
                sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "branch_id",
                sa.Uuid(),
                sa.ForeignKey("branches.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("business_date", sa.Date(), nullable=False),
            sa.Column(
                "closed_by_user_id",
                sa.Uuid(),
                sa.ForeignKey("users.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("closed_at", sa.DateTime(), nullable=False),
            sa.Column("opening_cash", sa.Numeric(14, 2), nullable=False, server_default="0"),
            sa.Column("system_cash_total", sa.Numeric(14, 2), nullable=False, server_default="0"),
            sa.Column("system_card_total", sa.Numeric(14, 2), nullable=False, server_default="0"),
            sa.Column("cash_refunds", sa.Numeric(14, 2), nullable=False, server_default="0"),
            sa.Column("card_refunds", sa.Numeric(14, 2), nullable=False, server_default="0"),
            sa.Column("expected_cash", sa.Numeric(14, 2), nullable=False, server_default="0"),
            sa.Column("counted_cash", sa.Numeric(14, 2), nullable=False),
            sa.Column("reported_card_total", sa.Numeric(14, 2), nullable=False),
            sa.Column("cash_difference", sa.Numeric(14, 2), nullable=False),
            sa.Column("card_difference", sa.Numeric(14, 2), nullable=False),
            sa.Column("sales_total", sa.Numeric(14, 2), nullable=False, server_default="0"),
            sa.Column("discounts_total", sa.Numeric(14, 2), nullable=False, server_default="0"),
            sa.Column("complimentary_total", sa.Numeric(14, 2), nullable=False, server_default="0"),
            sa.Column(
                "service_charge_total", sa.Numeric(14, 2), nullable=False, server_default="0"
            ),
            sa.Column("receipt_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("note", sa.String(500), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint(
                "tenant_id", "branch_id", "business_date", name="uq_business_day_close_scope"
            ),
        )
        for column in ("tenant_id", "branch_id", "business_date", "closed_by_user_id"):
            op.create_index(f"ix_business_day_closes_{column}", "business_day_closes", [column])

    connection = op.get_bind()
    now = datetime.now(UTC).replace(tzinfo=None)
    uuid_cast = "UUID" if connection.dialect.name == "postgresql" else "CHAR(32)"
    for code, (description, roles) in PERMISSIONS.items():
        permission_id = str(uuid5(NAMESPACE_URL, f"dixora:permission:{code}"))
        connection.execute(
            sa.text(
                "INSERT INTO permissions (id, code, description, created_at, updated_at) "
                f"SELECT CAST(:id AS {uuid_cast}), CAST(:code_insert AS VARCHAR(100)), "
                "CAST(:description AS VARCHAR(255)), :now, :now "
                "WHERE NOT EXISTS (SELECT 1 FROM permissions "
                "WHERE code = CAST(:code_lookup AS VARCHAR(100)))"
            ),
            {
                "id": permission_id,
                "code_insert": code,
                "code_lookup": code,
                "description": description,
                "now": now,
            },
        )
        connection.execute(
            sa.text(
                "INSERT INTO role_permissions (role_id, permission_id) "
                "SELECT roles.id, permissions.id FROM roles "
                "JOIN permissions ON permissions.code = :code "
                "WHERE roles.code IN :roles AND NOT EXISTS ("
                "SELECT 1 FROM role_permissions rp WHERE rp.role_id = roles.id "
                "AND rp.permission_id = permissions.id)"
            ).bindparams(sa.bindparam("roles", expanding=True)),
            {"code": code, "roles": roles},
        )


def downgrade() -> None:
    connection = op.get_bind()
    for code in PERMISSIONS:
        connection.execute(
            sa.text(
                "DELETE FROM role_permissions WHERE permission_id = "
                "(SELECT id FROM permissions WHERE code = :code)"
            ),
            {"code": code},
        )
        connection.execute(sa.text("DELETE FROM permissions WHERE code = :code"), {"code": code})
    if "business_day_closes" in _tables():
        op.drop_table("business_day_closes")
    payment_indexes = {item["name"] for item in sa.inspect(op.get_bind()).get_indexes("payments")}
    for index in ("ix_payments_shift_id", "ix_payments_refund_shift_id"):
        if index in payment_indexes:
            op.drop_index(index, table_name="payments")
    payment_columns = _columns("payments")
    with op.batch_alter_table("payments") as batch:
        for name, constraint in (
            ("refund_reason", None),
            ("refunded_at", None),
            ("refunded_by_user_id", "fk_payments_refunded_by_user_id_users"),
            ("refund_shift_id", "fk_payments_refund_shift_id_cashier_shifts"),
            ("shift_id", "fk_payments_shift_id_cashier_shifts"),
        ):
            if name in payment_columns:
                if constraint:
                    batch.drop_constraint(constraint, type_="foreignkey")
                batch.drop_column(name)
    shift_indexes = {
        item["name"] for item in sa.inspect(op.get_bind()).get_indexes("cashier_shifts")
    }
    for index in ("uq_cashier_shift_open_cashier", "uq_cashier_shift_open_actor"):
        if index in shift_indexes:
            op.drop_index(index, table_name="cashier_shifts")
    for index in (
        "ix_cashier_shifts_opened_by_user_id",
        "ix_cashier_shifts_closed_by_user_id",
        "ix_cashier_shifts_business_date",
    ):
        if index in shift_indexes:
            op.drop_index(index, table_name="cashier_shifts")
    shift_columns = _columns("cashier_shifts")
    with op.batch_alter_table("cashier_shifts") as batch:
        for name, constraint in (
            ("expected_cash", None),
            ("card_refunds", None),
            ("cash_refunds", None),
            ("business_date", None),
            ("closed_by_user_id", "fk_cashier_shifts_closed_by_user_id_users"),
            ("opened_by_user_id", "fk_cashier_shifts_opened_by_user_id_users"),
        ):
            if name in shift_columns:
                if constraint:
                    batch.drop_constraint(constraint, type_="foreignkey")
                batch.drop_column(name)
