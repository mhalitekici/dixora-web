type BillSnapshot = {
  id: string;
  total: string | number;
  items: Array<{
    id: string;
    status: string;
    quantity: string | number;
    line_total: string | number;
    note?: string | null;
    is_complimentary?: boolean;
  }>;
};

/** Repeated clicks reuse a job; added portions or edited lines get a fresh bill. */
export function originalBillPrintKey(order: BillSnapshot): string {
  const content = JSON.stringify({
    total: Number(order.total),
    lines: order.items
      .filter((item) => !["CANCELLED", "VOIDED"].includes(item.status))
      .map((item) => ({
        id: item.id,
        quantity: Number(item.quantity),
        total: Number(item.line_total),
        note: item.note ?? "",
        complimentary: item.is_complimentary ?? false,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  let hash = BigInt("0xcbf29ce484222325");
  for (let index = 0; index < content.length; index++) {
    hash = BigInt.asUintN(
      64,
      (hash ^ BigInt(content.charCodeAt(index))) * BigInt("0x100000001b3"),
    );
  }
  return `bill-original:${order.id}:${hash.toString(16)}`;
}
