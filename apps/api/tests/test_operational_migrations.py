from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


@pytest.mark.parametrize("bootstrap", [False, True])
@pytest.mark.parametrize(
    "revision,table,columns",
    [
        ("0041_role_operational_profile", "roles", {"operational_profile": 24}),
        ("0043_delivery_city_fingerprint", "delivery_orders", {"city": 120, "request_hash": 64}),
    ],
)
def test_nullable_migrations_preserve_existing_records(
    bootstrap: bool,
    revision: str,
    table: str,
    columns: dict[str, int],
) -> None:
    path = Path(__file__).parents[1] / f"alembic/versions/{revision}.py"
    spec = importlib.util.spec_from_file_location(revision, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        extra = (
            "".join(f", {name} VARCHAR({size})" for name, size in columns.items())
            if bootstrap
            else ""
        )
        connection.execute(sa.text(f"CREATE TABLE {table} (id TEXT PRIMARY KEY{extra})"))
        connection.execute(sa.text(f"INSERT INTO {table} (id) VALUES ('historical')"))
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade()
        module.upgrade()
        result = connection.execute(sa.text(f"SELECT * FROM {table}")).one()
        assert tuple(result) == ("historical", *([None] * len(columns)))
    engine.dispose()
