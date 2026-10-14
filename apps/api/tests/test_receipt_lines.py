from decimal import Decimal
from uuid import UUID

import pytest

from app.models import OrderItem, OrderItemModifier
from app.models.enums import OrderItemStatus
from app.services.receipt_lines import aggregate_order_receipt_lines


def item(**overrides: object) -> OrderItem:
    return OrderItem(
        **{
            "product_id": UUID("00000000-0000-0000-0000-000000000001"),
            "product_name_snapshot": "Baklava",
            "quantity": Decimal("1.00"),
            "unit_price": Decimal("0.10"),
            "line_total": Decimal("0.10"),
            "tax_rate_snapshot": Decimal("10.00"),
            "discount_snapshot": Decimal("0.00"),
            "is_complimentary": False,
            "status": OrderItemStatus.ACCEPTED,
            "note": None,
            "modifiers": [],
            **overrides,
        }
    )


def test_repeated_purchases_sum_exactly_without_mutating_source_items() -> None:
    original = item()
    addition = item(quantity=Decimal("2.00"), line_total=Decimal("0.20"))
    lines = aggregate_order_receipt_lines([original, addition])
    assert len(lines) == 1
    assert lines[0]["name"] == "Baklava"
    assert lines[0]["quantity"] == "3.00"
    assert lines[0]["line_total"] == "0.30"
    assert original.quantity == Decimal("1.00")
    assert addition.quantity == Decimal("2.00")


@pytest.mark.parametrize(
    "overrides",
    [
        {"product_id": UUID("00000000-0000-0000-0000-000000000002")},
        {"product_name_snapshot": "Fıstıklı Baklava"},
        {"unit_price": Decimal("0.20"), "line_total": Decimal("0.20")},
        {"tax_rate_snapshot": Decimal("20.00")},
        {"discount_snapshot": Decimal("0.05")},
        {"note": "Dondurmalı"},
        {"is_complimentary": True, "line_total": Decimal("0.00")},
    ],
)
def test_different_purchase_variants_remain_separate(overrides: dict[str, object]) -> None:
    assert len(aggregate_order_receipt_lines([item(), item(**overrides)])) == 2


def test_cancelled_and_voided_items_do_not_appear_on_receipts() -> None:
    lines = aggregate_order_receipt_lines(
        [item(), item(status=OrderItemStatus.CANCELLED), item(status=OrderItemStatus.VOIDED)]
    )
    assert len(lines) == 1
    assert lines[0]["quantity"] == "1.00"


def test_modifier_order_does_not_split_equivalent_purchases() -> None:
    def modifier(name: str) -> OrderItemModifier:
        return OrderItemModifier(
            modifier_id=None, name_snapshot=name, price_delta_snapshot=Decimal("0.00"), quantity=1
        )

    lines = aggregate_order_receipt_lines(
        [
            item(modifiers=[modifier("Fıstıklı"), modifier("Dondurmalı")]),
            item(modifiers=[modifier("Dondurmalı"), modifier("Fıstıklı")]),
            item(modifiers=[modifier("Fıstıklı")]),
        ]
    )
    assert len(lines) == 2
    assert lines[0]["quantity"] == "2.00"
    assert lines[0]["modifiers"] == ["Fıstıklı", "Dondurmalı"]
