"""Make catalogues branch-owned and track centre-menu imports.

Revision ID: 0026_branch_catalog_sync
Revises: 0025_saved_cards
Create Date: 2026-09-01
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0026_branch_catalog_sync"
down_revision = "0025_saved_cards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("branches") as batch:
        batch.add_column(sa.Column("catalog_imported_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("catalog_source_branch_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key(
            "fk_branches_catalog_source_branch",
            "branches",
            ["catalog_source_branch_id"],
            ["id"],
            ondelete="SET NULL",
        )

    with op.batch_alter_table("categories") as batch:
        batch.add_column(sa.Column("source_category_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key(
            "fk_categories_source_category",
            "categories",
            ["source_category_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_index("ix_categories_source_category_id", ["source_category_id"])

    with op.batch_alter_table("products") as batch:
        batch.drop_constraint("uq_product_tenant_sku", type_="unique")
        batch.add_column(sa.Column("branch_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("source_product_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key(
            "fk_products_branch", "branches", ["branch_id"], ["id"], ondelete="CASCADE"
        )
        batch.create_foreign_key(
            "fk_products_source_product",
            "products",
            ["source_product_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_unique_constraint("uq_product_branch_sku", ["tenant_id", "branch_id", "sku"])
        batch.create_index("ix_products_branch_id", ["branch_id"])
        batch.create_index("ix_products_source_product_id", ["source_product_id"])

    # Existing shared catalogues become the centre catalogue. For tenants made
    # before the centre convention, the earliest active branch is the fallback.
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "UPDATE categories SET branch_id = COALESCE("
            "(SELECT id FROM branches b WHERE b.tenant_id = categories.tenant_id AND b.slug = 'merkez' LIMIT 1),"
            "(SELECT id FROM branches b WHERE b.tenant_id = categories.tenant_id AND b.is_active = true ORDER BY b.created_at LIMIT 1)"
            ") WHERE branch_id IS NULL"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE products SET branch_id = COALESCE("
            "(SELECT id FROM branches b WHERE b.tenant_id = products.tenant_id AND b.slug = 'merkez' LIMIT 1),"
            "(SELECT id FROM branches b WHERE b.tenant_id = products.tenant_id AND b.is_active = true ORDER BY b.created_at LIMIT 1)"
            ") WHERE branch_id IS NULL"
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("products") as batch:
        batch.drop_index("ix_products_source_product_id")
        batch.drop_index("ix_products_branch_id")
        batch.drop_constraint("uq_product_branch_sku", type_="unique")
        batch.drop_constraint("fk_products_source_product", type_="foreignkey")
        batch.drop_constraint("fk_products_branch", type_="foreignkey")
        batch.drop_column("source_product_id")
        batch.drop_column("branch_id")
        batch.create_unique_constraint("uq_product_tenant_sku", ["tenant_id", "sku"])
    with op.batch_alter_table("categories") as batch:
        batch.drop_index("ix_categories_source_category_id")
        batch.drop_constraint("fk_categories_source_category", type_="foreignkey")
        batch.drop_column("source_category_id")
    with op.batch_alter_table("branches") as batch:
        batch.drop_constraint("fk_branches_catalog_source_branch", type_="foreignkey")
        batch.drop_column("catalog_source_branch_id")
        batch.drop_column("catalog_imported_at")
