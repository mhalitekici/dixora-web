from __future__ import annotations

import hashlib
from datetime import timedelta
from uuid import UUID

import jwt
from sqlalchemy import select

from app.models import AuthSession, Branch, RealtimeTicket, TrustedDevice
from app.security import trusted_device_token_hash, utcnow
from tests.conftest import ApiContext, auth_headers, login


async def test_login_me_refresh_rotation_and_reuse_revocation(api: ApiContext) -> None:
    tokens = await login(api)
    assert tokens["user"]["role"] == "BUSINESS_OWNER"
    assert tokens["user"]["tenant_id"]
    assert tokens["user"]["branch_id"]
    assert "orders.create" in tokens["user"]["permissions"]

    me = await api.client.get("/api/v1/auth/me", headers=auth_headers(tokens))
    assert me.status_code == 200
    assert me.json()["username"] == "owner@dixora.test"
    assert me.json()["tenant"]["slug"] == "dixora-lab"
    assert me.json()["branch"]["slug"] == "merkez"

    rotated = await api.client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert rotated.status_code == 200
    assert rotated.json()["refresh_token"] != tokens["refresh_token"]

    replay = await api.client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "refresh_token_reuse"

    revoked_access = await api.client.get(
        "/api/v1/auth/me",
        headers=auth_headers(rotated.json()),
    )
    assert revoked_access.status_code == 401


async def test_remember_me_controls_refresh_policy_and_survives_rotation(
    api: ApiContext,
) -> None:
    session_login = await api.client.post(
        "/api/v1/auth/login",
        json={
            "business": "dixora-lab",
            "username": "owner@dixora.test",
            "password": "DixoraLab!2026",
            "remember_me": False,
        },
    )
    remembered_login = await api.client.post(
        "/api/v1/auth/login",
        json={
            "business": "dixora-lab",
            "username": "owner@dixora.test",
            "password": "DixoraLab!2026",
            "remember_me": True,
        },
    )

    assert session_login.status_code == 200
    assert remembered_login.status_code == 200
    assert session_login.json()["remember_me"] is False
    assert session_login.json()["refresh_expires_in"] == (
        api.settings.session_refresh_token_hours * 60 * 60
    )
    assert remembered_login.json()["remember_me"] is True
    assert remembered_login.json()["refresh_expires_in"] == (
        api.settings.refresh_token_days * 24 * 60 * 60
    )

    remembered_claims = jwt.decode(
        remembered_login.json()["refresh_token"],
        api.settings.jwt_secret.get_secret_value(),
        algorithms=[api.settings.jwt_algorithm],
        audience="dixora-app",
        issuer="dixora-api",
    )
    assert remembered_claims["remember_me"] is True

    rotated = await api.client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": remembered_login.json()["refresh_token"]},
    )
    assert rotated.status_code == 200
    assert rotated.json()["remember_me"] is True
    assert rotated.json()["refresh_expires_in"] == (
        api.settings.refresh_token_days * 24 * 60 * 60
    )


