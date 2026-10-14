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
      documentType: "PREPARATION",
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

test("renders a compact preparation heading, order, table and waiter", () => {
  const text = renderReceiptText(job());

  assert.doesNotMatch(text, /ALEYİN MUTFAĞI|DODO CAFE/);
  assert.match(text, /MUTFAK FİŞİ/);
  assert.match(text, /Sipariş No:\s+A1042/);
  assert.match(text, /Masa:\s+Salon 7/);
  assert.match(text, /Garson:\s+Ahmet/);
  assert.doesNotMatch(text, /Basım:/);
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
  assert.match(text, /Türk Kahvesi\s+2x/);
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

  assert.match(text, /Adana Kebap\s+1x/);
  assert.match(text, /\+ Az acılı/);
  assert.match(text, /\+ Soğansız/);
  assert.match(text, /Açıklama: Acil/);
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
    job({
      preparationStationId: null,
      document: {
        ...job().document,
        documentType: "BILL",
        receiptNumber: 42,
      },
    }),
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
        title: "Şirin Şölen Fişi",
        lines: [{ name: "Türk Kahvesi İğdır", quantity: "1" }],
      },
    }),
  );

  assert.match(text, /ŞİRİN ŞÖLEN FİŞİ/);
  assert.match(text, /Türk Kahvesi İğdır/);
});

