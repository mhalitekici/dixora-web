from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from app.models import AuditLog, AuthSession, Tenant, User
from app.security import verify_password
from tests.conftest import ApiContext, auth_headers, login

NEW_PASSWORD = "Str0ng-New-Passw0rd!"


async def test_user_can_change_own_password(api: ApiContext) -> None:
    session = await login(api, username="cashier@dixora.test")
    headers = auth_headers(session)

    response = await api.client.post(
        "/api/v1/auth/password",
        headers=headers,
        json={"current_password": "DixoraLab!2026", "new_password": NEW_PASSWORD},
    )
    assert response.status_code == 204, response.text

    # Old password no longer works, new one does.
    stale = await api.client.post(
        "/api/v1/auth/login",
        json={
            "business": "dixora-lab",
            "username": "cashier@dixora.test",
            "password": "DixoraLab!2026",
        },
    )
    assert stale.status_code == 401

    fresh = await api.client.post(
        "/api/v1/auth/login",
        json={
            "business": "dixora-lab",
            "username": "cashier@dixora.test",
            "password": NEW_PASSWORD,
        },
    )
    assert fresh.status_code == 200, fresh.text


async def test_password_change_rejects_wrong_current_password(api: ApiContext) -> None:
    session = await login(api, username="cashier@dixora.test")
    headers = auth_headers(session)

    response = await api.client.post(
        "/api/v1/auth/password",
        headers=headers,
        json={"current_password": "definitely-not-it", "new_password": NEW_PASSWORD},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_current_password"

    async with api.database.session_factory() as db:
        user = (
            await db.execute(select(User).where(User.username == "cashier@dixora.test"))
        ).scalar_one()
        # Password is untouched by the failed attempt.
        assert verify_password("DixoraLab!2026", user.password_hash)


async def test_password_change_revokes_other_sessions_but_keeps_current(
    api: ApiContext,
) -> None:
    first = await login(api, username="cashier@dixora.test")
    second = await login(api, username="cashier@dixora.test")

    response = await api.client.post(
        "/api/v1/auth/password",
        headers=auth_headers(second),
        json={"current_password": "DixoraLab!2026", "new_password": NEW_PASSWORD},
    )
    assert response.status_code == 204, response.text

    # The session that performed the change still works...
    still_valid = await api.client.get("/api/v1/auth/me", headers=auth_headers(second))
    assert still_valid.status_code == 200

    # ...the other one is revoked.
    async with api.database.session_factory() as db:
        user = (
            await db.execute(select(User).where(User.username == "cashier@dixora.test"))
        ).scalar_one()
        sessions = (
            (await db.execute(select(AuthSession).where(AuthSession.user_id == user.id)))
            .scalars()
            .all()
        )
        revoked = [s for s in sessions if s.revoked_at is not None]
        assert revoked, "the older session should have been revoked"

    stale_refresh = await api.client.post(
        "/api/v1/auth/refresh", json={"refresh_token": first["refresh_token"]}
    )
    assert stale_refresh.status_code == 401


async def test_password_never_appears_in_audit_log(api: ApiContext) -> None:
    session = await login(api, username="cashier@dixora.test")
    await api.client.post(
        "/api/v1/auth/password",
        headers=auth_headers(session),
        json={"current_password": "DixoraLab!2026", "new_password": NEW_PASSWORD},
    )
    async with api.database.session_factory() as db:
        rows = (
            (await db.execute(select(AuditLog).where(AuditLog.action == "user.password_changed")))
            .scalars()
            .all()
        )
        assert rows, "password change must be audited"
        serialized = " ".join(
            f"{row.previous_value} {row.new_value} {row.reason}" for row in rows
        )
        assert NEW_PASSWORD not in serialized
        assert "DixoraLab!2026" not in serialized


async def _business_and_user(api: ApiContext) -> tuple[UUID, UUID]:
    async with api.database.session_factory() as db:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))
        ).scalar_one()
        user = (
            await db.execute(select(User).where(User.username == "cashier@dixora.test"))
        ).scalar_one()
        return tenant.id, user.id


