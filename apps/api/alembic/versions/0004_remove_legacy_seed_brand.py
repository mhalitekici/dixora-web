"""Rename the legacy branded development seed.

Revision ID: 0004_remove_legacy_seed
Revises: 0003_standard_plan
Create Date: 2026-08-01
"""

import hashlib

import sqlalchemy as sa

from alembic import op

revision = "0004_remove_legacy_seed"
down_revision = "0003_standard_plan"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    tenant_id = connection.execute(
        sa.text("SELECT id FROM tenants WHERE slug = :slug"),
        {"slug": "elixir-hotel"},
    ).scalar_one_or_none()
    if tenant_id is None:
        return

    connection.execute(
        sa.text(
            "UPDATE tenants SET name = :name, slug = :new_slug "
            "WHERE id = :tenant_id"
        ),
        {"name": "Dixora Lab", "new_slug": "dixora-lab", "tenant_id": tenant_id},
    )
    connection.execute(
        sa.text(
            "UPDATE branches SET name = :name, slug = :new_slug "
            "WHERE tenant_id = :tenant_id AND slug = :old_slug"
        ),
        {
            "name": "Dixora Lab Main Branch",
            "new_slug": "merkez",
            "old_slug": "elixir-main",
            "tenant_id": tenant_id,
        },
    )
    connection.execute(
        sa.text(
            "UPDATE users SET "
            "username = replace(username, '@elixir.test', '@dixora.test'), "
            "email = replace(email, '@elixir.test', '@dixora.test'), "
            "display_name = replace(display_name, 'Elixir', 'Dixora Lab') "
            "WHERE tenant_id = :tenant_id"
        ),
        {"tenant_id": tenant_id},
    )
    connection.execute(
        sa.text(
            "UPDATE products SET name = replace(name, 'Elixir', 'Dixora Lab'), "
            "description = replace(description, 'Elixir Hotel', 'Dixora Lab') "
            "WHERE tenant_id = :tenant_id"
        ),
        {"tenant_id": tenant_id},
    )
    connection.execute(
        sa.text(
            "UPDATE qr_menu_configs SET "
            "menu_name = replace(menu_name, 'Elixir Hotel', 'Dixora Lab') "
            "WHERE tenant_id = :tenant_id"
        ),
        {"tenant_id": tenant_id},
    )
    connection.execute(
        sa.text(
            "UPDATE print_bridge_clients SET name = replace(name, 'Elixir', 'Dixora Lab'), "
            "token_hash = :token_hash WHERE tenant_id = :tenant_id"
        ),
        {
            "tenant_id": tenant_id,
            "token_hash": hashlib.sha256(b"pb_dev_dixora_lab_bridge_2026").hexdigest(),
        },
    )


def downgrade() -> None:
    # This development-only content rename intentionally remains one-way.
    pass
