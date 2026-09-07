import type { PrintJobClaim, ReceiptLine } from "@dixora/shared-types";

/**
 * Renders one normalized receipt document into plain 80mm-column text.
 *
 * Deliberately plain text, not raw ESC/POS byte sequences: every transport
 * this bridge ships (Windows `Out-Printer`, macOS `lp`) hands a *generic*
 * text/PDF job to the OS print spooler rather than talking to the printer's
 * command set directly, so the same renderer output works unmodified on any
 * printer the operating system already treats as installed — brand, USB or
 * network, doesn't matter. See "Known limits" in docs/printing.md for what
 * that trades away (no programmatic paper cut).
 */
const COLUMN_WIDTH = 42; // Standard for an 80mm thermal head at 12cpi.
const RULE = "-".repeat(COLUMN_WIDTH);

export function renderReceiptText(job: PrintJobClaim): string {
  const doc = job.document;
  const lines: string[] = [];

  // Plain .toUpperCase() turns Turkish "i" into "I", not "İ" — a receipt
  // header for "Aleyin Mutfağı" would silently misspell the business name.
  lines.push(...center(job.document.branchName.toLocaleUpperCase("tr")));
  lines.push(...center(doc.title));
  if (job.isReprint) {
    lines.push(...center(job.copies > 1 ? "KOPYA" : "TEKRAR YAZDIRILDI"));
  }
  lines.push("");
  lines.push(`Sipariş #${doc.orderNumber}`);
  if (doc.tableName) {
    lines.push(`Masa: ${doc.tableName}`);
  }
  if (doc.waiterName) {
    lines.push(`Garson: ${doc.waiterName}`);
  }
  lines.push(`Saat: ${formatTime(doc.submittedAt)}`);
  lines.push(RULE);

  for (const line of doc.lines) {
    lines.push(...renderLine(line, doc.currency));
  }

  if (doc.footer && doc.footer.length > 0) {
    lines.push(RULE);
    for (const footerLine of doc.footer) {
      lines.push(...wrap(footerLine));
    }
  }

  lines.push(RULE);
  lines.push(...center(new Date().toLocaleString("tr-TR")));
  // Trailing blank lines give the auto-cutter (when the printer/driver honours
  // one) enough feed to clear the blade before the next job starts.
  lines.push("", "", "");

  return lines.join("\n");
}

function renderLine(line: ReceiptLine, currency?: string): string[] {
  const out: string[] = [];
  const quantity = `${line.quantity}x`;
  const head = `${quantity} ${line.name}`.trim();
  const price = line.lineTotal ?? line.unitPrice;
  const priceText = price ? formatAmount(price, currency) : undefined;
  const headWithPrice = priceText ? `${head}  ${priceText}` : head;

  if (headWithPrice.length <= COLUMN_WIDTH) {
    out.push(headWithPrice);
  } else {
    out.push(...wrap(head));
    if (priceText) {
      out.push(...wrap(`   ${priceText}`));
    }
  }
  for (const modifier of line.modifiers ?? []) {
    out.push(...wrap(`   - ${modifier}`));
  }
  if (line.note) {
    out.push(...wrap(`   * ${line.note}`));
  }
  return out;
}

/** Turkish text is never truncated silently — it wraps onto the next line. */
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
