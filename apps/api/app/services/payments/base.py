"""What the billing code needs from a payment provider, and nothing more.

Kept as a protocol so the charge logic can be tested without a merchant
account or a network, and so a second provider is an addition rather than a
rewrite.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol


@dataclass(frozen=True)
class CardDetails:
    """A card on its way to the provider. Never stored, never logged."""

    holder_name: str
    number: str
    expire_month: str
    expire_year: str
    cvc: str | None = None


@dataclass(frozen=True)
class StoredCard:
    """The safe residue of a card: opaque handles plus a masked descriptor."""

    card_token: str
    card_user_key: str
    masked_number: str
    association: str | None
    family: str | None
    # Echoed back by the provider. The hosted-form callback arrives without a
    # session, so this is how the tenant is identified.
    reference: str | None = None


@dataclass(frozen=True)
class CardCheckout:
    """A hosted form the customer is sent to.

    The card is typed on the provider's page, so the number never reaches this
    application at all — transmitting it would put the whole server in PCI DSS
    scope even though nothing is stored.
    """

    token: str
    form_url: str


@dataclass(frozen=True)
class ChargeResult:
    succeeded: bool
    provider_payment_id: str | None
    error_code: str | None = None
    error_message: str | None = None


@dataclass(frozen=True)
class Buyer:
    """Identity the provider requires alongside a charge."""

    id: str
    name: str
    surname: str
    email: str
    address: str
    city: str
    ip: str


class PaymentProvider(Protocol):
    name: str

    async def store_card(
        self, *, buyer_email: str, external_id: str, card: CardDetails, alias: str
    ) -> StoredCard:
        """Hand the card to the provider and keep only what comes back."""
        ...

    async def start_card_checkout(
        self, *, buyer: Buyer, callback_url: str, reference: str
    ) -> CardCheckout:
        """Open a hosted card-entry form and return where to send the customer."""
        ...

    async def complete_card_checkout(self, *, token: str) -> StoredCard:
        """Read back the card the customer just entered on the hosted form."""
        ...

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
        ...


class PaymentProviderError(RuntimeError):
    """The provider could not be reached or answered unintelligibly.

    Distinct from a declined card: a decline is a ChargeResult, an outage is
    an exception, and dunning must treat them differently.
    """
