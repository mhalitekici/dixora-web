from __future__ import annotations

from app.models import SubscriptionPlan


def test_plan_pricing_columns_carry_server_defaults() -> None:
    """Columns added to an existing table must default in the database itself.

    Regression: `included_branches` and `additional_branch_price` were NOT NULL
    with only a Python-side default. Historical migration 0003 inserts the
    STANDARD plan without naming them, so a fresh database failed to migrate —
    new deployments could not be provisioned at all.
    """
    table = SubscriptionPlan.__table__
    for name in ("included_branches", "additional_branch_price"):
        column = table.columns[name]
        assert not column.nullable, f"{name} should stay NOT NULL"
        assert column.server_default is not None, (
            f"{name} is NOT NULL without a server default; an INSERT that omits "
            "it (as older migrations do) will fail on a fresh database"
        )
