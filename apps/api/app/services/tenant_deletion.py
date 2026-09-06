"""Erase one business and everything that belongs to it.

Most `tenant_id` foreign keys in this schema are `ondelete="RESTRICT"`, which is
the right default for day-to-day code — nothing should ever remove a business by
accident — but it means a plain `DELETE FROM tenants` is refused. The rows have
to be removed child-first instead.

The order is derived from `Base.metadata.sorted_tables` rather than written out
by hand. A hand-kept list is exactly the kind of thing that silently rots: the
next table someone adds would be left behind, and the delete would start failing
in production with a foreign-key error. Reversing SQLAlchemy's own topological
sort keeps the order correct by construction.

Every statement is scoped `WHERE tenant_id = :tenant_id`. Rows whose `tenant_id`
is NULL — platform audit entries, the SUPER_ADMIN role, super-admin accounts —
never match, and neither does any other business's data.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Table, delete, select, update
from sqlalchemy.engine import Result
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.logging import logger
from app.models import Base, Product, QrMenuConfig, Tenant
from app.services.media_storage import (
    MediaObjectNotFound,
    MediaStorage,
    MediaStorageError,
)
from app.services.product_images import (
    owned_product_image_key,
    owned_qr_menu_image_key,
)

TENANT_COLUMN = "tenant_id"


def _row_count(result: Result[Any]) -> int:
    """The number of rows a DELETE/UPDATE affected.

    `.rowcount` is only declared on the `CursorResult` subtype, not the base
    `Result` that `AsyncSession.execute()` is typed to return — and exactly
    which one mypy sees varies with the installed SQLAlchemy version (this
    project pins `SQLAlchemy>=2.0.36,<3`, not an exact version). It exists at
    runtime on the Core DML result either way, so `getattr` reads it without
    tying this to either typing.
    """
    return getattr(result, "rowcount", 0) or 0


def tenant_scoped_tables() -> list[Table]:
    """Every tenant-owned table, children before their parents.

    `sorted_tables` lists parents first; deleting needs the opposite. `tenants`
    itself carries no `tenant_id` and is removed separately, last of all.
    """
    return [
        table
        for table in reversed(Base.metadata.sorted_tables)
        if TENANT_COLUMN in table.c and table.name != Tenant.__tablename__
    ]


def _self_referencing_columns(table: Table) -> list[str]:
    """Nullable columns pointing back at the same table.

    A single `DELETE` that removes both the parent and the child row can still
    trip a `RESTRICT` self-reference (`loyalty_ledger_entries.source_entry_id`),
    because that check fires per row rather than at the end of the statement.
    Clearing the links first sidesteps the ordering question entirely.
    """
    names: list[str] = []
    for key in table.foreign_keys:
        if key.column.table is table and key.parent.nullable:
            names.append(key.parent.name)
    return sorted(set(names))


async def collect_tenant_media_keys(
    db: AsyncSession, settings: Settings, tenant_id: UUID
) -> list[str]:
    """Storage keys for the images this business owns, read before the rows go.

    Collected up front because the URLs live in rows that are about to be
    deleted; the objects themselves are removed only after the transaction
    commits, so a failed delete never orphans a live product image.
    """
    keys: list[str] = []

    product_urls = (
        (
            await db.execute(
                select(Product.image_url).where(
                    Product.tenant_id == tenant_id, Product.image_url.is_not(None)
                )
            )
        )
        .scalars()
        .all()
    )
    for url in product_urls:
        key = owned_product_image_key(settings, url, tenant_id)
        if key is not None:
            keys.append(key)

    qr_rows = (
        await db.execute(
            select(
                QrMenuConfig.branch_id,
                QrMenuConfig.logo_url,
                QrMenuConfig.cover_image_url,
            ).where(QrMenuConfig.tenant_id == tenant_id)
        )
    ).all()
    for branch_id, logo_url, cover_url in qr_rows:
        for url, kind in ((logo_url, "logo"), (cover_url, "cover")):
            key = owned_qr_menu_image_key(settings, url, tenant_id, branch_id, kind)  # type: ignore[arg-type]
            if key is not None:
                keys.append(key)

    return sorted(set(keys))


async def delete_tenant_records(db: AsyncSession, tenant_id: UUID) -> dict[str, int]:
    """Remove every row this business owns, then the business itself.

    Runs inside the caller's transaction and never commits: the route commits
    once, so a failure part-way through rolls the whole thing back and leaves
    the business exactly as it was.
    """
    deleted: dict[str, int] = {}

    for table in tenant_scoped_tables():
        for column in _self_referencing_columns(table):
            await db.execute(
                update(table)
                .where(table.c[TENANT_COLUMN] == tenant_id, table.c[column].is_not(None))
                .values(**{column: None})
            )

        result = await db.execute(delete(table).where(table.c[TENANT_COLUMN] == tenant_id))
        count = _row_count(result)
        if count:
            deleted[table.name] = count

    tenant_result = await db.execute(delete(Tenant).where(Tenant.id == tenant_id))
    deleted[Tenant.__tablename__] = _row_count(tenant_result)
    return deleted


async def purge_tenant_media(storage: MediaStorage, keys: list[str]) -> int:
    """Best-effort removal of the stored images, after the rows are already gone.

    Object storage has no transaction to join, so this runs last and never
    raises: a leftover object is a cleanup chore, whereas a raised error here
    would report a completed deletion as a failure.
    """
    removed = 0
    for key in keys:
        try:
            await storage.delete_object(key)
        except MediaObjectNotFound:
            continue
        except MediaStorageError as exc:
            logger.warning(
                "tenant.media_cleanup_failed",
                object_key=key,
                error=type(exc).__name__,
            )
            continue
        removed += 1
    return removed
