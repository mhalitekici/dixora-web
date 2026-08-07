from __future__ import annotations

from tests.conftest import ApiContext, auth_headers, login


async def test_super_admin_can_read_platform_audit_logs(api: ApiContext) -> None:
    super_admin = await login(
        api,
        username="superadmin@dixora.app",
        password="Dixora!2026",
        business=None,
    )

    response = await api.client.get(
        "/api/v1/audit-logs",
        params={"limit": 250},
        headers=auth_headers(super_admin),
    )

    assert response.status_code == 200, response.text
    assert isinstance(response.json(), list)
