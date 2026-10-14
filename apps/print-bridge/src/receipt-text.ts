import type { PrintJobClaim, ReceiptLine } from "@dixora/shared-types";

const DEFAULT_COLUMN_WIDTH = 42;

/** Render a normalized receipt for the OS text spooler without truncating text. */
export function renderReceiptText(
  job: PrintJobClaim,
  columnWidth = DEFAULT_COLUMN_WIDTH,
): string {
  const doc = job.document;
  const out: string[] = [];
  const documentType =
    doc.documentType ??
    (doc.totals !== undefined ||
    (job.preparationStationId === null &&
      doc.stationName.toLocaleUpperCase("tr") === "KASA")
      ? "BILL"
      : job.isTestPrint
        ? "TEST"
        : "PREPARATION");
  const isPreparation = documentType === "PREPARATION";
  const showPrices = documentType === "BILL" || documentType === "COURIER";
  const rule = "-".repeat(columnWidth);
  const heavyRule = "=".repeat(columnWidth);

  out.push(heavyRule);
  if (!isPreparation) {
    if (doc.businessName)
      out.push(
        ...center(doc.businessName.toLocaleUpperCase("tr"), columnWidth),
      );
    out.push(...center(doc.branchName.toLocaleUpperCase("tr"), columnWidth));
  }
  out.push(...center(doc.title.toLocaleUpperCase("tr"), columnWidth));
  if (job.isReprint)
    out.push(
      ...center(job.copies > 1 ? "KOPYA" : "TEKRAR YAZDIRILDI", columnWidth),
    );
  if (job.isTestPrint) out.push(...center("TEST ÇIKTISI", columnWidth));
  out.push(heavyRule);

  if (!isPreparation && doc.receiptNumber !== undefined)
    out.push(...meta("FİŞ NO", String(doc.receiptNumber), columnWidth));
  out.push(...meta("Sipariş No", doc.orderNumber, columnWidth));
  if (doc.tableName) out.push(...meta("Masa", doc.tableName, columnWidth));
  else if (doc.orderLabel)
    out.push(...meta("Sipariş", doc.orderLabel, columnWidth));
  if (
    doc.sourceLabel &&
    (!doc.waiterName || !["GARSON", "KASA"].includes(doc.sourceLabel))
  )
    out.push(...meta("Kaynak", doc.sourceLabel, columnWidth));
  if (doc.waiterName)
    out.push(...meta(doc.staffLabel ?? "Garson", doc.waiterName, columnWidth));
  if (documentType === "COURIER") {
    if (doc.customerName)
      out.push(...meta("Müşteri", doc.customerName, columnWidth));
    if (doc.customerPhone)
      out.push(...meta("Telefon", doc.customerPhone, columnWidth));
    if (doc.deliveryAddress)
      out.push(...meta("Adres", doc.deliveryAddress, columnWidth));
    if (doc.paymentLabel)
      out.push(...meta("Ödeme", doc.paymentLabel, columnWidth));
  }
  out.push(...meta("Tarih", formatDate(doc.submittedAt), columnWidth));
  out.push(...meta("Saat", formatTime(doc.submittedAt), columnWidth));
  out.push(rule);

  if (showPrices)
    out.push(
      ...pricedTable(
        doc.lines,
        doc.currency,
        columnWidth,
        documentType === "COURIER",
      ),
      rule,
    );
  else {
    for (const line of doc.lines)
      out.push(...preparationLine(line, columnWidth));
  }

  if (doc.totals) {
    const totals = doc.totals;
    out.push(rule);
    if (totals.subtotal !== undefined)
      out.push(
        totalLine("Ara toplam", totals.subtotal, doc.currency, columnWidth),
      );
    if (Number(totals.discount ?? 0) > 0)
      out.push(
        totalLine("İndirim", `-${totals.discount}`, doc.currency, columnWidth),
      );
    if (Number(totals.tax ?? 0) > 0)
      out.push(totalLine("Vergi", totals.tax!, doc.currency, columnWidth));
    if (Number(totals.serviceCharge ?? 0) > 0)
      out.push(
        totalLine(
          "Servis ücreti",
          totals.serviceCharge!,
          doc.currency,
          columnWidth,
        ),
      );
    if (Number(totals.coverCharge ?? 0) > 0)
      out.push(
        totalLine(
          "Kuver ücreti",
          totals.coverCharge!,
          doc.currency,
          columnWidth,
        ),
      );
    out.push(
      totalLine("GENEL TOPLAM", totals.total, doc.currency, columnWidth),
    );
    if (totals.paid !== undefined && Number(totals.paid) > 0)
      out.push(totalLine("Ödenen", totals.paid, doc.currency, columnWidth));
    if (totals.remaining !== undefined)
      out.push(totalLine("Kalan", totals.remaining, doc.currency, columnWidth));
  }

  if (doc.footer?.length) {
    out.push(rule);
    for (const line of doc.footer)
      out.push(...renderFooterLine(line, columnWidth));
  }

  out.push(heavyRule, "", "", "");
  return out.join("\n");
}

