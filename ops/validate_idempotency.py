"""Concurrent HTTP retries against the disposable validation stack only."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

BASE = "http://127.0.0.1:18000/api/v1"


def request(path, payload=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    call = Request(
        BASE + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers=headers,
        method="POST" if payload is not None else "GET",
    )
    try:
        with urlopen(call, timeout=30) as response:
            return response.status, json.load(response)
    except HTTPError as response:
        return response.code, json.load(response)


def repeated(path, payload, token):
    with ThreadPoolExecutor(max_workers=12) as pool:
        outcomes = list(pool.map(lambda _: request(path, payload, token), range(20)))
    assert all(code == 201 for code, _ in outcomes), [
        (code, data.get("error", {}).get("code")) for code, data in outcomes
    ]
    ids = {data["id"] for _, data in outcomes}
    assert len(ids) == 1, "Concurrent retries created multiple records"
    return next(iter(ids))


def main():
    status, tokens = request(
        "/auth/login",
        {"business": "dixora-lab", "username": "owner@dixora.test", "password": "DixoraLab!2026"},
    )
    assert status == 200
    token = tokens["access_token"]
    _, products = request("/catalog/products", token=token)
    product = next(p for p in products["items"] if p["name"] == "Classic Burger")
    key = uuid4().hex
    payload = {
        "items": [{"product_id": product["id"], "quantity": "1"}],
        "auto_accept": False,
        "idempotency_key": f"concurrent-order-{key}",
    }
    order = repeated("/orders", payload, token)
    assert (
        request(
            "/orders", {**payload, "items": [{"product_id": product["id"], "quantity": "2"}]}, token
        )[0]
        == 409
    )
    repeated(
        f"/orders/{order}/payments",
        {"method": "CASH", "amount": "1.00", "idempotency_key": f"concurrent-payment-{key}"},
        token,
    )
    _, devices = request("/printing/devices", token=token)
    printer = next(p for p in devices if p["code"] == "MOCK-KITCHEN")
    repeated(
        "/printing/jobs",
        {
            "printer_device_id": printer["id"],
            "payload": {"lines": []},
            "idempotency_key": f"concurrent-print-{key}",
        },
        token,
    )
    print(
        json.dumps(
            {
                "parallel_retries_per_command": 20,
                "orders": 1,
                "payments": 1,
                "print_jobs": 1,
                "changed_payload_status": 409,
                "physical_printing_verified": False,
            }
        )
    )


if __name__ == "__main__":
    main()
