import type { Metadata } from "next";

import { CashierShiftGate } from "@/components/cashier/cashier-shift-gate";

export const metadata: Metadata = { title: "Kasa" };

export default function CashierPage() {
  return <CashierShiftGate />;
}
