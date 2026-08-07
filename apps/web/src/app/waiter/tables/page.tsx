import type { Metadata } from "next";

import { WaiterTableList } from "@/components/waiter/waiter-table-list";

export const metadata: Metadata = { title: "Garson · Masalar" };

export default function WaiterTablesPage() {
  return <WaiterTableList />;
}
