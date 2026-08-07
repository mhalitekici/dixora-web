from __future__ import annotations

from tests.conftest import ApiContext, auth_headers, login


async def test_cashier_shift_open_current_close_and_history(api: ApiContext) -> None:
    cashier = await login(api, username="cashier@dixora.test")
    headers = auth_headers(cashier)
    opened = await api.client.post(
        "/api/v1/shifts/open",
        headers=headers,
        json={"opening_cash": "500.00"},
    )
    assert opened.status_code == 201, opened.text
    current = await api.client.get("/api/v1/shifts/current", headers=headers)
    assert current.status_code == 200
    assert current.json()["id"] == opened.json()["id"]
    closed = await api.client.post(
        f"/api/v1/shifts/{opened.json()['id']}/close",
        headers=headers,
        json={"closing_cash": "500.00", "note": "Balanced"},
    )
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "CLOSED"
    assert closed.json()["cash_variance"] == "0.00"
    history = await api.client.get("/api/v1/shifts/history", headers=headers)
    assert history.status_code == 200
    assert history.json()[0]["id"] == opened.json()["id"]
