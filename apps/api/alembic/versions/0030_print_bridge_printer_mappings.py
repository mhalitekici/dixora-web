"""Bind each cloud printer device to exactly one local Print Bridge.

The mapping carries the exact printer name discovered on that bridge's host.
It is also the authorization boundary that prevents two local agents from
claiming the same physical destination.

Revision ID: 0030_print_bridge_mappings
Revises: 0029_print_bridge_hardening
Create Date: 2026-09-07
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0030_print_bridge_mappings"
down_revision = "0029_print_bridge_hardening"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if "print_bridge_printer_mappings" in _tables():
        return
    op.create_table(
        "print_bridge_printer_mappings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column(
            "tenant_id",
            sa.Uuid(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "branch_id",
            sa.Uuid(),
            sa.ForeignKey("branches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "bridge_id",
            sa.Uuid(),
            sa.ForeignKey("print_bridge_clients.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "printer_device_id",
            sa.Uuid(),
            sa.ForeignKey("printer_devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("local_printer_name", sa.String(length=255), nullable=False),
        sa.UniqueConstraint(
            "printer_device_id", name="uq_print_bridge_mapping_device"
        ),
        sa.UniqueConstraint(
            "bridge_id", "printer_device_id", name="uq_print_bridge_mapping_pair"
        ),
    )
    op.create_index(
        "ix_print_bridge_printer_mappings_tenant_id",
        "print_bridge_printer_mappings",
        ["tenant_id"],
    )
    op.create_index(
        "ix_print_bridge_printer_mappings_branch_id",
        "print_bridge_printer_mappings",
        ["branch_id"],
    )
    op.create_index(
        "ix_print_bridge_printer_mappings_bridge_id",
        "print_bridge_printer_mappings",
        ["bridge_id"],
    )
    op.create_index(
        "ix_print_bridge_printer_mappings_printer_device_id",
        "print_bridge_printer_mappings",
        ["printer_device_id"],
    )


def downgrade() -> None:
    if "print_bridge_printer_mappings" in _tables():
        op.drop_table("print_bridge_printer_mappings")
