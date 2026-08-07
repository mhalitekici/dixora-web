import type { Metadata } from "next";

import { OrderBuilder } from "@/components/waiter/order-builder";

export const metadata: Metadata = { title: "Garson · Sipariş" };

export default async function WaiterTablePage({
  params,
}: {
  params: Promise<{ tableId: string }>;
}) {
  const { tableId } = await params;
  return <OrderBuilder tableId={tableId} />;
}
