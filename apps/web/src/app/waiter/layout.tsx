import type { ReactNode } from "react";

import { OperationalShell } from "@/components/layout/operational-shell";

export default function WaiterLayout({ children }: { children: ReactNode }) {
  return (
    <OperationalShell mode="waiter" userName="Garson">
      {children}
    </OperationalShell>
  );
}