async def test_owner_can_list_and_switch_accessible_branches_with_family_rotation(
    api: ApiContext,
) -> None:
    login_response = await api.client.post(
        "/api/v1/auth/login",
        json={
            "business": "dixora-lab",
            "username": "owner@dixora.test",
            "password": "DixoraLab!2026",
            "remember_me": True,
        },
    )
    assert login_response.status_code == 200
    tokens = login_response.json()
    tenant_id = UUID(tokens["user"]["tenant_id"])
    async with api.database.session_factory() as db:
        second_branch = Branch(
            tenant_id=tenant_id,
            name="Kadıköy",
            slug="kadikoy",
            timezone="Europe/Istanbul",
            is_active=True,
        )
        db.add(second_branch)
        await db.commit()
        second_branch_id = second_branch.id

    available = await api.client.get(
        "/api/v1/auth/branches",
        headers=auth_headers(tokens),
    )
    assert available.status_code == 200
    assert available.json()["can_switch"] is True
    assert {branch["id"] for branch in available.json()["branches"]} == {
        tokens["user"]["branch_id"],
        str(second_branch_id),
    }

    old_claims = jwt.decode(
        tokens["access_token"],
        api.settings.jwt_secret.get_secret_value(),
        algorithms=[api.settings.jwt_algorithm],
        audience="dixora-app",
        issuer="dixora-api",
    )
    switched = await api.client.post(
        "/api/v1/auth/switch-branch",
        json={
            "refresh_token": tokens["refresh_token"],
            "branch_id": str(second_branch_id),
        },
    )
    assert switched.status_code == 200, switched.text
    switched_tokens = switched.json()
    assert switched_tokens["remember_me"] is True
    assert switched_tokens["user"]["branch_id"] == str(second_branch_id)
    new_claims = jwt.decode(
        switched_tokens["access_token"],
        api.settings.jwt_secret.get_secret_value(),
        algorithms=[api.settings.jwt_algorithm],
        audience="dixora-app",
        issuer="dixora-api",
    )
    assert new_claims["family"] != old_claims["family"]
    assert new_claims["tenant_id"] == str(tenant_id)
    assert new_claims["branch_id"] == str(second_branch_id)

    old_access = await api.client.get(
        "/api/v1/auth/me",
        headers=auth_headers(tokens),
    )
    assert old_access.status_code == 401
    stale_refresh = await api.client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert stale_refresh.status_code == 401

    current = await api.client.get(
        "/api/v1/auth/me",
        headers=auth_headers(switched_tokens),
    )
    assert current.status_code == 200
    assert current.json()["branch"]["slug"] == "kadikoy"
    rotated = await api.client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": switched_tokens["refresh_token"]},
    )
    assert rotated.status_code == 200
    assert rotated.json()["user"]["branch_id"] == str(second_branch_id)
    assert rotated.json()["remember_me"] is True


async def test_branch_restricted_user_cannot_switch_or_enumerate_other_branches(
    api: ApiContext,
) -> None:
    owner_tokens = await login(api)
    tenant_id = UUID(owner_tokens["user"]["tenant_id"])
    async with api.database.session_factory() as db:
        second_branch = Branch(
            tenant_id=tenant_id,
            name="Beşiktaş",
            slug="besiktas",
            timezone="Europe/Istanbul",
            is_active=True,
        )
        db.add(second_branch)
        await db.commit()
        second_branch_id = second_branch.id

    waiter_tokens = await login(api, username="waiter@dixora.test")
    available = await api.client.get(
        "/api/v1/auth/branches",
        headers=auth_headers(waiter_tokens),
    )
    assert available.status_code == 200
    assert available.json()["can_switch"] is False
    assert len(available.json()["branches"]) == 1
    assert available.json()["branches"][0]["id"] == waiter_tokens["user"]["branch_id"]

    rejected = await api.client.post(
        "/api/v1/auth/switch-branch",
        json={
            "refresh_token": waiter_tokens["refresh_token"],
            "branch_id": str(second_branch_id),
        },
    )
    assert rejected.status_code == 403
    assert rejected.json()["error"]["code"] == "branch_switch_forbidden"

    tenant_injection = await api.client.post(
        "/api/v1/auth/switch-branch",
        json={
            "refresh_token": waiter_tokens["refresh_token"],
            "branch_id": str(second_branch_id),
            "tenant_id": str(tenant_id),
        },
    )
    assert tenant_injection.status_code == 422


async def test_logout_revokes_refresh_session_and_is_idempotent(api: ApiContext) -> None:
    tokens = await login(api)
    claims = jwt.decode(
        tokens["refresh_token"],
        api.settings.jwt_secret.get_secret_value(),
        algorithms=[api.settings.jwt_algorithm],
        audience="dixora-app",
        issuer="dixora-api",
    )

    first = await api.client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": tokens["refresh_token"]},
        headers=auth_headers(tokens),
    )
    second = await api.client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": tokens["refresh_token"]},
        headers=auth_headers(tokens),
    )

    assert first.status_code == 204
    assert second.status_code == 204
    async with api.database.session_factory() as db:
        auth_session = await db.get(AuthSession, UUID(claims["sid"]))
        assert auth_session is not None
        assert auth_session.revoked_at is not None

    rejected = await api.client.get(
        "/api/v1/auth/me",
        headers=auth_headers(tokens),
    )
    assert rejected.status_code == 401