function preparationLine(line: ReceiptLine, columnWidth: number): string[] {
  const quantity = `${line.quantity}x`;
  const nameWidth = Math.max(8, columnWidth - quantity.length - 1);
  const names = wrap(line.name, nameWidth);
  const out = names.map((name, index) =>
    index === 0 ? twoColumns(name, quantity, columnWidth) : name,
  );
  if (line.adjustmentLabel)
    out.unshift(
      ...center(
        `*** ${line.adjustmentLabel.toLocaleUpperCase("tr")} ***`,
        columnWidth,
      ),
    );
  for (const modifier of line.modifiers ?? [])
    out.push(...wrap(`  + ${modifier}`, columnWidth));
  if (line.note) out.push(...wrap(`  Açıklama: ${line.note}`, columnWidth));
  return out;
}

function pricedTable(
  lines: readonly ReceiptLine[],
  currency: string | undefined,
  columnWidth: number,
  showUnitPrice: boolean,
): string[] {
  const rendered = lines.map((line) => ({
    line,
    quantity: String(line.quantity),
    unit: formatAmount(line.unitPrice ?? "0", currency),
    total: line.complimentary
      ? "İKRAM"
      : formatAmount(line.lineTotal ?? line.unitPrice ?? "0", currency),
  }));
  const quantityWidth = Math.min(
    5,
    Math.max(4, ...rendered.map((item) => item.quantity.length)),
  );
  const totalWidth = Math.max(6, ...rendered.map((item) => item.total.length));
  const unitWidth = showUnitPrice
    ? Math.max(5, ...rendered.map((item) => item.unit.length))
    : 0;
  const nameWidth =
    columnWidth -
    quantityWidth -
    totalWidth -
    2 -
    (showUnitPrice ? unitWidth + 1 : 0);
  if (nameWidth < 6) {
    return compactPricedTable(rendered, columnWidth, showUnitPrice);
  }
  const out = [
    columns(
      ["Ürün", nameWidth],
      ["Adet", quantityWidth],
      ...(showUnitPrice ? [["Birim", unitWidth] as [string, number]] : []),
      ["Toplam", totalWidth],
    ),
  ];
  for (const item of rendered) {
    if (item.line.adjustmentLabel)
      out.push(
        ...center(
          `*** ${item.line.adjustmentLabel.toLocaleUpperCase("tr")} ***`,
          columnWidth,
        ),
      );
    const names = wrap(item.line.name, nameWidth);
    out.push(
      columns(
        [names[0] ?? "", nameWidth],
        [item.quantity, quantityWidth],
        ...(showUnitPrice ? [[item.unit, unitWidth] as [string, number]] : []),
        [item.total, totalWidth],
      ),
    );
    for (const continuation of names.slice(1)) out.push(continuation);
    for (const modifier of item.line.modifiers ?? [])
      out.push(...wrap(`  + ${modifier}`, columnWidth));
    if (item.line.note)
      out.push(...wrap(`  Açıklama: ${item.line.note}`, columnWidth));
  }
  return out;
}

