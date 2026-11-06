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


@pytest.mark.parametrize("bootstrap", [False, True])
def test_operator_migration_preserves_hosted_shift_and_allows_personal_till(
    bootstrap: bool,
) -> None:
    path = Path(__file__).parents[1] / "alembic/versions/0045_operator_panels.py"
    spec = importlib.util.spec_from_file_location("operator_migration", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as db:
        mode = ", mode VARCHAR(12) NOT NULL DEFAULT 'support'" if bootstrap else ""
        db.execute(
            sa.text(f"CREATE TABLE operation_grants (id TEXT PRIMARY KEY, panel TEXT{mode})")
        )
        db.execute(sa.text("INSERT INTO operation_grants (id,panel) VALUES ('old','cashier')"))
        db.execute(
            sa.text(
                "CREATE TABLE cashier_shifts (id TEXT PRIMARY KEY, tenant_id TEXT, "
                "branch_id TEXT, user_id TEXT, opened_by_user_id TEXT, "
                "status TEXT, opening_cash TEXT)"
            )
        )
        db.execute(
            sa.text(
                "CREATE UNIQUE INDEX uq_cashier_shift_open_actor ON cashier_shifts "
                "(tenant_id,branch_id,opened_by_user_id) WHERE status = 'OPEN'"
            )
        )
        db.execute(
            sa.text(
                "CREATE UNIQUE INDEX uq_cashier_shift_open_cashier ON cashier_shifts "
                "(tenant_id,branch_id,user_id) WHERE status = 'OPEN'"
            )
        )
        db.execute(
            sa.text(
                "INSERT INTO cashier_shifts VALUES "
                "('legacy','tenant','branch','cashier','owner','OPEN','123.45')"
            )
        )
        previous = db.execute(sa.text("SELECT * FROM cashier_shifts")).all()
        module.op = Operations(MigrationContext.configure(db))
        module.upgrade()
        module.upgrade()
        assert db.execute(sa.text("SELECT * FROM cashier_shifts")).all() == previous
        assert (
            db.execute(sa.text("SELECT mode FROM operation_grants WHERE id='old'")).scalar_one()
            == "support"
        )
        db.execute(
            sa.text(
                "INSERT INTO cashier_shifts VALUES "
                "('own','tenant','branch','owner','owner','OPEN','0')"
            )
        )
        for cashier in ["owner", "cashier2"]:
            with pytest.raises(sa.exc.IntegrityError), db.begin_nested():
                db.execute(
                    sa.text(
                        "INSERT INTO cashier_shifts VALUES "
                        "('duplicate','tenant','branch',:cashier,'owner','OPEN','0')"
                    ),
                    {"cashier": cashier},
                )
    engine.dispose()
