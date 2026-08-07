from datetime import UTC, datetime, timedelta, timezone

from sqlalchemy import DateTime
from sqlalchemy.dialects.postgresql import dialect as postgresql_dialect

from app.models import Base
from app.models.base import UTCDateTime


def test_all_model_datetimes_use_utc_storage_adapter() -> None:
    datetime_columns = [
        column
        for table in Base.metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, (DateTime, UTCDateTime))
    ]

    assert datetime_columns
    assert all(isinstance(column.type, UTCDateTime) for column in datetime_columns)


def test_utc_datetime_normalizes_values_at_database_boundary() -> None:
    column_type = UTCDateTime()
    dialect = postgresql_dialect()
    local_value = datetime(2026, 8, 1, 13, 30, tzinfo=timezone(timedelta(hours=3)))

    stored_value = column_type.process_bind_param(local_value, dialect)
    loaded_value = column_type.process_result_value(stored_value, dialect)

    assert stored_value == datetime(2026, 8, 1, 10, 30)
    assert loaded_value == datetime(2026, 8, 1, 10, 30, tzinfo=UTC)