function compactPricedTable(
  rendered: Array<{
    line: ReceiptLine;
    quantity: string;
    unit: string;
    total: string;
  }>,
  columnWidth: number,
  showUnitPrice: boolean,
): string[] {
  const out = [twoColumns("Ürün", "Adet", columnWidth)];
  for (const item of rendered) {
    if (item.line.adjustmentLabel)
      out.push(
        ...center(
          `*** ${item.line.adjustmentLabel.toLocaleUpperCase("tr")} ***`,
          columnWidth,
        ),
      );
    const quantity = `${item.quantity}x`;
    const names = wrap(
      item.line.name,
      Math.max(6, columnWidth - quantity.length - 1),
    );
    out.push(twoColumns(names[0] ?? "", quantity, columnWidth));
    out.push(...names.slice(1));
    if (showUnitPrice) out.push(...meta("Birim", item.unit, columnWidth));
    out.push(...meta("Toplam", item.total, columnWidth));
    for (const modifier of item.line.modifiers ?? [])
      out.push(...wrap(`  + ${modifier}`, columnWidth));
    if (item.line.note)
      out.push(...wrap(`  Açıklama: ${item.line.note}`, columnWidth));
  }
  return out;
}

function columns(...values: Array<[string, number]>): string {
  return values
    .map(([value, width], index) => {
      const safe = value.length > width ? value.slice(0, width) : value;
      return index === 0 ? safe.padEnd(width) : safe.padStart(width);
    })
    .join(" ");
}

function renderFooterLine(line: string, columnWidth: number): string[] {
  const separator = line.indexOf(":");
  if (separator === -1) return center(line, columnWidth);
  const label = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (!value) return wrap(line, columnWidth);
  const upperLabel = label.toLocaleUpperCase("tr");
  return upperLabel.length + value.length + 1 <= columnWidth
    ? [twoColumns(upperLabel, value, columnWidth)]
    : [upperLabel, ...wrap(value, columnWidth)];
}

function wrap(text: string, columnWidth: number): string[] {
  const wrapped: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    if (word.length > columnWidth) {
      if (current) wrapped.push(current);
      current = "";
      let remaining = word;
      while (remaining.length > columnWidth) {
        wrapped.push(remaining.slice(0, columnWidth));
        remaining = remaining.slice(columnWidth);
      }
      current = remaining;
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > columnWidth) {
      if (current) wrapped.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) wrapped.push(current);
  return wrapped.length ? wrapped : [""];
}

function center(text: string, columnWidth: number): string[] {
  return wrap(text, columnWidth).map(
    (line) => " ".repeat(Math.floor((columnWidth - line.length) / 2)) + line,
  );
}

function meta(label: string, value: string, columnWidth: number): string[] {
  const heading = `${label}:`;
  return heading.length + value.length + 1 <= columnWidth
    ? [twoColumns(heading, value, columnWidth)]
    : [heading, ...wrap(value, columnWidth)];
}

function twoColumns(left: string, right: string, columnWidth: number): string {
  if (right.length >= columnWidth) return right.slice(0, columnWidth);
  if (left.length + right.length + 1 > columnWidth)
    return `${left.slice(0, columnWidth - right.length - 1)} ${right}`;
  return `${left}${" ".repeat(columnWidth - left.length - right.length)}${right}`;
}

function totalLine(
  label: string,
  value: string,
  currency: string | undefined,
  columnWidth: number,
): string {
  return twoColumns(
    label.toLocaleUpperCase("tr"),
    formatAmount(value, currency),
    columnWidth,
  );
}

function formatAmount(amount: string, currency?: string): string {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric))
    return currency ? `${amount} ${currency}` : amount;
  if (!currency)
    return new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);
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
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleTimeString("tr-TR", {
        hour: "2-digit",
        minute: "2-digit",
      });
}

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleDateString("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
}
