import type { Metadata } from "next";

import { CashierWorkspace } from "@/components/cashier/cashier-workspace";

export const metadata: Metadata = { title: "Kasa" };

export default function CashierPage() {
  return <CashierWorkspace />;
}
