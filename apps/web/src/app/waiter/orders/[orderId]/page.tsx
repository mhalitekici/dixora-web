import type { Metadata } from "next";

import { OrderStatusView } from "@/components/waiter/order-status-view";

export const metadata: Metadata = { title: "Sipariş Durumu" };

export default async function WaiterOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return <OrderStatusView orderId={orderId} />;
}
