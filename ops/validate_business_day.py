"""Exercise order/payment/refund/shift flows against the disposable HTTP stack.

Only the seeded dixora-lab tenant is used. Never run against customer data.
"""
from __future__ import annotations

import json
import os
from decimal import Decimal
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from uuid import uuid4

BASE = os.environ.get("DIXORA_VALIDATION_URL", "http://127.0.0.1:18000")
CASHIER = {"username": "cashier@dixora.test", "pin": "1357"}
CHECKED = []


def request(method, path, payload=None, token=None, status=200, error=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    call = Request(BASE + "/api/v1" + path, method=method, headers=headers,
                   data=json.dumps(payload).encode() if payload is not None else None)
    try:
        response = urlopen(call, timeout=30)
    except HTTPError as exc:
        response = exc
    with response:
        body = {} if response.code == 204 else json.load(response)
        assert response.code == status, (method, path, response.code, body)
    if error:
        assert body["error"]["code"] == error, body
    return body


def main():
    origin = urlsplit(BASE)
    if origin.hostname not in {"localhost", "127.0.0.1"} or origin.scheme != "http":
        raise ValueError("Validation is restricted to the local disposable stack")
    key = uuid4().hex
    owner = request("POST", "/auth/login", {
        "business": "dixora-lab", "username": "owner@dixora.test", "password": "DixoraLab!2026",
    })["access_token"]
    manager_login = request("POST", "/auth/login", {
        "business": "dixora-lab", "username": "manager@dixora.test", "password": "DixoraLab!2026",
    })
    manager = manager_login["user"]
    users = request("GET", "/users", token=owner)
    cashier_user = next(u for u in users if u["username"] == CASHIER["username"])
    request("PUT", f"/users/{manager['id']}/pin", {"pin": "8642"}, owner, 204)
    successor = {"username": f"validation-next-{key[:8]}", "pin": "9753"}
    request("POST", "/users", {
        **successor, "display_name": "Validation successor", "role_id": cashier_user["role_id"],
        "branch_id": cashier_user["branch_id"], "temporary_password": "ValidationOnly!2026",
    }, owner, 201)
    manager_token = manager_login["access_token"]
    day_credentials = {"username": manager["username"], "pin": "8642"}
    tokens = request("POST", "/auth/login", {
        "business": "dixora-lab", "username": CASHIER["username"], "password": "DixoraLab!2026",
    })
    token = tokens["access_token"]
    assert request("GET", "/shifts/current", token=token) is None, "Use a fresh validation stack"
    tables = request("GET", "/tables", token=token)
    products = request("GET", "/catalog/products", token=token)["items"]
    product = next(p for p in products if p["name"] == "Classic Burger")
    table = tables[0]
    order_payload = {
        "table_id": table["id"], "items": [{"product_id": product["id"], "quantity": "1"}],
        "auto_accept": True, "idempotency_key": f"validation-order-{key}",
    }
    order = request("POST", "/orders", order_payload, token, 201)
    replay = request("POST", "/orders", order_payload, token, 201)
    assert replay["id"] == order["id"]
    CHECKED.append("order creation and retry produce one order")
    order_path = f"/orders/{order['id']}"
    pay = {"method": "CASH", "amount": "100.00", "idempotency_key": f"validation-cash-{key}"}
    request("POST", order_path + "/payments", pay, token, 409, "cashier_shift_required")
    shift = request("POST", "/shifts/open", {**CASHIER, "opening_cash": "1000.10"}, token, 201)
    request("POST", "/shifts/open", {**CASHIER, "opening_cash": "0.00"}, token, 409)
    request("POST", "/shifts/business-day-close", {
        **day_credentials, "counted_cash": "0", "reported_card_total": "0",
    }, manager_token, 409, "open_shifts_exist")
    CHECKED.append("payments require an open shift; duplicate shift rejected")
    cash = request("POST", order_path + "/payments", pay, token, 201)
    replay = request("POST", order_path + "/payments", pay, token, 201)
    assert cash["id"] == replay["id"] and cash["shift_id"] == shift["id"]
    request("POST", order_path + "/payments", {
        "method": "CARD", "amount": str(Decimal(order["total"]) + 1),
        "idempotency_key": f"validation-overpay-{key}",
    }, token, 409)
    refund_path = order_path + f"/payments/{cash['id']}/refund"
    refunded = request("POST", refund_path, {"reason": "Validation refund"}, token)
    replay = request("POST", refund_path, {"reason": "Validation refund retry"}, token)
    assert refunded["status"] == replay["status"] == "REFUNDED"
    current = request("GET", "/shifts/current", token=token)
    assert Decimal(current["cash_refunds"]) == Decimal("100.00")
    assert Decimal(current["expected_cash"]) == Decimal("1000.10")
    CHECKED.append("payment retry, overpayment rejection and refund retry reconcile once")
    cash2 = request("POST", order_path + "/payments", {
        "method": "CASH", "amount": "100.00", "idempotency_key": f"validation-cash2-{key}",
    }, token, 201)
    card_total = Decimal(order["total"]) - Decimal(cash2["amount"])
    card = request("POST", order_path + "/payments", {
        "method": "CARD", "amount": str(card_total), "idempotency_key": f"validation-card-{key}",
    }, token, 201)
    settled = request("GET", order_path, token=token)
    assert settled["status"] == "PAID"
    payments = settled["payments"]
    assert sum(Decimal(p["amount"]) for p in payments if p["status"] == "COMPLETED") == Decimal(order["total"])
    CHECKED.append("cash/card split settles exactly the order balance after refund")
    card_refund = order_path + f"/payments/{card['id']}/refund"
    for _ in range(2):
        request("POST", card_refund, {"reason": "Validation paid-order card refund"}, token)
    totals = request("GET", "/shifts/current", token=token)
    assert Decimal(totals["card_refunds"]) == card_total
    request("POST", order_path + "/payments", {
        "method": "CARD", "amount": str(card_total),
        "idempotency_key": f"validation-card-correction-{key}",
    }, token, 201)
    CHECKED.append("paid-order card refund and retry count once; corrected collection reconciles net POS total")
    table_now = request("GET", f"/tables/{table['id']}", token=token)
    close_path = f"/tables/{table['id']}/sessions/{order['table_session_id']}/close"
    closed = request("POST", close_path, {"expected_table_version": table_now["version"]}, token)
    assert closed["table"]["state"] == "AVAILABLE"
    replay = request("POST", close_path, {"expected_table_version": table_now["version"]}, token)
    assert replay["already_closed"] is True
    CHECKED.append("settled table closes and safely accepts a repeated close")
    closed_shift = request("POST", f"/shifts/{shift['id']}/close", {
        **CASHIER, "closing_cash": "1100.10", "reported_card_total": str(card_total),
    }, token)
    assert Decimal(closed_shift["cash_variance"]) == 0
    assert Decimal(closed_shift["card_variance"]) == 0
    assert Decimal(closed_shift["cash_refunds"]) == Decimal("100.00")
    request("POST", f"/shifts/{shift['id']}/close", {**CASHIER, "closing_cash": "0"}, token, 409)
    assert request("GET", "/shifts/current", token=token) is None
    history = request("GET", "/shifts/history", token=token)
    assert any(s["id"] == shift["id"] and s["status"] == "CLOSED" for s in history)
    CHECKED.append("shift closes with zero cash/card variance and appears in history")
    handoff_shift = request("POST", "/shifts/open", {**CASHIER, "opening_cash": "0.00"}, token, 201)
    handoff = request("POST", f"/shifts/{handoff_shift['id']}/handoff", {
        **CASHIER, "closing_cash": "0", "reported_card_total": "0",
        "next_username": successor["username"], "next_pin": successor["pin"], "next_opening_cash": "0",
    }, token)
    assert handoff["closed"]["status"] == "CLOSED"
    assert handoff["opened"]["predecessor_shift_id"] == handoff_shift["id"]
    next_token = request("POST", "/auth/login", {
        "business": "dixora-lab", "username": successor["username"], "password": "ValidationOnly!2026",
    })["access_token"]
    assert request("GET", "/shifts/current", token=next_token)["id"] == handoff["opened"]["id"]
    request("POST", f"/shifts/{handoff['opened']['id']}/close", {
        **successor, "closing_cash": "0", "reported_card_total": "0",
    }, next_token)
    CHECKED.append("handoff verifies both employees and creates a linked successor shift")
    preview = request("GET", "/shifts/day/preview", token=manager_token)
    assert preview["open_shift_count"] == 0
    day_payload = {**day_credentials, "counted_cash": preview["expected_cash"],
                   "reported_card_total": preview["system_card_total"]}
    day = request("POST", "/shifts/business-day-close", day_payload, manager_token, 201)
    assert Decimal(day["cash_difference"]) == Decimal(day["card_difference"]) == 0
    request("POST", "/shifts/business-day-close", day_payload, manager_token, 409, "already_closed")
    CHECKED.append("manager day close requires closed shifts and cannot run twice")
    print(json.dumps({"passed": CHECKED, "order_id": order["id"], "shift_id": shift["id"]}, indent=2))


if __name__ == "__main__":
    main()
