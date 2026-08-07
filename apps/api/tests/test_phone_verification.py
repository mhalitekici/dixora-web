from __future__ import annotations

import json
import re
from uuid import uuid4

import httpx
import pytest

from app.config import Settings
from app.errors import DomainError
from app.services.phone_verification import (
    NETGSM_OTP_URL,
    DevelopmentPhoneVerificationProvider,
    NetgsmPhoneVerificationProvider,
)


def verification_settings(**overrides: object) -> Settings:
    return Settings(
        environment="test",
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret="test-secret-that-is-at-least-thirty-two-characters",
        print_bridge_key="test-legacy-print-key-with-32-chars",
        **overrides,
    )


async def test_development_provider_returns_explicit_local_code() -> None:
    provider = DevelopmentPhoneVerificationProvider(verification_settings())
    tenant_id, branch_id = uuid4(), uuid4()

    result = await provider.start(
        tenant_id=tenant_id,
        branch_id=branch_id,
        phone="+905551112233",
    )

    assert result.mode == "DEVELOPMENT"
    assert result.development_code is not None
    assert "SMS gönderilmedi" in result.message
    await provider.verify(
        token=result.token,
        code=result.development_code,
        tenant_id=tenant_id,
        branch_id=branch_id,
        phone="+905551112233",
    )


async def test_netgsm_provider_sends_otp_without_exposing_code_in_response() -> None:
    sent: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        sent["url"] = str(request.url)
        sent["authorization"] = request.headers.get("authorization")
        sent["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"jobid": "17377215342605050417149344", "code": "00"},
        )

    provider = NetgsmPhoneVerificationProvider(
        verification_settings(
            loyalty_verification_provider="netgsm",
            netgsm_usercode="8500000000",
            netgsm_password="secret-password",
            netgsm_msgheader="DIXORA",
        ),
        transport=httpx.MockTransport(handler),
    )
    tenant_id, branch_id = uuid4(), uuid4()

    result = await provider.start(
        tenant_id=tenant_id,
        branch_id=branch_id,
        phone="+905551112233",
    )

    assert result.mode == "PROVIDER"
    assert result.development_code is None
    assert sent["url"] == NETGSM_OTP_URL
    assert str(sent["authorization"]).startswith("Basic ")
    payload = sent["payload"]
    assert isinstance(payload, dict)
    assert payload["no"] == "5551112233"
    assert payload["msgheader"] == "DIXORA"
    code_match = re.search(r"(\d{6})$", str(payload["msg"]))
    assert code_match is not None
    await provider.verify(
        token=result.token,
        code=code_match.group(1),
        tenant_id=tenant_id,
        branch_id=branch_id,
        phone="+905551112233",
    )


async def test_netgsm_provider_maps_provider_failure_without_leaking_details() -> None:
    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": "60", "description": "no package"})

    provider = NetgsmPhoneVerificationProvider(
        verification_settings(
            loyalty_verification_provider="netgsm",
            netgsm_usercode="8500000000",
            netgsm_password="secret-password",
            netgsm_msgheader="DIXORA",
        ),
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(DomainError) as error:
        await provider.start(
            tenant_id=uuid4(),
            branch_id=uuid4(),
            phone="+905551112233",
        )

    assert error.value.code == "verification_delivery_failed"
