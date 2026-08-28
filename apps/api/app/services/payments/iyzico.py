"""iyzico adapter.

The request and response shapes here were confirmed against iyzico's sandbox
(card storage and a stored-card charge both returned `success`) rather than
written from documentation alone.

The SDK is synchronous and does blocking I/O, so every call is pushed to a
worker thread — a blocked event loop would stall every other request on the
worker during a payment run.
"""

from __future__ import annotations

import asyncio
import json
import logging
from decimal import Decimal

from app.config import Settings
from app.services.payments.base import (
    Buyer,
    CardCheckout,
    CardDetails,
    ChargeResult,
    PaymentProviderError,
    StoredCard,
)

logger = logging.getLogger(__name__)


def _amount(value: Decimal) -> str:
    # iyzico expects a plain decimal string; it rejects thousands separators
    # and is unhappy with more than two places.
    return f"{value:.2f}"


class IyzicoProvider:
    name = "IYZICO"

    def __init__(self, settings: Settings) -> None:
        if not settings.iyzico_api_key or not settings.iyzico_secret_key:
            raise PaymentProviderError("iyzico credentials are not configured")
        self._options = {
            "api_key": settings.iyzico_api_key.get_secret_value(),
            "secret_key": settings.iyzico_secret_key.get_secret_value(),
            "base_url": settings.iyzico_base_url,
        }

    def _client(self):
        # Imported lazily so the rest of the app runs without the SDK present.
        import iyzipay

        return iyzipay

    async def _call(self, factory, request: dict) -> dict:
        def run() -> dict:
            raw = factory().create(request, self._options).read().decode("utf-8")
            return json.loads(raw)

        try:
            return await asyncio.to_thread(run)
        except Exception as exc:  # network, TLS, malformed body
            logger.warning("payments.iyzico_call_failed error=%s", type(exc).__name__)
            raise PaymentProviderError(str(exc)) from exc

    async def store_card(
        self, *, buyer_email: str, external_id: str, card: CardDetails, alias: str
    ) -> StoredCard:
        iyzipay = self._client()
        payload = {
            "locale": "tr",
            "conversationId": external_id,
            "email": buyer_email,
            "externalId": external_id,
            "card": {
                "cardAlias": alias,
                "cardHolderName": card.holder_name,
                "cardNumber": card.number,
                "expireYear": card.expire_year,
                "expireMonth": card.expire_month,
            },
        }
        body = await self._call(lambda: iyzipay.Card(), payload)
        if body.get("status") != "success":
            raise PaymentProviderError(
                body.get("errorMessage") or "Kart kaydedilemedi."
            )
        return StoredCard(
            card_token=body["cardToken"],
            card_user_key=body["cardUserKey"],
            masked_number=f"**** **** **** {body.get('lastFourDigits', '????')}",
            association=body.get("cardAssociation"),
            family=body.get("cardFamily"),
        )

    async def start_card_checkout(
        self, *, buyer: Buyer, callback_url: str, reference: str
    ) -> CardCheckout:
        iyzipay = self._client()
        payload = {
            "locale": "tr",
            "conversationId": reference,
            # A one-lira authorisation is the cheapest way iyzico will register
            # a card; the subscription itself is charged later from the token.
            "price": "1.00",
            "paidPrice": "1.00",
            "currency": "TRY",
            "basketId": reference,
            "paymentGroup": "SUBSCRIPTION",
            "callbackUrl": callback_url,
            "enabledInstallments": ["1"],
            # Store the card so it can be charged again without the customer.
            "registerCard": "1",
            "buyer": {
                "id": buyer.id,
                "name": buyer.name,
                "surname": buyer.surname,
                "email": buyer.email,
                "identityNumber": "11111111111",
                "registrationAddress": buyer.address,
                "city": buyer.city,
                "country": "Turkey",
                "ip": buyer.ip,
            },
            "billingAddress": {
                "contactName": f"{buyer.name} {buyer.surname}".strip(),
                "city": buyer.city,
                "country": "Turkey",
                "address": buyer.address,
            },
            "basketItems": [
                {
                    "id": reference,
                    "name": "Dixora abonelik kart kaydı",
                    "category1": "Yazılım",
                    "itemType": "VIRTUAL",
                    "price": "1.00",
                }
            ],
        }
        body = await self._call(lambda: iyzipay.CheckoutFormInitialize(), payload)
        if body.get("status") != "success":
            raise PaymentProviderError(
                body.get("errorMessage") or "Kart formu açılamadı."
            )
        return CardCheckout(token=body["token"], form_url=body["paymentPageUrl"])

    async def complete_card_checkout(self, *, token: str) -> StoredCard:
        iyzipay = self._client()
        body = await self._call(
            lambda: iyzipay.CheckoutForm(),
            {"locale": "tr", "conversationId": token, "token": token},
        )
        if body.get("status") != "success" or body.get("paymentStatus") != "SUCCESS":
            raise PaymentProviderError(
                body.get("errorMessage") or "Kart kaydı tamamlanamadı."
            )
        if not body.get("cardToken") or not body.get("cardUserKey"):
            # Without both handles the card cannot be charged later, so
            # accepting the callback would leave a card that looks saved but
            # can never be used.
            raise PaymentProviderError("Sağlayıcı kart anahtarlarını döndürmedi.")
        return StoredCard(
            card_token=body["cardToken"],
            card_user_key=body["cardUserKey"],
            masked_number=f"**** **** **** {body.get('lastFourDigits', '????')}",
            association=body.get("cardAssociation"),
            family=body.get("cardFamily"),
            reference=body.get("conversationId"),
        )

    async def charge_saved_card(
        self,
        *,
        card_token: str,
        card_user_key: str,
        amount: Decimal,
        currency: str,
        reference: str,
        description: str,
        buyer: Buyer,
    ) -> ChargeResult:
        iyzipay = self._client()
        price = _amount(amount)
        payload = {
            "locale": "tr",
            "conversationId": reference,
            "price": price,
            "paidPrice": price,
            "currency": currency,
            "installment": "1",
            "basketId": reference,
            "paymentChannel": "WEB",
            "paymentGroup": "SUBSCRIPTION",
            "paymentCard": {
                "cardUserKey": card_user_key,
                "cardToken": card_token,
            },
            "buyer": {
                "id": buyer.id,
                "name": buyer.name,
                "surname": buyer.surname,
                "email": buyer.email,
                "identityNumber": "11111111111",
                "registrationAddress": buyer.address,
                "city": buyer.city,
                "country": "Turkey",
                "ip": buyer.ip,
            },
            "billingAddress": {
                "contactName": f"{buyer.name} {buyer.surname}".strip(),
                "city": buyer.city,
                "country": "Turkey",
                "address": buyer.address,
            },
            "basketItems": [
                {
                    "id": reference,
                    "name": description[:60],
                    "category1": "Yazılım",
                    "itemType": "VIRTUAL",
                    "price": price,
                }
            ],
        }
        body = await self._call(lambda: iyzipay.Payment(), payload)
        if body.get("status") == "success":
            return ChargeResult(
                succeeded=True, provider_payment_id=str(body.get("paymentId"))
            )
        # A decline is an ordinary outcome, not an exception: dunning needs the
        # reason, and the caller decides whether to retry.
        return ChargeResult(
            succeeded=False,
            provider_payment_id=None,
            error_code=str(body.get("errorCode") or ""),
            error_message=body.get("errorMessage") or "Ödeme alınamadı.",
        )
