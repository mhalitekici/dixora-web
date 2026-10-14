import { describe, expect, it } from "vitest";

import { originalBillPrintKey } from "./bill-print-key";

const order = {
  id: "order-1",
  total: "200.00",
  items: [
    {
      id: "item-1",
      status: "ACCEPTED",
      quantity: "2",
      line_total: "200.00",
      note: "",
    },
  ],
};

describe("original bill printing", () => {
  it("deduplicates the same bill even after preparation status changes", () => {
    expect(
      originalBillPrintKey({
        ...order,
        items: [{ ...order.items[0], status: "SERVED" }],
      }),
    ).toBe(originalBillPrintKey(order));
  });

  it("allows a fresh bill after a new item, quantity, note or complimentary change", () => {
    const initial = originalBillPrintKey(order);
    expect(
      originalBillPrintKey({
        ...order,
        items: [...order.items, { ...order.items[0], id: "item-2" }],
      }),
    ).not.toBe(initial);
    for (const change of [
      { quantity: "3" },
      { note: "Soğansız" },
      { is_complimentary: true },
      { status: "CANCELLED" },
    ]) {
      expect(
        originalBillPrintKey({
          ...order,
          items: [{ ...order.items[0], ...change }],
        }),
      ).not.toBe(initial);
    }
  });
});
