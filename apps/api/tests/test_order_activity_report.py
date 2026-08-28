"""The admin feed: who put each order through, and how."""

from __future__ import annotations

from uuid import uuid4

from tests.conftest import ApiContext, auth_headers, login, seeded_resources


async def test_the_feed_names_the_channel_the_table_and_the_operator(
    api: ApiContext,
) -> None:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    table = resources["tables"][0]
    created = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": table["id"],
            "items": [{"product_id": resources["burger"]["id"], "quantity": "2"}],
            "idempotency_key": f"activity-{uuid4().hex}",
            "auto_accept": True,
        },
    )
    assert created.status_code == 201, created.text

    response = await api.client.get("/api/v1/reports/order-activity", headers=headers)
    assert response.status_code == 200, response.text
    row = next(
        item for item in response.json() if item["order_id"] == created.json()["id"]
    )
    assert row["table_name"] == table["name"]
    assert row["source"] in {"WAITER", "CASHIER"}
    # A staff-entered order must name the operator; that is the whole report.
    assert row["staff_name"]
    assert row["member_code"] is None
    assert row["delivery_channel"] is None


async def test_a_package_order_reports_its_channel_and_customer(
    api: ApiContext,
) -> None:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    created = await api.client.post(
        "/api/v1/delivery",
        headers=headers,
        json={
            "channel": "PHONE",
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
            "idempotency_key": f"activity-pkg-{uuid4().hex}",
            "customer_name": "Ahmet Yılmaz",
            "customer_phone": "0555 111 22 33",
        },
    )
    assert created.status_code == 201, created.text

    response = await api.client.get("/api/v1/reports/order-activity", headers=headers)
    row = next(
        item
        for item in response.json()
        if item["order_id"] == created.json()["order_id"]
    )
    assert row["delivery_channel"] == "PHONE"
    assert row["customer_name"] == "Ahmet Yılmaz"
    # Package orders have no table, and the report says so rather than guessing.
    assert row["table_name"] is None


async def test_the_feed_never_leaks_another_business(api: ApiContext) -> None:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": resources["tables"][1]["id"],
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
            "idempotency_key": f"activity-scope-{uuid4().hex}",
            "auto_accept": True,
        },
    )
    response = await api.client.get("/api/v1/reports/order-activity", headers=headers)
    assert response.status_code == 200
    branches = {row["branch_id"] for row in response.json()}
    allowed = await api.client.get("/api/v1/branches", headers=headers)
    assert branches <= {branch["id"] for branch in allowed.json()}


async def test_an_unknown_branch_filter_is_refused(api: ApiContext) -> None:
    """A browser-supplied branch id must be validated, not trusted."""
    headers = auth_headers(await login(api))
    response = await api.client.get(
        f"/api/v1/reports/order-activity?branch_id={uuid4()}", headers=headers
    )
    assert response.status_code == 403, response.text


async def test_the_range_filter_excludes_orders_outside_it(api: ApiContext) -> None:
    """A range that ends before the order exists must return nothing.

    The bounds arrive as ISO strings while the column is naive UTC; comparing
    the two without normalising silently matched no rows at all.
    """
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    created = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": resources["tables"][2]["id"],
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
            "idempotency_key": f"activity-range-{uuid4().hex}",
            "auto_accept": True,
        },
    )
    assert created.status_code == 201, created.text
    order_id = created.json()["id"]

    inside = await api.client.get(
        "/api/v1/reports/order-activity"
        "?date_from=2020-01-01T00:00:00&date_to=2999-01-01T00:00:00",
        headers=headers,
    )
    assert inside.status_code == 200, inside.text
    assert order_id in {row["order_id"] for row in inside.json()}

    outside = await api.client.get(
        "/api/v1/reports/order-activity"
        "?date_from=2020-01-01T00:00:00&date_to=2020-01-02T00:00:00",
        headers=headers,
    )
    assert outside.status_code == 200, outside.text
    assert order_id not in {row["order_id"] for row in outside.json()}


async def test_an_offset_aware_bound_is_normalised(api: ApiContext) -> None:
    """A browser sends a zoned timestamp; it must still match stored rows."""
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    created = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": resources["tables"][3]["id"],
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
            "idempotency_key": f"activity-tz-{uuid4().hex}",
            "auto_accept": True,
        },
    )
    response = await api.client.get(
        "/api/v1/reports/order-activity"
        "?date_from=2020-01-01T00:00:00%2B03:00&date_to=2999-01-01T00:00:00%2B03:00",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert created.json()["id"] in {row["order_id"] for row in response.json()}