async def test_super_admin_resets_business_user_password(api: ApiContext) -> None:
    tenant_id, user_id = await _business_and_user(api)
    victim = await login(api, username="cashier@dixora.test")
    platform = await login(
        api,
        username="superadmin@dixora.app",
        password="Dixora!2026",
        business=None,
    )

    response = await api.client.post(
        f"/api/v1/businesses/{tenant_id}/users/{user_id}/password-reset",
        headers=auth_headers(platform),
        json={"new_password": NEW_PASSWORD, "reason": "Destek talebi DX-42"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user_id"] == str(user_id)
    # The response must never echo the password back.
    assert NEW_PASSWORD not in response.text

    # Existing sessions are revoked.
    stale = await api.client.post(
        "/api/v1/auth/refresh", json={"refresh_token": victim["refresh_token"]}
    )
    assert stale.status_code == 401

    # The new password works.
    fresh = await api.client.post(
        "/api/v1/auth/login",
        json={
            "business": "dixora-lab",
            "username": "cashier@dixora.test",
            "password": NEW_PASSWORD,
        },
    )
    assert fresh.status_code == 200, fresh.text


async def test_business_owner_cannot_reset_via_platform_endpoint(api: ApiContext) -> None:
    tenant_id, user_id = await _business_and_user(api)
    owner = await login(api, username="owner@dixora.test")

    response = await api.client.post(
        f"/api/v1/businesses/{tenant_id}/users/{user_id}/password-reset",
        headers=auth_headers(owner),
        json={"new_password": NEW_PASSWORD},
    )
    assert response.status_code == 403


async def test_platform_reset_rejects_cross_tenant_user_pairing(api: ApiContext) -> None:
    """A user id from another business must not be resettable under this one."""
    platform = await login(
        api,
        username="superadmin@dixora.app",
        password="Dixora!2026",
        business=None,
    )
    async with api.database.session_factory() as db:
        tenants = (await db.execute(select(Tenant))).scalars().all()
        target_tenant = next(t for t in tenants if t.slug == "dixora-lab")
        foreign_user = (
            await db.execute(select(User).where(User.tenant_id != target_tenant.id))
        ).scalars().first()

    if foreign_user is None:
        # Only one tenant seeded; assert the guard with a random UUID instead.
        response = await api.client.post(
            f"/api/v1/businesses/{target_tenant.id}/users/"
            "00000000-0000-0000-0000-000000000123/password-reset",
            headers=auth_headers(platform),
            json={"new_password": NEW_PASSWORD},
        )
        assert response.status_code == 404
        return

    response = await api.client.post(
        f"/api/v1/businesses/{target_tenant.id}/users/{foreign_user.id}/password-reset",
        headers=auth_headers(platform),
        json={"new_password": NEW_PASSWORD},
    )
    assert response.status_code == 404


async def test_platform_reset_is_audited_without_the_password(api: ApiContext) -> None:
    tenant_id, user_id = await _business_and_user(api)
    platform = await login(
        api,
        username="superadmin@dixora.app",
        password="Dixora!2026",
        business=None,
    )
    await api.client.post(
        f"/api/v1/businesses/{tenant_id}/users/{user_id}/password-reset",
        headers=auth_headers(platform),
        json={"new_password": NEW_PASSWORD, "reason": "Destek talebi DX-42"},
    )
    async with api.database.session_factory() as db:
        row = (
            (
                await db.execute(
                    select(AuditLog)
                    .where(AuditLog.action == "user.password_reset")
                    .order_by(AuditLog.created_at.desc())
                )
            )
            .scalars()
            .first()
        )
        assert row is not None
        assert row.reason == "Destek talebi DX-42"
        assert NEW_PASSWORD not in f"{row.previous_value} {row.new_value} {row.reason}"
