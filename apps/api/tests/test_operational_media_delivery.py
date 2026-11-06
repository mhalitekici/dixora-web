from __future__ import annotations

from decimal import Decimal
from uuid import UUID

import pytest

from app.models import Product
from app.schemas import DeliveryOrderCreate
from tests.conftest import ApiContext, auth_headers, login, seeded_resources
from tests.test_product_media import _image_bytes


@pytest.mark.parametrize(
    "address", [{"city": None}, {"district": None}, {"city": "  "}, {"district": "  "}]
)
def test_new_courier_order_requires_city_and_district(address: dict[str, str | None]) -> None:
    from uuid import uuid4

    with pytest.raises(ValueError, match="il"):
        DeliveryOrderCreate.model_validate(
            {
                "channel": "OWN_DELIVERY",
                "city": "İstanbul",
                "district": "Kadıköy",
                "address_line": "Moda Caddesi No 42",
                "items": [{"product_id": str(uuid4()), "quantity": "1"}],
                "idempotency_key": "missing-courier-location",
                **address,
            }
        )


async def test_shared_image_survives_domain_change_and_replacing_one_reference(
    api: ApiContext,
) -> None:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    product_id = resources["burger"]["id"]
    uploaded = await api.client.post(
        f"/api/v1/media/products/{product_id}/image",
        headers=headers,
        files={"file": ("photo.png", _image_bytes("PNG"), "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    original_url = uploaded.json()["image_url"]
    original_path = original_url.removeprefix("http://test")
    async with api.database.session_factory() as db:
        original = await db.get(Product, UUID(product_id))
        assert original is not None
        original.image_url = original_url.replace("http://test", "https://previous-domain.test")
        clone = Product(
            tenant_id=original.tenant_id,
            branch_id=original.branch_id,
            category_id=original.category_id,
            name="Kopya ürün",
            selling_price=Decimal("10"),
            image_url=original.image_url,
        )
        db.add(clone)
        await db.commit()
    assert (await api.client.get(original_path)).status_code == 200
    public = await api.client.get("/api/v1/qr/public/dixora-lab/merkez")
    assert (
        next(row for row in public.json()["products"] if row["name"] == "Classic Burger")[
            "image_url"
        ]
        == original_path
    )
    replaced = await api.client.post(
        f"/api/v1/media/products/{product_id}/image",
        headers=headers,
        files={"file": ("new.png", _image_bytes("PNG"), "image/png")},
    )
    assert replaced.status_code == 200, replaced.text
    assert (await api.client.get(original_path)).status_code == 200, (
        "replacement erased a shared object"
    )


async def test_courier_address_fingerprint_and_original_receipt(api: ApiContext) -> None:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    payload = {
        "channel": "OWN_DELIVERY",
        "city": "İstanbul",
        "district": "Kadıköy",
        "neighbourhood": "Caferağa",
        "address_line": "Moda Caddesi No: 42 Daire: 9",
        "address_note": "Şişli sokağından giriniz; üçüncü kat",
        "customer_name": "Ahmet Yılmaz",
        "customer_phone": "05551112233",
        "payment_method": "CARD_ON_DELIVERY",
        "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
        "idempotency_key": "courier-address-intent",
        "auto_accept": True,
    }
    created = await api.client.post("/api/v1/delivery", headers=headers, json=payload)
    assert created.status_code == 201, created.text
    assert created.json()["city"] == "İstanbul"
    replay = await api.client.post("/api/v1/delivery", headers=headers, json=payload)
    assert replay.json()["id"] == created.json()["id"]
    conflict = await api.client.post(
        "/api/v1/delivery", headers=headers, json={**payload, "city": "Ankara"}
    )
    assert conflict.status_code == 409, conflict.text
    printer = await api.client.post(
        "/api/v1/printing/devices",
        headers=headers,
        json={
            "code": "COURIER-TEST",
            "name": "Kurye",
            "purpose": "CASHIER",
            "transport": "MOCK",
        },
    )
    assert printer.status_code == 201, printer.text
    command = {
        "order_id": created.json()["order_id"],
        "printer_device_id": printer.json()["id"],
        "payload": {"type": "COURIER"},
        "idempotency_key": "courier-original-intent",
    }
    first = await api.client.post("/api/v1/printing/jobs", headers=headers, json=command)
    assert first.status_code == 201, first.text
    second = await api.client.post("/api/v1/printing/jobs", headers=headers, json=command)
    assert second.json()["id"] == first.json()["id"]
    document = first.json()["payload"]["document"]
    assert document["title"] == "PAKET SERVİS"
    assert all(
        value in document["delivery_address"]
        for value in ("İstanbul", "Kadıköy", "Caferağa", "Moda")
    )
    assert any("üçüncü kat" in line for line in document["footer"])