async def test_seed_pin_login_contract(api: ApiContext) -> None:
    enrollment = await api.client.post(
        "/api/v1/auth/login",
        json={
            "business": "dixora-lab",
            "username": "owner@dixora.test",
            "password": "DixoraLab!2026",
            "enroll_trusted_device": True,
        },
    )
    assert enrollment.status_code == 200, enrollment.text
    device_token = enrollment.json()["trusted_device"]["token"]

    waiter = await api.client.post(
        "/api/v1/auth/pin-login",
        json={
            "business_slug": "dixora-lab",
            "branch_slug": "merkez",
            "username": "waiter@dixora.test",
            "pin": "2468",
            "device_token": device_token,
        },
    )
    assert waiter.status_code == 200, waiter.text
    assert waiter.json()["user"]["role"] == "WAITER"

    wrong_pin = await api.client.post(
        "/api/v1/auth/pin-login",
        json={
            "business_slug": "dixora-lab",
            "branch_slug": "merkez",
            "username": "cashier@dixora.test",
            "pin": "9999",
            "device_token": device_token,
        },
    )
    assert wrong_pin.status_code == 401


async def test_failed_password_login_never_enrolls_a_trusted_device(
    api: ApiContext,
) -> None:
    failed = await api.client.post(
        "/api/v1/auth/login",
        json={
            "business": "dixora-lab",
            "username": "owner@dixora.test",
            "password": "wrong-password",
            "enroll_trusted_device": True,
        },
    )

    assert failed.status_code == 401
    async with api.database.session_factory() as db:
        enrolled = (
            await db.execute(select(TrustedDevice))
        ).scalars().all()
        assert enrolled == []


async def test_pin_login_requires_active_device_in_same_tenant_and_branch(
    api: ApiContext,
) -> None:
    enrollment = await api.client.post(
        "/api/v1/auth/login",
        json={
            "business": "dixora-lab",
            "username": "owner@dixora.test",
            "password": "DixoraLab!2026",
            "enroll_trusted_device": True,
        },
    )
    assert enrollment.status_code == 200, enrollment.text
    enrollment_body = enrollment.json()
    device_token = enrollment_body["trusted_device"]["token"]
    assert enrollment_body["trusted_device"]["expires_in"] == (
        api.settings.trusted_device_days * 24 * 60 * 60
    )

    tenant_id = UUID(enrollment_body["user"]["tenant_id"])
    device_hash = trusted_device_token_hash(device_token)
    async with api.database.session_factory() as db:
        device = (
            await db.execute(
                select(TrustedDevice).where(
                    TrustedDevice.credential_hash == device_hash
                )
            )
        ).scalar_one()
        assert device.tenant_id == tenant_id
        assert str(device.branch_id) == enrollment_body["user"]["branch_id"]
        assert device.credential_hash != device_token

        foreign_branch = Branch(
            tenant_id=tenant_id,
            name="Yabancı şube",
            slug="yabanci-sube",
            timezone="Europe/Istanbul",
            is_active=True,
        )
        db.add(foreign_branch)
        await db.commit()
        foreign_branch_slug = foreign_branch.slug

    base_payload = {
        "business_slug": "dixora-lab",
        "branch_slug": "merkez",
        "username": "waiter@dixora.test",
        "pin": "2468",
    }
    missing = await api.client.post("/api/v1/auth/pin-login", json=base_payload)
    assert missing.status_code == 403
    assert missing.json()["error"]["code"] == "trusted_device_required"

    foreign = await api.client.post(
        "/api/v1/auth/pin-login",
        json={
            **base_payload,
            "branch_slug": foreign_branch_slug,
            "device_token": device_token,
        },
    )
    assert foreign.status_code == 403
    assert foreign.json()["error"]["code"] == "trusted_device_invalid"

    async with api.database.session_factory() as db:
        device = (
            await db.execute(
                select(TrustedDevice).where(
                    TrustedDevice.credential_hash == device_hash
                )
            )
        ).scalar_one()
        device.expires_at = utcnow() - timedelta(seconds=1)
        await db.commit()
    expired = await api.client.post(
        "/api/v1/auth/pin-login",
        json={**base_payload, "device_token": device_token},
    )
    assert expired.status_code == 403
    assert expired.json()["error"]["code"] == "trusted_device_invalid"

    async with api.database.session_factory() as db:
        device = (
            await db.execute(
                select(TrustedDevice).where(
                    TrustedDevice.credential_hash == device_hash
                )
            )
        ).scalar_one()
        device.expires_at = utcnow() + timedelta(days=1)
        device.revoked_at = utcnow()
        await db.commit()
    revoked = await api.client.post(
        "/api/v1/auth/pin-login",
        json={**base_payload, "device_token": device_token},
    )
    assert revoked.status_code == 403
    assert revoked.json()["error"]["code"] == "trusted_device_invalid"

    async with api.database.session_factory() as db:
        device = (
            await db.execute(
                select(TrustedDevice).where(
                    TrustedDevice.credential_hash == device_hash
                )
            )
        ).scalar_one()
        device.revoked_at = None
        await db.commit()
    accepted = await api.client.post(
        "/api/v1/auth/pin-login",
        json={**base_payload, "device_token": device_token},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["user"]["role"] == "WAITER"


async def test_trusted_device_survives_session_logout(api: ApiContext) -> None:
    enrollment = await api.client.post(
        "/api/v1/auth/login",
        json={
            "business": "dixora-lab",
            "username": "owner@dixora.test",
            "password": "DixoraLab!2026",
            "enroll_trusted_device": True,
        },
    )
    assert enrollment.status_code == 200, enrollment.text
    enrollment_body = enrollment.json()

    logged_out = await api.client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": enrollment_body["refresh_token"]},
        headers=auth_headers(enrollment_body),
    )
    assert logged_out.status_code == 204

    pin_login = await api.client.post(
        "/api/v1/auth/pin-login",
        json={
            "business_slug": "dixora-lab",
            "branch_slug": "merkez",
            "username": "waiter@dixora.test",
            "pin": "2468",
            "device_token": enrollment_body["trusted_device"]["token"],
        },
    )
    assert pin_login.status_code == 200, pin_login.text
    assert pin_login.json()["user"]["role"] == "WAITER"


