"""Add the cached machine-translation store for public QR menu content.

Revision ID: 0015_content_translations
Revises: 0014_hotel_rooms
Create Date: 2026-08-08
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0015_content_translations"
down_revision = "0014_hotel_rooms"
branch_labels = None
depends_on = None

TABLE_NAME = "content_translations"


def upgrade() -> None:
    bind = op.get_bind()
    if TABLE_NAME in sa.inspect(bind).get_table_names():
        return

    op.create_table(
        TABLE_NAME,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("entity_type", sa.String(length=40), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("field", sa.String(length=40), nullable=False),
        sa.Column("locale", sa.String(length=12), nullable=False),
        sa.Column("source_hash", sa.String(length=64), nullable=False),
        sa.Column("translated_text", sa.Text(), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
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
            name="fk_content_translations_tenant_id_tenants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_content_translations"),
        sa.UniqueConstraint(
            "tenant_id",
            "entity_type",
            "entity_id",
            "field",
            "locale",
            name="uq_content_translation_scope",
        ),
    )
    op.create_index("ix_content_translations_tenant_id", TABLE_NAME, ["tenant_id"])
    op.create_index(
        "ix_content_translations_lookup",
        TABLE_NAME,
        ["tenant_id", "locale", "entity_type"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    if TABLE_NAME not in sa.inspect(bind).get_table_names():
        return
    op.drop_table(TABLE_NAME)
