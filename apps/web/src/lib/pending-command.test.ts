import { describe, expect, it } from "vitest";
import { PendingCommands } from "./pending-command";

describe("uncertain cashier commands", () => {
  it("replays the original create after server refresh switches the action to append", () => {
    const pending = new PendingCommands();
    const original = pending.prepare("table-1:burger", "/orders", { table_id: "table-1" });
    const retry = pending.prepare("table-1:burger", "/orders/new-order/items", { items: ["burger"] });
    expect(retry).toEqual(original);
    expect(JSON.parse(retry.body).idempotency_key).toBeTruthy();
  });
  it("retains a payment key after a lost response and creates a new key after confirmation", () => {
    const pending = new PendingCommands();
    const payload = { amount: "10.00", method: "CASH" };
    const first = pending.prepare("payment-1", "/orders/1/payments", payload);
    expect(pending.prepare("payment-1", "/orders/1/payments", payload)).toEqual(first);
    pending.confirmed("payment-1");
    expect(pending.prepare("payment-1", "/orders/1/payments", payload).body).not.toBe(first.body);
  });
});
