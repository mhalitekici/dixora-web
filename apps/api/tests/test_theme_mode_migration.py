"""Revision 0027 has to work on a database that predates the column, and on one
that does not.

The bootstrap revision builds every table from current metadata, so a *fresh*
install already has `theme_mode` by the time 0027 runs, while an existing one
has none of it. Both paths run in production, and getting the guard wrong means
`alembic upgrade head` fails outright — which is exactly how a new deployment
becomes impossible to provision.

The `tenants` table is written out here rather than taken from metadata: the
point is to reproduce the *old* shape, which metadata no longer describes.
"""

from __future__ import annotations

import importlib.util
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "0027_business_theme_mode.py"
)

_BASE_COLUMNS = """
    id CHAR(32) NOT NULL PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    business_type VARCHAR(50) NOT NULL,
    state VARCHAR(9) NOT NULL,
    is_active BOOLEAN NOT NULL,
    prevent_negative_stock BOOLEAN NOT NULL,
    default_currency VARCHAR(3) NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
"""


def _load_migration() -> Any:
    """Import the revision by path; `alembic/versions` is not a package."""
    spec = importlib.util.spec_from_file_location("revision_0027", MIGRATION)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def engine(tmp_path: Path) -> Iterator[sa.Engine]:
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'schema.db'}")
    yield engine
    engine.dispose()


def _create_tenants(engine: sa.Engine, *, with_theme_mode: bool) -> None:
    extra = ",\n    theme_mode VARCHAR(6) NOT NULL DEFAULT 'SYSTEM'"
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                f"CREATE TABLE tenants ({_BASE_COLUMNS}"
                f"{extra if with_theme_mode else ''})"
            )
        )


def _insert_business(engine: sa.Engine, identifier: str) -> None:
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO tenants (id, name, slug, business_type, state,"
                " is_active, prevent_negative_stock, default_currency,"
                " created_at, updated_at) VALUES (:id, 'Eski Isletme', :id,"
                " 'RESTAURANT', 'ACTIVE', 1, 1, 'TRY', '2026-01-01',"
                " '2026-01-01')"
            ),
            {"id": identifier},
        )


def _theme_columns(engine: sa.Engine) -> list[dict[str, Any]]:
    with engine.connect() as connection:
        return [
            column
            for column in sa.inspect(connection).get_columns("tenants")
            if column["name"] == "theme_mode"
        ]


def _run(engine: sa.Engine, direction: str) -> None:
    module = _load_migration()
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            getattr(module, direction)()


def test_the_upgrade_adds_the_column_to_an_older_database(engine: sa.Engine) -> None:
    _create_tenants(engine, with_theme_mode=False)

    _run(engine, "upgrade")

    column = _theme_columns(engine)[0]
    assert column["nullable"] is False


def test_existing_businesses_are_backfilled_to_the_old_behaviour(
    engine: sa.Engine,
) -> None:
    """A row written before the column existed must come out as SYSTEM.

    Anything else would silently change how live QR menus look the moment the
    migration lands.
    """
    _create_tenants(engine, with_theme_mode=False)
    _insert_business(engine, "legacy")

    _run(engine, "upgrade")

    with engine.connect() as connection:
        stored = connection.execute(
            sa.text("SELECT theme_mode FROM tenants WHERE id = 'legacy'")
        ).scalar_one()
    assert stored == "SYSTEM"


def test_the_upgrade_is_a_no_op_where_the_bootstrap_already_made_the_column(
    engine: sa.Engine,
) -> None:
    """A fresh install runs this revision against a table that already has it."""
    _create_tenants(engine, with_theme_mode=True)

    _run(engine, "upgrade")

    assert len(_theme_columns(engine)) == 1


def test_the_downgrade_removes_the_column_again(engine: sa.Engine) -> None:
    _create_tenants(engine, with_theme_mode=True)

    _run(engine, "downgrade")

    assert not _theme_columns(engine)


def test_the_downgrade_is_a_no_op_when_the_column_is_already_gone(
    engine: sa.Engine,
) -> None:
    _create_tenants(engine, with_theme_mode=False)

    _run(engine, "downgrade")

    assert not _theme_columns(engine)
