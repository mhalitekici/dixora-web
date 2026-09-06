"""Revision 0028 has to work on a database that predates its columns, and on
one that does not — the same guarantee `test_theme_mode_migration.py` checks
for revision 0027, for the same reason: a fresh install already has these
columns by the time this revision runs, while an existing one has none of
them, and getting the guard wrong breaks `alembic upgrade head` outright.
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
    / "0028_registration_consent_tracking.py"
)

_VERIFICATION_COLUMNS = """
    id CHAR(32) NOT NULL PRIMARY KEY,
    business_name VARCHAR(140) NOT NULL,
    contract_version VARCHAR(40) NOT NULL
"""

_USER_COLUMNS = """
    id CHAR(32) NOT NULL PRIMARY KEY,
    username VARCHAR(100) NOT NULL
"""


def _load_migration() -> Any:
    spec = importlib.util.spec_from_file_location("revision_0028", MIGRATION)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def engine(tmp_path: Path) -> Iterator[sa.Engine]:
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'schema.db'}")
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                f"CREATE TABLE business_registration_verifications ({_VERIFICATION_COLUMNS})"
            )
        )
        connection.execute(sa.text(f"CREATE TABLE users ({_USER_COLUMNS})"))
    yield engine
    engine.dispose()


def _columns(engine: sa.Engine, table: str) -> set[str]:
    with engine.connect() as connection:
        return {column["name"] for column in sa.inspect(connection).get_columns(table)}


def _run(engine: sa.Engine, direction: str) -> None:
    module = _load_migration()
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            getattr(module, direction)()


def test_the_upgrade_adds_both_new_columns_to_an_older_database(
    engine: sa.Engine,
) -> None:
    _run(engine, "upgrade")

    assert {"privacy_notice_version", "marketing_consent"} <= _columns(
        engine, "business_registration_verifications"
    )
    assert "marketing_consent" in _columns(engine, "users")


def test_existing_rows_backfill_to_a_safe_default(engine: sa.Engine) -> None:
    """A row written before these columns existed must not silently opt in."""
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO business_registration_verifications"
                " (id, business_name, contract_version)"
                " VALUES ('legacy', 'Eski Basvuru', 'v1')"
            )
        )
        connection.execute(
            sa.text("INSERT INTO users (id, username) VALUES ('legacy-user', 'eski')")
        )

    _run(engine, "upgrade")

    with engine.connect() as connection:
        version, consent = connection.execute(
            sa.text(
                "SELECT privacy_notice_version, marketing_consent"
                " FROM business_registration_verifications WHERE id = 'legacy'"
            )
        ).one()
        assert version == "unknown"
        assert consent in (0, False)

        user_consent = connection.execute(
            sa.text("SELECT marketing_consent FROM users WHERE id = 'legacy-user'")
        ).scalar_one()
        assert user_consent in (0, False)


def test_the_upgrade_is_a_no_op_where_the_bootstrap_already_made_the_columns(
    engine: sa.Engine,
) -> None:
    _run(engine, "upgrade")
    before = (
        _columns(engine, "business_registration_verifications"),
        _columns(engine, "users"),
    )

    _run(engine, "upgrade")

    assert (
        _columns(engine, "business_registration_verifications"),
        _columns(engine, "users"),
    ) == before


def test_the_downgrade_removes_all_three_columns(engine: sa.Engine) -> None:
    _run(engine, "upgrade")

    _run(engine, "downgrade")

    assert "privacy_notice_version" not in _columns(
        engine, "business_registration_verifications"
    )
    assert "marketing_consent" not in _columns(
        engine, "business_registration_verifications"
    )
    assert "marketing_consent" not in _columns(engine, "users")


def test_the_downgrade_is_a_no_op_when_the_columns_are_already_gone(
    engine: sa.Engine,
) -> None:
    _run(engine, "downgrade")

    assert "marketing_consent" not in _columns(engine, "users")
