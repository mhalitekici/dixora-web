from __future__ import annotations

from collections.abc import Iterable
from decimal import Decimal
from typing import TypedDict

from app.models import OrderItem
from app.models.enums import OrderItemStatus


class OrderReceiptLine(TypedDict):
    product_id: str
    name: str
    quantity: str
    unit_price: str
    line_total: str
    tax_rate: str
    discount: str
    modifiers: list[str]
    note: str | None
    complimentary: bool


def aggregate_order_receipt_lines(items: Iterable[OrderItem]) -> list[OrderReceiptLine]:
    """Combine identical purchases for the bill without changing order batches."""
    grouped: dict[tuple[object, ...], OrderReceiptLine] = {}
    for item in items:
        if item.status in {OrderItemStatus.CANCELLED, OrderItemStatus.VOIDED}:
            continue
        modifier_key = tuple(
            sorted(
                (
                    str(modifier.modifier_id or ""),
                    modifier.name_snapshot,
                    modifier.price_delta_snapshot,
                    modifier.quantity,
                )
                for modifier in item.modifiers
            )
        )
        note = (item.note or "").strip() or None
        key = (
            item.product_id,
            item.product_name_snapshot,
            item.unit_price,
            item.tax_rate_snapshot,
            item.discount_snapshot,
            modifier_key,
            note,
            item.is_complimentary,
        )
        if key in grouped:
            line = grouped[key]
            line["quantity"] = str(Decimal(line["quantity"]) + item.quantity)
            line["line_total"] = str(Decimal(line["line_total"]) + item.line_total)
        else:
            grouped[key] = {
                "product_id": str(item.product_id),
                "name": item.product_name_snapshot,
                "quantity": str(item.quantity),
                "unit_price": str(item.unit_price),
                "line_total": str(item.line_total),
                "tax_rate": str(item.tax_rate_snapshot),
                "discount": str(item.discount_snapshot),
                "modifiers": [
                    f"{modifier.quantity}x {modifier.name_snapshot}"
                    if modifier.quantity > 1
                    else modifier.name_snapshot
                    for modifier in item.modifiers
                ],
                "note": note,
                "complimentary": item.is_complimentary,
            }
    return list(grouped.values())
