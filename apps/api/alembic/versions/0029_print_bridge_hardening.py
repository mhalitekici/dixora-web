"""Harden the print bridge protocol for physical printing.

Adds:
- `print_jobs.lease_expires_at` — recovers a job stuck CLAIMED/SENT by a
  crashed or disconnected bridge without operator intervention.
- `print_bridge_clients.{platform,version,printer_inventory,revoked_at}` —
  reported by the local agent on heartbeat, and a real revoke path.
- `print_bridge_enrollment_codes` — short-lived, one-time codes so a new
  desktop agent can self-enroll without a manager hand-typing a raw token.

Revision ID: 0029_print_bridge_hardening
Revises: 0028_registration_consent
Create Date: 2026-09-06
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0029_print_bridge_hardening"
down_revision = "0028_registration_consent"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    job_columns = _columns("print_jobs")
    if "lease_expires_at" not in job_columns:
        with op.batch_alter_table("print_jobs") as batch:
            batch.add_column(sa.Column("lease_expires_at", sa.DateTime(), nullable=True))
            batch.create_index(
                "ix_print_jobs_lease_expires_at", ["lease_expires_at"]
            )

    bridge_columns = _columns("print_bridge_clients")
    with op.batch_alter_table("print_bridge_clients") as batch:
        if "platform" not in bridge_columns:
            batch.add_column(sa.Column("platform", sa.String(length=20), nullable=True))
        if "version" not in bridge_columns:
            batch.add_column(sa.Column("version", sa.String(length=40), nullable=True))
        if "printer_inventory" not in bridge_columns:
            batch.add_column(
                sa.Column(
                    "printer_inventory",
                    sa.JSON(),
                    nullable=False,
                    server_default="[]",
                )
            )
        if "revoked_at" not in bridge_columns:
            batch.add_column(sa.Column("revoked_at", sa.DateTime(), nullable=True))

    if "print_bridge_enrollment_codes" not in _tables():
        op.create_table(
            "print_bridge_enrollment_codes",
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
                "created_by_user_id",
                sa.Uuid(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("code_hash", sa.String(length=64), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("consumed_at", sa.DateTime(), nullable=True),
            sa.Column(
                "created_bridge_id",
                sa.Uuid(),
                sa.ForeignKey("print_bridge_clients.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.UniqueConstraint(
                "code_hash", name="uq_print_bridge_enrollment_code_hash"
            ),
        )
        op.create_index(
            "ix_print_bridge_enrollment_codes_tenant_id",
            "print_bridge_enrollment_codes",
            ["tenant_id"],
        )
        op.create_index(
            "ix_print_bridge_enrollment_codes_branch_id",
            "print_bridge_enrollment_codes",
            ["branch_id"],
        )
        op.create_index(
            "ix_print_bridge_enrollment_codes_expires_at",
            "print_bridge_enrollment_codes",
            ["expires_at"],
        )


def downgrade() -> None:
    if "print_bridge_enrollment_codes" in _tables():
        op.drop_table("print_bridge_enrollment_codes")

    bridge_columns = _columns("print_bridge_clients")
    with op.batch_alter_table("print_bridge_clients") as batch:
        if "revoked_at" in bridge_columns:
            batch.drop_column("revoked_at")
        if "printer_inventory" in bridge_columns:
            batch.drop_column("printer_inventory")
        if "version" in bridge_columns:
            batch.drop_column("version")
        if "platform" in bridge_columns:
            batch.drop_column("platform")

    job_columns = _columns("print_jobs")
    if "lease_expires_at" in job_columns:
        with op.batch_alter_table("print_jobs") as batch:
            batch.drop_index("ix_print_jobs_lease_expires_at")
            batch.drop_column("lease_expires_at")
