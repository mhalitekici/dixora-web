import { describe, expect, it } from "vitest";

import { aggregateReceiptLines } from "./aggregate-receipt-lines";

describe("receipt line grouping", () => {
  it("sums quantities and money for equivalent selections regardless of option ordering", () => {
    const line = {
      name: "Baklava",
      quantity: "1",
      unitPrice: "0.10",
      lineTotal: "0.10",
      modifiers: ["Fıstıklı", "Dondurmalı"],
    };
    const lines = [
      line,
      {
        ...line,
        quantity: "2",
        lineTotal: "0.20",
        modifiers: ["Dondurmalı", "Fıstıklı"],
      },
    ];
    expect(aggregateReceiptLines(lines)).toEqual([
      { ...line, quantity: "3.00", lineTotal: "0.30" },
    ]);
    expect(lines[0].modifiers).toEqual(["Fıstıklı", "Dondurmalı"]);
  });

  it("uses the effective unit price for older receipts without a unit price", () => {
    const line = { name: "Baklava", quantity: "1", lineTotal: "100.00" };
    expect(
      aggregateReceiptLines([
        line,
        { ...line, quantity: "2", lineTotal: "200.00" },
        { ...line, lineTotal: "120.00" },
      ]),
    ).toEqual([
      { ...line, quantity: "3.00", lineTotal: "300.00" },
      { ...line, lineTotal: "120.00" },
    ]);
  });
});
