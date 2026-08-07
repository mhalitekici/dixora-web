from __future__ import annotations

from tests.conftest import ApiContext, auth_headers, login


async def test_area_create_update_and_guarded_archive(api: ApiContext) -> None:
    owner = await login(api)
    headers = auth_headers(owner)

    created = await api.client.post(
        "/api/v1/tables/areas",
        headers=headers,
        json={"name": "Winter Garden", "sort_order": 25},
    )
    assert created.status_code == 201, created.text
    area = created.json()
    duplicate = await api.client.post(
        "/api/v1/tables/areas",
        headers=headers,
        json={"name": "Winter Garden"},
    )
    assert duplicate.status_code == 409, duplicate.text
    assert duplicate.json()["error"]["code"] == "area_name_exists"

    updated = await api.client.patch(
        f"/api/v1/tables/areas/{area['id']}",
        headers=headers,
        json={"name": "Garden Lounge", "sort_order": 26},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Garden Lounge"
    assert updated.json()["sort_order"] == 26

    table = await api.client.post(
        "/api/v1/tables",
        headers=headers,
        json={"area_id": area["id"], "name": "WG1", "capacity": 4},
    )
    assert table.status_code == 201, table.text
    duplicate_table = await api.client.post(
        "/api/v1/tables",
        headers=headers,
        json={"area_id": area["id"], "name": "WG1", "capacity": 2},
    )
    assert duplicate_table.status_code == 409, duplicate_table.text
    assert duplicate_table.json()["error"]["code"] == "table_name_exists"

    blocked = await api.client.delete(
        f"/api/v1/tables/areas/{area['id']}",
        headers=headers,
    )
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["error"]["code"] == "area_not_empty"

    archived_table = await api.client.delete(
        f"/api/v1/tables/{table.json()['id']}",
        headers=headers,
    )
    assert archived_table.status_code == 204, archived_table.text
    archived_area = await api.client.delete(
        f"/api/v1/tables/areas/{area['id']}",
        headers=headers,
    )
    assert archived_area.status_code == 204, archived_area.text

    areas = await api.client.get("/api/v1/tables/areas", headers=headers)
    assert areas.status_code == 200, areas.text
    assert all(item["id"] != area["id"] for item in areas.json())
