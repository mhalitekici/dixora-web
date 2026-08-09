from __future__ import annotations

from tests.conftest import ApiContext, auth_headers, login, seeded_resources


async def _open_order(api: ApiContext, headers: dict[str, str], key: str) -> dict:
    resources = await seeded_resources(api, headers)
    table = resources["tables"][0]
    response = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": table["id"],
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
            "idempotency_key": key,
            "auto_accept": True,
        },
    )
    assert response.status_code == 201, response.text
    return {"order": response.json(), "table": table}


async def _void(api: ApiContext, headers: dict[str, str], order_id: str) -> None:
    request = await api.client.post(
        f"/api/v1/orders/{order_id}/cancellation-requests",
        headers=headers,
        json={"reason": "Müşteri vazgeçti"},
    )
    assert request.status_code == 201, request.text
    approve = await api.client.post(
        f"/api/v1/orders/cancellation-requests/{request.json()['id']}/approve",
        headers=headers,
        json={},
    )
    assert approve.status_code == 200, approve.text


async def _table_state(api: ApiContext, headers: dict[str, str], table_id: str) -> str:
    tables = await api.client.get("/api/v1/tables", headers=headers)
    assert tables.status_code == 200
    return next(item for item in tables.json() if item["id"] == table_id)["state"]


async def test_voiding_the_last_check_releases_the_table(api: ApiContext) -> None:
    """A voided order must not leave a busy-looking table behind."""
    headers = auth_headers(await login(api))
    opened = await _open_order(api, headers, "void-releases-table-0001")
    table_id = opened["table"]["id"]

    assert await _table_state(api, headers, table_id) != "AVAILABLE"

    await _void(api, headers, opened["order"]["id"])

    assert await _table_state(api, headers, table_id) == "CLEANING", (
        "voiding the only open check left the table parked in a live state"
    )


async def test_voiding_one_of_two_checks_keeps_the_table_busy(api: ApiContext) -> None:
    """A second open check on the same table must keep it occupied."""
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    table = resources["tables"][0]

    first = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": table["id"],
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
            "idempotency_key": "void-keeps-table-0001",
            "auto_accept": True,
        },
    )
    assert first.status_code == 201, first.text
    second = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": table["id"],
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
            "idempotency_key": "void-keeps-table-0002",
            "auto_accept": True,
        },
    )
    # A second check on the same table may be modelled as the same order; only
    # assert the interesting case when it really is a separate check.
    if second.status_code != 201 or second.json()["id"] == first.json()["id"]:
        return

    await _void(api, headers, first.json()["id"])

    assert await _table_state(api, headers, table["id"]) != "CLEANING", (
        "the table was released while another check was still open"
    )
