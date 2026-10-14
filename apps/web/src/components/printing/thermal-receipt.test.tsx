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
      complimentary: true,
    },
  ],
  totals: {
    subtotal: "380.00",
    discount: "20.00",
    serviceChargeType: "PERCENTAGE",
    serviceChargeValue: "10.00",
    serviceCharge: "36.00",
    total: "360.00",
  },
  payments: [{ method: "CARD", amount: "360.00" }],
};

describe("ThermalReceipt", () => {
  it.each(["ORIGINAL", "REPRINT"] as const)(
    "combines repeated purchases on a %s receipt with their stored amounts",
    (kind) => {
      const lines = [
        {
          name: "Baklava",
          productId: "baklava",
          quantity: "1",
          unitPrice: "0.10",
          lineTotal: "0.10",
        },
        {
          name: "Baklava",
          productId: "baklava",
          quantity: "1.00",
          unitPrice: "0.1",
          lineTotal: "0.10",
        },
      ];
      render(<ThermalReceipt document={{ ...billDocument, kind, lines }} />);
      const row = screen.getByText("Baklava").closest("li") as HTMLElement;
      expect(within(row).getByText("2")).toBeVisible();
      expect(within(row).getByText("0,20 TL")).toBeVisible();
      expect(lines.map((line) => line.quantity)).toEqual(["1", "1.00"]);
      const total = screen
        .getByText("GENEL TOPLAM")
        .closest(".receipt-row") as HTMLElement;
      expect(within(total).getByText("360,00 TL")).toBeVisible();
    },
  );

  it("keeps different products, prices, options, notes and complimentary lines separate", () => {
    const line = {
      name: "Baklava",
      productId: "baklava",
      quantity: "1",
      unitPrice: "100.00",
      lineTotal: "100.00",
    };
    render(
      <ThermalReceipt
        document={{
          ...billDocument,
          lines: [
            line,
            { ...line, productId: "other-baklava" },
            { ...line, taxRate: "20.00" },
            { ...line, discount: "10.00" },
            { ...line, unitPrice: "120.00", lineTotal: "120.00" },
            { ...line, modifiers: ["Dondurmalı"] },
            { ...line, note: "Az şerbetli" },
            { ...line, complimentary: true, lineTotal: "0.00" },
          ],
        }}
      />,
    );
    expect(screen.getAllByText("Baklava")).toHaveLength(8);
    expect(screen.getByText("İKRAM")).toBeVisible();
    expect(screen.getByText("Açıklama: Az şerbetli")).toBeVisible();
  });

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
    expect(screen.getByText("Latte")).toBeVisible();
    expect(screen.getByText("Cheesecake")).toBeVisible();
    expect(screen.getByText("Adet")).toBeVisible();
    expect(screen.queryByText("Birim")).not.toBeInTheDocument();
    expect(screen.queryByText("120,00 TL")).not.toBeInTheDocument();
    expect(screen.getByText("240,00 TL")).toBeVisible();
    expect(screen.getByText("Toplam")).toBeVisible();
    expect(screen.getByText("+ Ekstra sos")).toBeVisible();
    expect(screen.getByText("Açıklama: Az şekerli")).toBeVisible();
    expect(screen.getByText("İKRAM")).toBeVisible();
  });

  it("shows the money block with discount and grand total", () => {
    render(<ThermalReceipt document={billDocument} />);
    expect(screen.getByText("Ara toplam")).toBeVisible();
    expect(screen.getByText("İndirim")).toBeVisible();
    expect(screen.getByText("Servis ücreti")).toBeVisible();
    expect(screen.queryByText(/Kuver/)).toBeNull();
    const total = screen.getByText("GENEL TOPLAM").closest(".receipt-row");
    expect(total).not.toBeNull();
    expect(within(total as HTMLElement).getByText("360,00 TL")).toBeVisible();
  });

  it("labels the payment method in Turkish", () => {
    render(<ThermalReceipt document={billDocument} />);
    expect(screen.getByText("Kart")).toBeVisible();
  });

  it("prints an original without a duplicate banner", () => {
    render(<ThermalReceipt document={billDocument} />);
    expect(
      screen.queryByText(/KOPYA|YENİDEN YAZDIRMA|TEST BASKISI/),
    ).toBeNull();
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
    expect(screen.getByText("GENEL TOPLAM")).toBeVisible();
  });

  it("keeps service and cover charges as separate totals", () => {
    render(
      <ThermalReceipt
        document={{
          ...billDocument,
          totals: { ...billDocument.totals, coverCharge: "12.00" },
        }}
      />,
    );
    expect(screen.getByText("Servis ücreti")).toBeVisible();
    expect(screen.getByText("Kuver ücreti")).toBeVisible();
  });
});
