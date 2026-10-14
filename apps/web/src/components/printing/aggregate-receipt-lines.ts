import type { ReceiptLine } from "./receipt-types";
import { decimalToMinor } from "@/components/qr/qr-utils";

/** Sum stored amounts exactly; bill totals still come from the API. */
export function aggregateReceiptLines(
  lines: readonly ReceiptLine[],
): ReceiptLine[] {
  const grouped = new Map<string, ReceiptLine>();
  for (const line of lines) {
    const quantity = decimalToMinor(String(line.quantity));
    const total = decimalToMinor(String(line.lineTotal));
    const price =
      line.unitPrice == null
        ? unitPriceRatio(total, quantity)
        : decimalToMinor(String(line.unitPrice)).toString();
    const key = JSON.stringify([
      line.productId ?? line.name,
      line.name,
      price,
      line.taxRate == null
        ? null
        : decimalToMinor(String(line.taxRate)).toString(),
      line.discount == null
        ? null
        : decimalToMinor(String(line.discount)).toString(),
      [...(line.modifiers ?? [])].sort(),
      line.note?.trim() || null,
      Boolean(line.complimentary),
    ]);
    const previous = grouped.get(key);
    if (previous) {
      previous.quantity = decimalString(
        decimalToMinor(String(previous.quantity)) + quantity,
      );
      previous.lineTotal = decimalString(
        decimalToMinor(String(previous.lineTotal)) + total,
      );
    } else {
      grouped.set(key, { ...line });
    }
  }
  return [...grouped.values()];
}

function decimalString(minor: bigint): string {
  const absolute = minor < BigInt(0) ? -minor : minor;
  return `${minor < BigInt(0) ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}

function unitPriceRatio(total: bigint, quantity: bigint): string {
  let numerator = total < BigInt(0) ? -total : total;
  let denominator = quantity;
  while (denominator !== BigInt(0)) {
    [numerator, denominator] = [denominator, numerator % denominator];
  }
  const divisor = numerator || BigInt(1);
  return `${total / divisor}/${quantity / divisor}`;
}
