import type { Metadata } from "next";

import { InventoryManagement } from "@/components/inventory/inventory-management";

export const metadata: Metadata = { title: "Envanter" };

export default function InventoryPage() {
  return <InventoryManagement />;
}
