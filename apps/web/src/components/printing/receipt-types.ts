/**
 * Shared shape for every 80mm thermal receipt Dixora prints.
 *
 * All monetary values arrive as strings/Decimals from the API and are only
 * formatted for display here — no arithmetic is performed on floats, and no
 * total is recomputed client-side. Line text uses the order's *snapshot*
 * fields so a reprint months later still shows what the guest actually
 * bought, not today's catalog name or price.
 */

export type ReceiptKind = "ORIGINAL" | "COPY" | "REPRINT" | "TEST";

export interface ReceiptBusiness {
  name: string;
  branch?: string | null;
  address?: string | null;
  phone?: string | null;
}

export interface ReceiptLine {
  /** Snapshot name captured when the item was ordered. */
  name: string;
  quantity: string | number;
  unitPrice?: string | number | null;
  lineTotal: string | number;
  /** Chosen modifiers, already snapshotted. */
  modifiers?: string[];
  note?: string | null;
}

export interface ReceiptPayment {
  method: string;
  amount: string | number;
  reference?: string | null;
}

export interface ReceiptTotals {
  subtotal?: string | number | null;
  discount?: string | number | null;
  tax?: string | number | null;
  total: string | number;
  paid?: string | number | null;
  remaining?: string | number | null;
}

export interface ReceiptMeta {
  /** Short human reference, never a raw internal UUID. */
  reference?: string | null;
  tableName?: string | null;
  roomNumber?: string | null;
  guestName?: string | null;
  staffName?: string | null;
  issuedAt: string;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
}

export interface ReceiptDocument {
  kind: ReceiptKind;
  /** Heading under the business name, e.g. "ADİSYON" or "ODA HESABI". */
  title: string;
  business: ReceiptBusiness;
  meta: ReceiptMeta;
  lines: ReceiptLine[];
  totals: ReceiptTotals;
  payments?: ReceiptPayment[];
  footerNote?: string | null;
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Nakit",
  CARD: "Kart",
  ROOM_CHARGE: "Oda",
  OTHER: "Diğer",
};

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

export const RECEIPT_KIND_LABELS: Record<ReceiptKind, string | null> = {
  // An original prints without a banner; every non-original is marked so a
  // duplicate can never be mistaken for the first copy.
  ORIGINAL: null,
  COPY: "KOPYA",
  REPRINT: "YENİDEN YAZDIRMA",
  TEST: "TEST BASKISI",
};
