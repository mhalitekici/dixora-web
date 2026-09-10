from __future__ import annotations

from decimal import Decimal

from app.errors import DomainError

UNIT_DIMENSIONS: dict[str, str] = {
    "piece": "count",
    "gram": "mass",
    "kilogram": "mass",
    "milliliter": "volume",
    "liter": "volume",
}

UNIT_TO_BASE: dict[str, Decimal] = {
    "piece": Decimal("1"),
    "gram": Decimal("1"),
    "kilogram": Decimal("1000"),
    "milliliter": Decimal("1"),
    "liter": Decimal("1000"),
}


def compatible_units(unit: str) -> tuple[str, ...]:
    dimension = UNIT_DIMENSIONS.get(unit)
    if dimension is None:
        return ()
    return tuple(candidate for candidate, value in UNIT_DIMENSIONS.items() if value == dimension)


def convert_quantity(quantity: Decimal, *, source_unit: str, target_unit: str) -> Decimal:
    """Convert recipe usage into the stock card's own unit without float arithmetic."""

    if source_unit not in UNIT_DIMENSIONS or target_unit not in UNIT_DIMENSIONS:
        raise DomainError("invalid_inventory_unit", "Unsupported inventory unit", status_code=422)
    if UNIT_DIMENSIONS[source_unit] != UNIT_DIMENSIONS[target_unit]:
        raise DomainError(
            "incompatible_inventory_unit",
            "Recipe and inventory units are not compatible",
            status_code=422,
            details={"source_unit": source_unit, "target_unit": target_unit},
        )
    return (quantity * UNIT_TO_BASE[source_unit] / UNIT_TO_BASE[target_unit]).quantize(
        Decimal("0.000001")
    )