test("renders a customer receipt line total using its Turkish currency format", () => {
  const text = renderReceiptText(
    job({
      printerDeviceId: "KASA",
      preparationStationId: null,
      kitchenTicketId: null,
      document: {
        ...job().document,
        documentType: "BILL",
        stationName: "KASA",
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

  assert.match(text, /Ürün\s+Adet\s+Toplam/);
  assert.doesNotMatch(text, /Birim|₺125,50/);
  assert.match(text, /İskender/);
  assert.match(text, /₺251,00/);
  assert.match(text, /TOPLAM\s+251,00 ₺/);
});

test("never prints prices on a preparation ticket even if price fields are present", () => {
  const text = renderReceiptText(
    job({
      document: {
        ...job().document,
        currency: "TRY",
        lines: [
          { name: "Uzun Türkçe Ürün", quantity: "2", lineTotal: "999.00" },
        ],
      },
    }),
  );
  assert.match(text, /Uzun Türkçe Ürün\s+2x/);
  assert.doesNotMatch(text, /999|₺|TL/);
});

test("uses an adjustable safe width and keeps long Turkish text within it", () => {
  const text = renderReceiptText(
    job({
      document: {
        ...job().document,
        lines: [
          {
            name: "İçecekler İçin Çok Uzun Açıklamalı Türk Kahvesi",
            quantity: "12",
          },
        ],
        footer: [
          "Sipariş notu: Çocuk için acısız ve bütün soslar ayrı kaplarda olsun",
        ],
      },
    }),
    36,
  );
  for (const line of text.split("\n")) assert.ok(line.length <= 36, line);
  assert.match(text, /bütün soslar\nayrı kaplarda/);
});

test("moves long prices below the product instead of truncating narrow receipts", () => {
  const text = renderReceiptText(
    job({
      preparationStationId: null,
      document: {
        ...job().document,
        documentType: "BILL",
        currency: "TRY",
        lines: [
          {
            name: "Çok Uzun Türkçe Ürün Adı",
            quantity: "12",
            unitPrice: "1234567.89",
            lineTotal: "14814814.68",
          },
        ],
        totals: { total: "14814814.68" },
      },
    }),
    32,
  );

  for (const line of text.split("\n")) assert.ok(line.length <= 32, line);
  assert.doesNotMatch(text, /Birim|₺1\.234\.567,89/);
  assert.match(text, /₺14\.814\.814,68/);
});

test("prints source, package identity and staff labels without inventing a table", () => {
  const { tableName, ...packageDocument } = job().document;
  void tableName;
  const text = renderReceiptText(
    job({
      document: {
        ...packageDocument,
        sourceLabel: "PAKET SİPARİŞ",
        orderLabel: "Paket - Ayşe Yılmaz",
        waiterName: "Kasiyer Can",
        staffLabel: "Kasiyer",
      },
    }),
  );
  assert.match(text, /Kaynak:\s+PAKET SİPARİŞ/);
  assert.match(text, /Sipariş:\s+Paket - Ayşe Yılmaz/);
  assert.match(text, /Kasiyer:\s+Kasiyer Can/);
  assert.doesNotMatch(text, /Masa:/);
});

test("prints the QR menu source without inventing staff", () => {
  const { tableName, waiterName, ...qrDocument } = job().document;
  void tableName;
  void waiterName;
  const text = renderReceiptText(
    job({ document: { ...qrDocument, sourceLabel: "QR MENÜ" } }),
  );
  assert.match(text, /Kaynak:\s+QR MENÜ/);
  assert.doesNotMatch(text, /Garson:|Kasiyer:/);
});

test("renders a courier slip with real delivery contact and priced contents", () => {
  const { tableName, waiterName, ...courierDocument } = job().document;
  void tableName;
  void waiterName;
  const text = renderReceiptText(
    job({
      printerDeviceId: "KASA",
      preparationStationId: null,
      kitchenTicketId: null,
      document: {
        ...courierDocument,
        documentType: "COURIER",
        title: "Kurye Fişi",
        sourceLabel: "PAKET SİPARİŞ",
        orderLabel: "Paket sipariş",
        customerName: "Ayşe Yılmaz",
        customerPhone: "0555 111 22 33",
        deliveryAddress: "Atatürk Cad. No: 10, Kadıköy",
        paymentLabel: "Kapıda kart",
        currency: "TRY",
        lines: [
          {
            name: "Cafe Latte",
            quantity: "2",
            unitPrice: "90.00",
            lineTotal: "180.00",
          },
        ],
        totals: { total: "180.00" },
      },
    }),
  );

  assert.match(text, /KURYE FİŞİ/);
  assert.match(text, /Müşteri:\s+Ayşe Yılmaz/);
  assert.match(text, /Telefon:\s+0555 111 22 33/);
  assert.match(text, /Adres:/);
  assert.match(text, /Cafe Latte/);
  assert.match(text, /₺90,00\s+₺180,00/);
  assert.doesNotMatch(text, /Basım:/);
});

test("separates service and cover charges in bill totals", () => {
  const text = renderReceiptText(
    job({
      printerDeviceId: "KASA",
      preparationStationId: null,
      kitchenTicketId: null,
      document: {
        ...job().document,
        documentType: "BILL",
        stationName: "KASA",
        currency: "TRY",
        totals: {
          subtotal: "100.00",
          serviceCharge: "10.00",
          coverCharge: "5.00",
          total: "115.00",
          paid: "50.00",
          remaining: "65.00",
        },
      },
    }),
  );
  assert.match(text, /SERVİS ÜCRETİ\s+₺10,00/);
  assert.match(text, /KUVER ÜCRETİ\s+₺5,00/);
  assert.match(text, /GENEL TOPLAM\s+₺115,00/);
});

test("renders a cashier bill with clear columns and service charge total", () => {
  const text = renderReceiptText(
    job({
      printerDeviceId: "KASA",
      preparationStationId: null,
      kitchenTicketId: null,
      document: {
        ...job().document,
        documentType: "BILL",
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
  assert.match(text, /Ürün\s+Adet\s+Toplam/);
  assert.doesNotMatch(text, /Birim/);
  assert.match(text, /Türk Kahvesi/);
  assert.match(text, /Türk Kahvesi\s+2\s+₺180,00/);
  assert.doesNotMatch(text, /₺90,00/);
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
  assert.match(text, /Kesinlikle/);
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
        documentType: "BILL",
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

  assert.match(text, /Türk Kahvesi\s+1\s+İKRAM/);
  assert.match(text, /TOPLAM\s+0.00/);
});
