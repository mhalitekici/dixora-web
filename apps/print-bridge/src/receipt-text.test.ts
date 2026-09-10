import assert from "node:assert/strict";
import test from "node:test";

import type { PrintJobClaim } from "@dixora/shared-types";

import { renderReceiptText } from "./receipt-text.js";

function job(overrides: Partial<PrintJobClaim> = {}): PrintJobClaim {
  return {
    id: "job-1",
    tenantId: "tenant-1",
    branchId: "branch-1",
    printerDeviceId: "MUTFAK",
    preparationStationId: "station-1",
    orderId: "order-1",
    kitchenTicketId: "ticket-1",
    contentType: "application/vnd.dixora.receipt+json",
    copies: 1,
    isReprint: false,
    isTestPrint: false,
    attemptCount: 1,
    claimedAt: "2026-09-06T19:42:00Z",
    document: {
      title: "Mutfak Fişi",
      businessName: "Dodo Cafe",
      branchName: "Aleyin Mutfağı",
      stationName: "Mutfak",
      orderNumber: "A1042",
      tableName: "Salon 7",
      waiterName: "Ahmet",
      submittedAt: "2026-09-06T19:42:00Z",
      lines: [
        {
          name: "Adana Kebap",
          quantity: "1",
          modifiers: ["Az acılı", "Soğansız"],
        },
        { name: "Patates", quantity: "2" },
      ],
    },
    ...overrides,
  };
}

test("renders branch, station, order, table and waiter with the new layout", () => {
  const text = renderReceiptText(job());

  assert.match(text, /ALEYİN MUTFAĞI/);
  assert.match(text, /DODO CAFE/);
  assert.match(text, /MUTFAK FİŞİ/);
  assert.match(text, /Sipariş No:\s+A1042/);
  assert.match(text, /Masa:\s+Salon 7/);
  assert.match(text, /Garson:\s+Ahmet/);
  assert.match(text, /^={42}$/m);
});

test("renders a bar preparation receipt with its own station identity", () => {
  const text = renderReceiptText(
    job({
      printerDeviceId: "BAR",
      document: {
        ...job().document,
        title: "Bar Fişi",
        stationName: "Bar",
        lines: [{ name: "Türk Kahvesi", quantity: "2" }],
      },
    }),
  );

  assert.match(text, /BAR FİŞİ/);
  assert.match(text, /^\s+BAR\s*$/m);
  assert.match(text, /2 x TÜRK KAHVESİ/);
});

test("renders quantity, product name, modifiers and item note", () => {
  const text = renderReceiptText(
    job({
      document: {
        ...job().document,
        lines: [
          {
            name: "Adana Kebap",
            quantity: "1",
            modifiers: ["Az acılı", "Soğansız"],
            note: "Acil",
          },
        ],
      },
    }),
  );

  assert.match(text, /1 x ADANA KEBAP/);
  assert.match(text, /\+ Az acılı/);
  assert.match(text, /\+ Soğansız/);
  assert.match(text, /Not: Acil/);
});

test("renders the order-level note carried in the footer", () => {
  const text = renderReceiptText(
    job({
      document: { ...job().document, footer: ["Sipariş notu: Hızlı olsun"] },
    }),
  );

  assert.match(text, /SİPARİŞ NOTU\s+Hızlı olsun/);
});

test("marks a reprint distinctly from an original", () => {
  const original = renderReceiptText(job({ isReprint: false }));
  const reprint = renderReceiptText(job({ isReprint: true, copies: 1 }));

  assert.doesNotMatch(original, /TEKRAR YAZDIRILDI/);
  assert.match(reprint, /TEKRAR YAZDIRILDI/);
});

test("prints the branch-local daily receipt number separately from the order reference", () => {
  const text = renderReceiptText(
    job({ document: { ...job().document, receiptNumber: 42 } }),
  );

  assert.match(text, /FİŞ NO:\s+42/);
  assert.match(text, /Sipariş No:\s+A1042/);
});