async def test_pin_login_emergency_switch_fails_closed(api: ApiContext) -> None:
    api.settings.pin_login_enabled = False

    response = await api.client.post(
        "/api/v1/auth/pin-login",
        json={
            "business_slug": "dixora-lab",
            "branch_slug": "merkez",
            "username": "waiter@dixora.test",
            "pin": "2468",
            "device_token": "not-a-real-device",
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "pin_login_disabled"


async def test_password_login_is_rate_limited_per_credential_and_client(api: ApiContext) -> None:
    payload = {
        "business": "dixora-lab",
        "username": "owner@dixora.test",
        "password": "definitely-wrong",
    }
    for _ in range(api.settings.login_rate_limit_attempts):
        failed = await api.client.post("/api/v1/auth/login", json=payload)
        assert failed.status_code == 401

    blocked = await api.client.post(
        "/api/v1/auth/login",
        json={**payload, "password": "DixoraLab!2026"},
    )
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "login_rate_limited"
    assert blocked.json()["error"]["details"]["retry_after_seconds"] == 900


async def test_realtime_ticket_is_short_lived_and_persisted_for_single_use(api: ApiContext) -> None:
    tokens = await login(api)
    response = await api.client.post(
        "/api/v1/auth/realtime-ticket",
        headers=auth_headers(tokens),
    )
    assert response.status_code == 200
    raw_ticket = response.json()["ticket"]
    claims = jwt.decode(
        raw_ticket,
        api.settings.jwt_secret.get_secret_value(),
        algorithms=[api.settings.jwt_algorithm],
        audience="dixora-realtime",
        issuer="dixora-api",
    )
    assert claims["typ"] == "realtime_ticket"
    assert claims["exp"] - claims["iat"] <= 60
    async with api.database.session_factory() as db:
        record = (
            await db.execute(
                select(RealtimeTicket).where(RealtimeTicket.id == UUID(claims["ticket_id"]))
            )
        ).scalar_one()
        assert record.used_at is None
        assert record.nonce_hash == hashlib.sha256(claims["jti"].encode("utf-8")).hexdigest()
