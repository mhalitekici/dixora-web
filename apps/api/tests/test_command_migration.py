from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


@pytest.mark.parametrize("bootstrap_has_columns", [False, True])
def test_fingerprint_migration_preserves_existing_rows_and_accepts_bootstrap_metadata(
    bootstrap_has_columns: bool,
) -> None:
    path = Path(__file__).parents[1] / "alembic/versions/0040_command_fingerprints.py"
    spec = importlib.util.spec_from_file_location("command_migration", path)
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        for table in ("orders", "print_jobs", "qr_order_requests"):
            extra = ", request_hash VARCHAR(64)" if bootstrap_has_columns else ""
            connection.execute(sa.text(f"CREATE TABLE {table} (id TEXT PRIMARY KEY{extra})"))
            connection.execute(sa.text(f"INSERT INTO {table} (id) VALUES ('historical')"))
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.upgrade()
        for table in ("orders", "print_jobs", "qr_order_requests"):
            columns = {
                column["name"]: column for column in sa.inspect(connection).get_columns(table)
            }
            assert columns["request_hash"]["nullable"]
            assert connection.execute(sa.text(f"SELECT id, request_hash FROM {table}")).one() == (
                "historical",
                None,
            )
    engine.dispose()
