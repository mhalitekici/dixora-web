import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ReceiptDocument } from "./receipt-types";
import { ThermalReceipt } from "./thermal-receipt";

const billDocument: ReceiptDocument = {
  kind: "ORIGINAL",
  title: "ADİSYON",
  business: {
    name: "Elixir Hotel",
    branch: "Merkez",
    address: "Sahil Cad. No:12, Muğla",
    phone: "+90 252 000 00 00",
  },
  meta: {
    reference: "A1B2C3D4",
    tableName: "B1",
    staffName: "Ahmet Y.",
    issuedAt: "2026-08-08T18:30:00Z",
  },
  lines: [
    { name: "Latte", quantity: 2, unitPrice: "120.00", lineTotal: "240.00" },
    {
      name: "Cheesecake",
      quantity: 1,
      unitPrice: "140.00",
      lineTotal: "140.00",
      modifiers: ["Ekstra sos"],
      note: "Az şekerli",
    },
  ],
  totals: {
    subtotal: "380.00",
    discount: "20.00",
    total: "360.00",
  },
  payments: [{ method: "CARD", amount: "360.00" }],
};

describe("ThermalReceipt", () => {
  it("carries the business branding and contact block", () => {
    render(<ThermalReceipt document={billDocument} />);
    // Branding is printed exactly as the owner entered it.
    expect(screen.getByRole("heading", { name: "Elixir Hotel" })).toBeVisible();
    expect(screen.getByText("Merkez")).toBeVisible();
    expect(screen.getByText("Sahil Cad. No:12, Muğla")).toBeVisible();
    expect(screen.getByText("+90 252 000 00 00")).toBeVisible();
    expect(screen.getByText("ADİSYON")).toBeVisible();
  });

  it("renders snapshot line items with quantities, modifiers and notes", () => {
    render(<ThermalReceipt document={billDocument} />);
    expect(screen.getByText("2 x Latte")).toBeVisible();
    expect(screen.getByText("1 x Cheesecake")).toBeVisible();
    expect(screen.getByText("+ Ekstra sos")).toBeVisible();
    expect(screen.getByText("Not: Az şekerli")).toBeVisible();
    // Unit price is only shown where quantity > 1 (it is redundant otherwise).
    expect(screen.getByText(/Birim/)).toBeVisible();
  });

  it("shows the money block with discount and grand total", () => {
    render(<ThermalReceipt document={billDocument} />);
    expect(screen.getByText("Ara toplam")).toBeVisible();
    expect(screen.getByText("İndirim")).toBeVisible();
    const total = screen.getByText("TOPLAM").closest(".receipt-row");
    expect(total).not.toBeNull();
    expect(within(total as HTMLElement).getByText("360,00 TL")).toBeVisible();
  });

  it("labels the payment method in Turkish", () => {
    render(<ThermalReceipt document={billDocument} />);
    expect(screen.getByText("Kart")).toBeVisible();
  });

  it("prints an original without a duplicate banner", () => {
    render(<ThermalReceipt document={billDocument} />);
    expect(screen.queryByText(/KOPYA|YENİDEN YAZDIRMA|TEST BASKISI/)).toBeNull();
  });

  it("marks a reprint so it cannot be mistaken for the original", () => {
    render(<ThermalReceipt document={{ ...billDocument, kind: "REPRINT" }} />);
    expect(screen.getByText("*** YENİDEN YAZDIRMA ***")).toBeVisible();
  });

  it("marks a test print distinctly from a real receipt", () => {
    render(<ThermalReceipt document={{ ...billDocument, kind: "TEST" }} />);
    expect(screen.getByText("*** TEST BASKISI ***")).toBeVisible();
  });

  it("renders a hotel checkout with room, guest and stay dates", () => {
    const hotel: ReceiptDocument = {
      ...billDocument,
      title: "ODA HESABI",
      meta: {
        roomNumber: "212",
        guestName: "Ahmet Yılmaz",
        checkedInAt: "2026-08-05T12:00:00Z",
        checkedOutAt: "2026-08-08T09:00:00Z",
        issuedAt: "2026-08-08T09:00:00Z",
      },
      payments: [{ method: "ROOM_CHARGE", amount: "360.00" }],
    };
    render(<ThermalReceipt document={hotel} />);
    expect(screen.getByText("ODA HESABI")).toBeVisible();
    expect(screen.getByText("212")).toBeVisible();
    expect(screen.getByText("Ahmet Yılmaz")).toBeVisible();
    expect(screen.getByText("Giriş")).toBeVisible();
    expect(screen.getByText("Çıkış")).toBeVisible();
    // "Oda" appears both as the room meta label and the payment method.
    expect(screen.getAllByText("Oda").length).toBeGreaterThanOrEqual(1);
  });

  it("shows a remaining balance only when money is still owed", () => {
    const { rerender } = render(
      <ThermalReceipt
        document={{
          ...billDocument,
          totals: { ...billDocument.totals, remaining: "60.00" },
        }}
      />,
    );
    expect(screen.getByText("KALAN")).toBeVisible();

    rerender(
      <ThermalReceipt
        document={{
          ...billDocument,
          totals: { ...billDocument.totals, remaining: "0" },
        }}
      />,
    );
    expect(screen.queryByText("KALAN")).toBeNull();
  });

  it("uses the constrained 80mm layout class", () => {
    const { container } = render(
      <ThermalReceipt document={billDocument} printTarget />,
    );
    const receipt = container.querySelector(".dixora-receipt");
    expect(receipt).not.toBeNull();
    expect(receipt).toHaveAttribute("data-print-target", "true");
  });

  it("never renders empty when an order has no lines", () => {
    render(<ThermalReceipt document={{ ...billDocument, lines: [] }} />);
    expect(screen.getByText("Kayıtlı ürün yok")).toBeVisible();
    expect(screen.getByText("TOPLAM")).toBeVisible();
  });
});
