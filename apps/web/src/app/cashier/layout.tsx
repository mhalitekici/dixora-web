import type { ReactNode } from "react";

import { OperationalShell } from "@/components/layout/operational-shell";

export default function CashierLayout({ children }: { children: ReactNode }) {
  return (
    <OperationalShell mode="cashier" userName="Kasiyer" fullBleed>
      {children}
    </OperationalShell>
  );
}
