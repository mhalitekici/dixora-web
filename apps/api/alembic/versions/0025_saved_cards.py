"""Stored payment instruments and charge attempts.

Card numbers are never stored — only the provider's opaque handles and a masked
descriptor, which keeps the application out of PCI DSS scope.

Revision ID: 0025_saved_cards
Revises: 0024_invoice_billing_period
Create Date: 2026-08-13
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0025_saved_cards"
down_revision = "0024_invoice_billing_period"
branch_labels = None
depends_on = None

CARDS = "saved_cards"
ATTEMPTS = "payment_attempts"


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
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if CARDS not in tables:
        op.create_table(
            CARDS,
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("provider", sa.String(30), nullable=False),
            sa.Column("card_token", sa.String(255), nullable=False),
            sa.Column("card_user_key", sa.String(255), nullable=False),
            sa.Column("masked_number", sa.String(30), nullable=False),
            sa.Column("card_association", sa.String(40), nullable=True),
            sa.Column("card_family", sa.String(60), nullable=True),
            sa.Column("holder_name", sa.String(120), nullable=True),
            sa.Column(
                "is_default", sa.Boolean(), nullable=False, server_default=sa.text("true")
            ),
            sa.Column(
                "is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")
            ),
            sa.Column("last_used_at", sa.DateTime(), nullable=True),
            *_timestamps(),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "tenant_id", "provider", "card_token", name="uq_saved_card_token"
            ),
        )
        op.create_index("ix_saved_cards_tenant_id", CARDS, ["tenant_id"])
        op.create_index(
            "ix_saved_cards_tenant_default", CARDS, ["tenant_id", "is_default"]
        )

    if ATTEMPTS not in tables:
        op.create_table(
            ATTEMPTS,
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("invoice_id", sa.Uuid(), nullable=False),
            sa.Column("saved_card_id", sa.Uuid(), nullable=True),
            sa.Column("provider", sa.String(30), nullable=False),
            sa.Column("idempotency_key", sa.String(160), nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("provider_payment_id", sa.String(120), nullable=True),
            sa.Column("error_code", sa.String(60), nullable=True),
            sa.Column("error_message", sa.String(400), nullable=True),
            *_timestamps(),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(
                ["saved_card_id"], ["saved_cards.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "tenant_id", "idempotency_key", name="uq_payment_attempt_idempotency"
            ),
        )
        op.create_index("ix_payment_attempts_tenant_id", ATTEMPTS, ["tenant_id"])
        op.create_index("ix_payment_attempts_invoice_id", ATTEMPTS, ["invoice_id"])
        op.create_index(
            "ix_payment_attempts_invoice", ATTEMPTS, ["tenant_id", "invoice_id"]
        )


def downgrade() -> None:
    op.drop_table(ATTEMPTS)
    op.drop_table(CARDS)
