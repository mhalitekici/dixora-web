"use client";

import {
  RECEIPT_KIND_LABELS,
  paymentMethodLabel,
  type ReceiptDocument,
} from "@/components/printing/receipt-types";

const money = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function amount(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return `${money.format(Number(value))} TL`;
}

function quantity(value: string | number): string {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? String(numeric) : money.format(numeric);
}

function dateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

/**
 * One 80mm thermal receipt, shared by every print surface.
 *
 * Deliberately monochrome with no backgrounds or images: thermal heads only
 * render black on white, and shaded blocks waste paper and burn the head.
 * The layout is a fixed 80mm column so the browser's print pipeline produces
 * the same output a receipt printer driver expects.
 */
export function ThermalReceipt({
  document: doc,
  printTarget = false,
}: {
  document: ReceiptDocument;
  /** Marks this copy as the one the print stylesheet should send to paper. */
  printTarget?: boolean;
}) {
  const kindLabel = RECEIPT_KIND_LABELS[doc.kind];
  const { business, meta, totals } = doc;

  return (
    <div
      className="dixora-receipt"
      data-receipt-kind={doc.kind}
      data-print-target={printTarget ? "true" : undefined}
    >
      <header className="receipt-head">
        <h1>{business.name}</h1>
        {business.branch ? <p>{business.branch}</p> : null}
        {business.address ? <p>{business.address}</p> : null}
        {business.phone ? <p>{business.phone}</p> : null}
        <p className="receipt-title">{doc.title}</p>
        {kindLabel ? <p className="receipt-kind">*** {kindLabel} ***</p> : null}
      </header>

      <div className="receipt-rule" />

      <dl className="receipt-meta">
        {meta.reference ? (
          <Row label="Fiş No" value={meta.reference} />
        ) : null}
        {meta.tableName ? <Row label="Masa" value={meta.tableName} /> : null}
        {meta.roomNumber ? <Row label="Oda" value={meta.roomNumber} /> : null}
        {meta.guestName ? <Row label="Misafir" value={meta.guestName} /> : null}
        {meta.staffName ? <Row label="Personel" value={meta.staffName} /> : null}
        {meta.checkedInAt ? (
          <Row label="Giriş" value={dateTime(meta.checkedInAt)} />
        ) : null}
        {meta.checkedOutAt ? (
          <Row label="Çıkış" value={dateTime(meta.checkedOutAt)} />
        ) : null}
        <Row label="Tarih" value={dateTime(meta.issuedAt)} />
      </dl>

      <div className="receipt-rule" />

      <ul className="receipt-lines">
        {doc.lines.map((line, index) => (
          <li key={`${line.name}-${index}`}>
            <div className="receipt-line">
              <span className="receipt-line-name">
                {quantity(line.quantity)} x {line.name}
              </span>
              <span className="receipt-line-total">{amount(line.lineTotal)}</span>
            </div>
            {line.unitPrice != null && Number(line.quantity) !== 1 ? (
              <p className="receipt-line-sub">Birim {amount(line.unitPrice)}</p>
            ) : null}
            {line.modifiers?.length ? (
              <p className="receipt-line-sub">+ {line.modifiers.join(", ")}</p>
            ) : null}
            {line.note ? <p className="receipt-line-sub">Not: {line.note}</p> : null}
          </li>
        ))}
        {doc.lines.length === 0 ? (
          <li>
            <p className="receipt-line-sub">Kayıtlı ürün yok</p>
          </li>
        ) : null}
      </ul>

      <div className="receipt-rule" />

      <dl className="receipt-totals">
        {totals.subtotal != null ? (
          <Row label="Ara toplam" value={amount(totals.subtotal)} />
        ) : null}
        {totals.discount != null && Number(totals.discount) > 0 ? (
          <Row label="İndirim" value={`- ${amount(totals.discount)}`} />
        ) : null}
        {totals.tax != null && Number(totals.tax) > 0 ? (
          <Row label="KDV" value={amount(totals.tax)} />
        ) : null}
        <Row label="TOPLAM" value={amount(totals.total)} strong />
      </dl>

      {doc.payments?.length ? (
        <>
          <div className="receipt-rule" />
          <dl className="receipt-totals">
            {doc.payments.map((payment, index) => (
              <Row
                key={`${payment.method}-${index}`}
                label={
                  payment.reference
                    ? `${paymentMethodLabel(payment.method)} (${payment.reference})`
                    : paymentMethodLabel(payment.method)
                }
                value={amount(payment.amount)}
              />
            ))}
            {totals.remaining != null && Number(totals.remaining) > 0 ? (
              <Row label="KALAN" value={amount(totals.remaining)} strong />
            ) : null}
          </dl>
        </>
      ) : null}

      <div className="receipt-rule" />
      <p className="receipt-footer">
        {doc.footerNote ?? "Bizi tercih ettiğiniz için teşekkür ederiz."}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className={strong ? "receipt-row receipt-row-strong" : "receipt-row"}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
