import { OrderManagement } from "@/components/admin/order-management";

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string | string[] }>;
}) {
  const query = await searchParams;
  const order = Array.isArray(query.order) ? query.order[0] : query.order;
  return <OrderManagement initialOrderId={order} />;
}
