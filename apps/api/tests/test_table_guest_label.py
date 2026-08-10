from __future__ import annotations

from tests.conftest import ApiContext, auth_headers, login, seeded_resources


async def _first_table(api: ApiContext, headers: dict[str, str]) -> dict:
    resources = await seeded_resources(api, headers)
    return resources["tables"][0]


async def test_waiter_can_label_and_clear_a_table(api: ApiContext) -> None:
    """Front-of-house staff name the party at the table, e.g. "B1 · Ahmet"."""
    headers = auth_headers(await login(api, username="waiter@dixora.test"))
    table = await _first_table(api, headers)

    labelled = await api.client.patch(
        f"/api/v1/tables/{table['id']}/guest-label",
        headers=headers,
        json={"guest_label": "Ahmet"},
    )
    assert labelled.status_code == 200, labelled.text
    assert labelled.json()["guest_label"] == "Ahmet"

    listed = await api.client.get("/api/v1/tables", headers=headers)
    assert next(t for t in listed.json() if t["id"] == table["id"])["guest_label"] == "Ahmet"

    cleared = await api.client.patch(
        f"/api/v1/tables/{table['id']}/guest-label",
        headers=headers,
        json={"guest_label": ""},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["guest_label"] is None


async def test_labelling_requires_access_to_the_table_branch(api: ApiContext) -> None:
    """A leaked table id from another branch must not be labellable."""
    headers = auth_headers(await login(api, username="cashier@dixora.test"))
    response = await api.client.patch(
        "/api/v1/tables/00000000-0000-0000-0000-0000000000ab/guest-label",
        headers=headers,
        json={"guest_label": "Sızıntı"},
    )
    assert response.status_code == 404


async def test_label_is_length_limited(api: ApiContext) -> None:
    headers = auth_headers(await login(api, username="waiter@dixora.test"))
    table = await _first_table(api, headers)
    response = await api.client.patch(
        f"/api/v1/tables/{table['id']}/guest-label",
        headers=headers,
        json={"guest_label": "x" * 200},
    )
    assert response.status_code == 422