test("marks extra copies as COPY rather than REPRINT", () => {
  const text = renderReceiptText(job({ isReprint: true, copies: 2 }));

  assert.match(text, /KOPYA/);
});

test("preserves Turkish characters without mangling", () => {
  const text = renderReceiptText(
    job({
      document: {
        ...job().document,
        branchName: "Şirin Şölen Çorbacısı İğdır",
        lines: [{ name: "Türk Kahvesi", quantity: "1" }],
      },
    }),
  );

  assert.match(text, /ŞİRİN ŞÖLEN ÇORBACISI İĞDIR/);
  assert.match(text, /TÜRK KAHVESİ/);
});

test("renders a customer receipt line total using its Turkish currency format", () => {
  const text = renderReceiptText(
    job({
      document: {
        ...job().document,
        currency: "TRY",
        lines: [
          {
            name: "İskender Kebap",
            quantity: "2",
            unitPrice: "125.50",
            lineTotal: "251.00",
          },
        ],
        footer: ["Toplam: 251,00 ₺"],
      },
    }),
  );

  assert.match(text, /2 x İSKENDER KEBAP/);
  assert.match(text, /₺251,00/);
  assert.match(text, /TOPLAM\s+251,00 ₺/);
});

test("renders a cashier bill with clear columns and service charge total", () => {
  const text = renderReceiptText(
    job({
      printerDeviceId: "KASA",
      preparationStationId: null,
      kitchenTicketId: null,
      document: {
        ...job().document,
        title: "Müşteri Bilgi Fişi",
        stationName: "KASA",
        currency: "TRY",
        lines: [
          {
            name: "Türk Kahvesi",
            quantity: "2",
            unitPrice: "90.00",
            lineTotal: "180.00",
          },
        ],
        footer: ["Ara toplam: 180.00", "Servis: 18.00", "Toplam: 198.00"],
      },
    }),
  );

  assert.match(text, /MÜŞTERİ BİLGİ FİŞİ/);
  assert.match(text, /Ürün\s+Tutar/);
  assert.match(text, /2 x Türk Kahvesi\s+₺180,00/);
  assert.match(text, /SERVİS\s+18.00/);
  assert.match(text, /TOPLAM\s+198.00/);
});

test("wraps a line longer than the thermal column instead of truncating it", () => {
  const text = renderReceiptText(
    job({
      document: {
        ...job().document,
        lines: [
          {
            name: "Çok Uzun Bir Ürün Adı Kesinlikle Kırk İki Karakteri Geçiyor",
            quantity: "1",
          },
        ],
      },
    }),
  );

  for (const line of text.split("\n")) {
    assert.ok(line.length <= 42, `line exceeded 42 columns: "${line}"`);
  }
  assert.match(text, /KESİNLİKLE/);
});

test("omits table and waiter lines when the order has neither", () => {
  const { tableName, waiterName, ...withoutTableOrWaiter } = job().document;
  void tableName;
  void waiterName;
  const text = renderReceiptText(job({ document: withoutTableOrWaiter }));

  assert.doesNotMatch(text, /Masa:/);
  assert.doesNotMatch(text, /Garson:/);
});

test("marks complimentary bill lines as İKRAM while preserving a zero total", () => {
  const text = renderReceiptText(
    job({
      printerDeviceId: "KASA",
      preparationStationId: null,
      kitchenTicketId: null,
      document: {
        ...job().document,
        title: "Hesap Özeti",
        stationName: "KASA",
        currency: "TRY",
        lines: [
          {
            name: "Türk Kahvesi",
            quantity: "1",
            lineTotal: "0.00",
            complimentary: true,
          },
        ],
        footer: ["Toplam: 0.00"],
      },
    }),
  );

  assert.match(text, /1 x Türk Kahvesi  İKRAM\s+₺0,00/);
  assert.match(text, /TOPLAM\s+0.00/);
});
