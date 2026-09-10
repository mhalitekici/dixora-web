from datetime import UTC, datetime

from app.services.receipts import branch_business_date


def test_branch_business_day_uses_local_midnight() -> None:
    assert (
        branch_business_date(
            datetime(2026, 9, 7, 20, 59, tzinfo=UTC), "Europe/Istanbul"
        ).isoformat()
        == "2026-09-07"
    )
    assert (
        branch_business_date(datetime(2026, 9, 7, 21, 0, tzinfo=UTC), "Europe/Istanbul").isoformat()
        == "2026-09-08"
    )
