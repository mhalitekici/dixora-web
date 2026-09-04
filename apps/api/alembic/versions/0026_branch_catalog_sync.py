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


# The bootstrap revision creates every table from current metadata, so a fresh
# database already has everything below by the time this runs; an existing one
# has none of it. Every step is therefore guarded, exactly as the revisions
# before this one are. Without the guards a new installation cannot be created
# at all: `alembic upgrade head` fails here with a duplicate column.
def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _constraints(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    names = {item["name"] for item in inspector.get_foreign_keys(table)}
    names |= {item["name"] for item in inspector.get_unique_constraints(table)}
    return {name for name in names if name}


def _indexes(table: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    branch_columns = _columns("branches")
    branch_constraints = _constraints("branches")
    with op.batch_alter_table("branches") as batch:
        if "catalog_imported_at" not in branch_columns:
            batch.add_column(sa.Column("catalog_imported_at", sa.DateTime(), nullable=True))
        if "catalog_source_branch_id" not in branch_columns:
            batch.add_column(sa.Column("catalog_source_branch_id", sa.Uuid(), nullable=True))
        if "fk_branches_catalog_source_branch" not in branch_constraints:
            batch.create_foreign_key(
                "fk_branches_catalog_source_branch",
                "branches",
                ["catalog_source_branch_id"],
                ["id"],
                ondelete="SET NULL",
            )

    category_columns = _columns("categories")
    category_constraints = _constraints("categories")
    category_indexes = _indexes("categories")
    with op.batch_alter_table("categories") as batch:
        if "source_category_id" not in category_columns:
            batch.add_column(sa.Column("source_category_id", sa.Uuid(), nullable=True))
        if "fk_categories_source_category" not in category_constraints:
            batch.create_foreign_key(
                "fk_categories_source_category",
                "categories",
                ["source_category_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if "ix_categories_source_category_id" not in category_indexes:
            batch.create_index("ix_categories_source_category_id", ["source_category_id"])

    product_columns = _columns("products")
    product_constraints = _constraints("products")
    product_indexes = _indexes("products")
    with op.batch_alter_table("products") as batch:
        if "uq_product_tenant_sku" in product_constraints:
            batch.drop_constraint("uq_product_tenant_sku", type_="unique")
        if "branch_id" not in product_columns:
            batch.add_column(sa.Column("branch_id", sa.Uuid(), nullable=True))
        if "source_product_id" not in product_columns:
            batch.add_column(sa.Column("source_product_id", sa.Uuid(), nullable=True))
        if "fk_products_branch" not in product_constraints:
            batch.create_foreign_key(
                "fk_products_branch", "branches", ["branch_id"], ["id"], ondelete="CASCADE"
            )
        if "fk_products_source_product" not in product_constraints:
            batch.create_foreign_key(
                "fk_products_source_product",
                "products",
                ["source_product_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if "uq_product_branch_sku" not in product_constraints:
            batch.create_unique_constraint(
                "uq_product_branch_sku", ["tenant_id", "branch_id", "sku"]
            )
        if "ix_products_branch_id" not in product_indexes:
            batch.create_index("ix_products_branch_id", ["branch_id"])
        if "ix_products_source_product_id" not in product_indexes:
            batch.create_index("ix_products_source_product_id", ["source_product_id"])

    # Existing shared catalogues become the centre catalogue. For tenants made
    # before the centre convention, the earliest active branch is the fallback.
    # A fresh database has no rows, so this is a no-op there.
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "UPDATE categories SET branch_id = COALESCE("
            "(SELECT id FROM branches b WHERE b.tenant_id = categories.tenant_id"
            " AND b.slug = 'merkez' LIMIT 1),"
            "(SELECT id FROM branches b WHERE b.tenant_id = categories.tenant_id"
            " AND b.is_active = true ORDER BY b.created_at LIMIT 1)"
            ") WHERE branch_id IS NULL"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE products SET branch_id = COALESCE("
            "(SELECT id FROM branches b WHERE b.tenant_id = products.tenant_id"
            " AND b.slug = 'merkez' LIMIT 1),"
            "(SELECT id FROM branches b WHERE b.tenant_id = products.tenant_id"
            " AND b.is_active = true ORDER BY b.created_at LIMIT 1)"
            ") WHERE branch_id IS NULL"
        )
    )


def downgrade() -> None:
    product_columns = _columns("products")
    product_constraints = _constraints("products")
    product_indexes = _indexes("products")
    with op.batch_alter_table("products") as batch:
        if "ix_products_source_product_id" in product_indexes:
            batch.drop_index("ix_products_source_product_id")
        if "ix_products_branch_id" in product_indexes:
            batch.drop_index("ix_products_branch_id")
        if "uq_product_branch_sku" in product_constraints:
            batch.drop_constraint("uq_product_branch_sku", type_="unique")
        if "fk_products_source_product" in product_constraints:
            batch.drop_constraint("fk_products_source_product", type_="foreignkey")
        if "fk_products_branch" in product_constraints:
            batch.drop_constraint("fk_products_branch", type_="foreignkey")
        if "source_product_id" in product_columns:
            batch.drop_column("source_product_id")
        if "branch_id" in product_columns:
            batch.drop_column("branch_id")
        if "uq_product_tenant_sku" not in product_constraints:
            batch.create_unique_constraint("uq_product_tenant_sku", ["tenant_id", "sku"])

    category_columns = _columns("categories")
    category_constraints = _constraints("categories")
    category_indexes = _indexes("categories")
    with op.batch_alter_table("categories") as batch:
        if "ix_categories_source_category_id" in category_indexes:
            batch.drop_index("ix_categories_source_category_id")
        if "fk_categories_source_category" in category_constraints:
            batch.drop_constraint("fk_categories_source_category", type_="foreignkey")
        if "source_category_id" in category_columns:
            batch.drop_column("source_category_id")

    branch_columns = _columns("branches")
    branch_constraints = _constraints("branches")
    with op.batch_alter_table("branches") as batch:
        if "fk_branches_catalog_source_branch" in branch_constraints:
            batch.drop_constraint("fk_branches_catalog_source_branch", type_="foreignkey")
        if "catalog_source_branch_id" in branch_columns:
            batch.drop_column("catalog_source_branch_id")
        if "catalog_imported_at" in branch_columns:
            batch.drop_column("catalog_imported_at")
