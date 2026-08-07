from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol
from uuid import UUID

import httpx

from app.config import Settings
from app.errors import DomainError
from app.services.loyalty import (
    VERIFICATION_TTL_SECONDS,
    create_phone_verification_challenge,
    verify_phone_verification_challenge,
)

NETGSM_OTP_URL = "https://api.netgsm.com.tr/sms/rest/v2/otp"


@dataclass(frozen=True, slots=True)
class VerificationStartResult:
    token: str
    expires_in: int
    mode: Literal["DEVELOPMENT", "PROVIDER"]
    development_code: str | None
    message: str


class PhoneVerificationProvider(Protocol):
    @property
    def mode(self) -> Literal["DEVELOPMENT", "PROVIDER"]: ...

    async def start(
        self, *, tenant_id: UUID, branch_id: UUID, phone: str
    ) -> VerificationStartResult: ...

    async def verify(
        self,
        *,
        token: str,
        code: str,
        tenant_id: UUID,
        branch_id: UUID,
        phone: str,
    ) -> None: ...


class DevelopmentPhoneVerificationProvider:
    """Explicit local-only adapter. It never claims that an SMS was sent."""

    mode: Literal["DEVELOPMENT"] = "DEVELOPMENT"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def start(
        self, *, tenant_id: UUID, branch_id: UUID, phone: str
    ) -> VerificationStartResult:
        token, code = create_phone_verification_challenge(
            self.settings,
            tenant_id=tenant_id,
            branch_id=branch_id,
            phone=phone,
        )
        return VerificationStartResult(
            token=token,
            expires_in=VERIFICATION_TTL_SECONDS,
            mode="DEVELOPMENT",
            development_code=code,
            message="Development verification: kod ekranda gösterildi; SMS gönderilmedi.",
        )

    async def verify(
        self,
        *,
        token: str,
        code: str,
        tenant_id: UUID,
        branch_id: UUID,
        phone: str,
    ) -> None:
        verify_phone_verification_challenge(
            self.settings,
            token=token,
            code=code,
            tenant_id=tenant_id,
            branch_id=branch_id,
            phone=phone,
        )


class NetgsmPhoneVerificationProvider:
    """Netgsm OTP adapter. Codes are verified locally against a signed challenge."""

    mode: Literal["PROVIDER"] = "PROVIDER"

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self.transport = transport

    async def start(
        self, *, tenant_id: UUID, branch_id: UUID, phone: str
    ) -> VerificationStartResult:
        usercode, password, message_header = self._credentials()
        token, code = create_phone_verification_challenge(
            self.settings,
            tenant_id=tenant_id,
            branch_id=branch_id,
            phone=phone,
        )
        number = _netgsm_mobile_number(phone)
        try:
            async with httpx.AsyncClient(
                auth=httpx.BasicAuth(usercode, password),
                timeout=self.settings.netgsm_timeout_seconds,
                transport=self.transport,
            ) as client:
                response = await client.post(
                    NETGSM_OTP_URL,
                    json={
                        "msgheader": message_header,
                        "msg": f"Dixora dogrulama kodunuz: {code}",
                        "no": number,
                    },
                    headers={"accept": "application/json"},
                )
                response.raise_for_status()
        except (httpx.RequestError, httpx.HTTPStatusError) as exc:
            raise DomainError(
                "verification_delivery_unavailable",
                "Doğrulama SMS'i şu anda gönderilemiyor. Lütfen tekrar deneyin.",
                status_code=503,
            ) from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise DomainError(
                "verification_delivery_failed",
                "SMS sağlayıcısından geçersiz yanıt alındı.",
                status_code=502,
            ) from exc
        if not isinstance(payload, dict) or payload.get("code") != "00":
            raise DomainError(
                "verification_delivery_failed",
                "Doğrulama SMS'i gönderilemedi. Lütfen numarayı kontrol edin.",
                status_code=502,
            )
        return VerificationStartResult(
            token=token,
            expires_in=VERIFICATION_TTL_SECONDS,
            mode="PROVIDER",
            development_code=None,
            message="Doğrulama kodu SMS ile gönderildi.",
        )

    async def verify(
        self,
        *,
        token: str,
        code: str,
        tenant_id: UUID,
        branch_id: UUID,
        phone: str,
    ) -> None:
        verify_phone_verification_challenge(
            self.settings,
            token=token,
            code=code,
            tenant_id=tenant_id,
            branch_id=branch_id,
            phone=phone,
        )

    def _credentials(self) -> tuple[str, str, str]:
        password = (
            self.settings.netgsm_password.get_secret_value()
            if self.settings.netgsm_password is not None
            else ""
        )
        if (
            not self.settings.netgsm_usercode
            or not password
            or not self.settings.netgsm_msgheader
        ):
            raise DomainError(
                "verification_provider_unavailable",
                "Telefon doğrulama sağlayıcısı yapılandırılmamış.",
                status_code=503,
            )
        return (
            self.settings.netgsm_usercode,
            password,
            self.settings.netgsm_msgheader,
        )


def _netgsm_mobile_number(phone: str) -> str:
    if not phone.startswith("+90"):
        raise DomainError(
            "verification_phone_not_supported",
            "Netgsm OTP yalnız Türkiye mobil numaralarını destekliyor.",
            status_code=422,
        )
    number = phone[3:]
    if len(number) != 10 or not number.startswith("5") or not number.isdigit():
        raise DomainError(
            "verification_phone_not_supported",
            "Geçerli bir Türkiye mobil numarası girin.",
            status_code=422,
        )
    return number


def phone_verification_provider(settings: Settings) -> PhoneVerificationProvider:
    if (
        settings.loyalty_verification_provider == "development"
        and settings.environment in {"development", "test"}
    ):
        return DevelopmentPhoneVerificationProvider(settings)
    if settings.loyalty_verification_provider == "netgsm":
        return NetgsmPhoneVerificationProvider(settings)
    raise DomainError(
        "verification_provider_unavailable",
        "Telefon doğrulama sağlayıcısı yapılandırılmamış.",
        status_code=503,
    )
