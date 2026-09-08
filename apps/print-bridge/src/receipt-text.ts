import type { PrintJobClaim, ReceiptLine } from "@dixora/shared-types";

/**
 * Renders one normalized receipt document into plain 80mm-column text.
 *
 * The desktop bridge sends text jobs through the operating system spooler
 * rather than raw ESC/POS bytes. That keeps any installed Windows/macOS printer
 * usable, while this renderer owns the alignment, Turkish casing and hierarchy.
 */
const COLUMN_WIDTH = 42; // Standard for an 80mm thermal head at 12cpi.
const RULE = "-".repeat(COLUMN_WIDTH);
const HEAVY_RULE = "=".repeat(COLUMN_WIDTH);

export function renderReceiptText(job: PrintJobClaim): string {
  const doc = job.document;
  const lines: string[] = [];
  const isBill = doc.stationName.toLocaleUpperCase("tr").includes("KASA");

  lines.push(HEAVY_RULE);
  if (doc.businessName) {
    lines.push(...center(doc.businessName.toLocaleUpperCase("tr")));
  }
  lines.push(...center(doc.branchName.toLocaleUpperCase("tr")));
  lines.push(...center(doc.title.toLocaleUpperCase("tr")));
  if (doc.stationName && doc.stationName !== doc.title) {
    lines.push(...center(doc.stationName.toLocaleUpperCase("tr")));
  }
  if (job.isReprint) {
    lines.push(...center(job.copies > 1 ? "KOPYA" : "TEKRAR YAZDIRILDI"));
  }
  if (job.isTestPrint) {
    lines.push(...center("TEST ÇIKTISI"));
  }
  lines.push(HEAVY_RULE);
  lines.push(meta("Sipariş No", doc.orderNumber));
  if (doc.tableName) {
    lines.push(meta("Masa", doc.tableName));
  }
  if (doc.waiterName) {
    lines.push(meta("Garson", doc.waiterName));
  }
  lines.push(meta("Saat", formatTime(doc.submittedAt)));
  lines.push(meta("Tarih", formatDate(doc.submittedAt)));
  lines.push(RULE);

  if (isBill) {
    lines.push(twoColumns("Ürün", "Tutar"));
    lines.push(RULE);
  }

  for (const line of doc.lines) {
    lines.push(...renderLine(line, doc.currency, !isBill));
  }

  if (doc.footer && doc.footer.length > 0) {
    lines.push(RULE);
    for (const footerLine of doc.footer) {
      lines.push(...renderFooterLine(footerLine));
    }
  }

  lines.push(HEAVY_RULE);
  lines.push(...center(`Basım: ${new Date().toLocaleString("tr-TR")}`));
  lines.push("", "", "");

  return lines.join("\n");
}

function renderLine(
  line: ReceiptLine,
  currency?: string,
  emphasizeName = false,
): string[] {
  const out: string[] = [];
  if (line.adjustmentLabel) {
    out.push(
      ...center(`*** ${line.adjustmentLabel.toLocaleUpperCase("tr")} ***`),
    );
  }
  const name = emphasizeName ? line.name.toLocaleUpperCase("tr") : line.name;
  const complimentary = line.complimentary ? "  İKRAM" : "";
  const head = `${line.quantity} x ${name}${complimentary}`.trim();
  const price = line.lineTotal ?? line.unitPrice;
  const priceText = price ? formatAmount(price, currency) : undefined;

  if (priceText) {
    out.push(...renderPricedLine(head, priceText));
  } else {
    out.push(...wrap(head));
  }
  for (const modifier of line.modifiers ?? []) {
    out.push(...wrap(`  + ${modifier}`));
  }
  if (line.note) {
    out.push(...wrap(`  Not: ${line.note}`));
  }
  return out;
}

function renderPricedLine(left: string, right: string): string[] {
  if (left.length + right.length + 1 <= COLUMN_WIDTH) {
    return [twoColumns(left, right)];
  }
  return [...wrap(left), twoColumns("", right)];
}

function renderFooterLine(line: string): string[] {
  const separator = line.indexOf(":");
  if (separator === -1) return wrap(line);
  const label = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (!value) return wrap(line);
  return [twoColumns(label.toLocaleUpperCase("tr"), value)];
}

/** Turkish text is never truncated silently; it wraps onto the next line. */
function wrap(text: string): string[] {
  const words = text.split(" ");
  const wrapped: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > COLUMN_WIDTH) {
      if (current) {
        wrapped.push(current);
        current = "";
      }
      let remaining = word;
      while (remaining.length > COLUMN_WIDTH) {
        wrapped.push(remaining.slice(0, COLUMN_WIDTH));
        remaining = remaining.slice(COLUMN_WIDTH);
      }
      current = remaining;
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > COLUMN_WIDTH) {
      if (current) wrapped.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) wrapped.push(current);
  return wrapped.length > 0 ? wrapped : [""];
}

function center(text: string): string[] {
  return wrap(text).map((line) => {
    const padding = Math.floor((COLUMN_WIDTH - line.length) / 2);
    return " ".repeat(padding) + line;
  });
}

function meta(label: string, value: string): string {
  return twoColumns(`${label}:`, value);
}

function twoColumns(left: string, right: string): string {
  if (left.length + right.length + 1 > COLUMN_WIDTH) {
    const room = Math.max(0, COLUMN_WIDTH - right.length - 1);
    return `${left.slice(0, room)} ${right}`.trimEnd();
  }
  return `${left}${" ".repeat(COLUMN_WIDTH - left.length - right.length)}${right}`;
}

function formatAmount(amount: string, currency?: string): string {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    return currency ? `${amount} ${currency}` : amount;
  }
  if (!currency) {
    return new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);
  }
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${amount} ${currency}`;
  }
}

function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
