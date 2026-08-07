export type CashierOrderReference = {
  table_id?: string | null;
  table_name?: string | null;
  table_session_id?: string | null;
  status: string;
};

export type CashierTableReference = {
  id: string;
  name: string;
  state: string;
};

export const terminalOrderStatuses: ReadonlySet<string> = new Set([
  "PAID",
  "CANCELLED",
  "VOIDED",
]);

function belongsToTable(
  order: CashierOrderReference,
  table: CashierTableReference,
): boolean {
  return order.table_id
    ? order.table_id === table.id
    : order.table_name === table.name;
}

export function selectCurrentTableOrder<T extends CashierOrderReference>(
  orders: readonly T[],
  table: CashierTableReference | null | undefined,
): T | null {
  if (!table) return null;
  const tableOrders = orders.filter((order) => belongsToTable(order, table));
  const openOrder = tableOrders.find(
    (order) => !terminalOrderStatuses.has(order.status),
  );
  if (openOrder) return openOrder;
  if (table.state === "AVAILABLE" || table.state === "DISABLED") return null;
  return tableOrders.find((order) => terminalOrderStatuses.has(order.status)) ?? null;
}

export function canCloseTableSession(
  order: CashierOrderReference | null,
  table: CashierTableReference | null | undefined,
  remainingBalance: number,
): boolean {
  if (!order?.table_session_id || !table) return false;
  if (table.state === "AVAILABLE" || table.state === "DISABLED") return false;
  if (!terminalOrderStatuses.has(order.status)) return false;
  return order.status !== "PAID" || remainingBalance <= 0.005;
}

