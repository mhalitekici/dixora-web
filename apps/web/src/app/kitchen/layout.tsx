import type { ReactNode } from "react";

import { OperationalShell } from "@/components/layout/operational-shell";

export default function KitchenLayout({ children }: { children: ReactNode }) {
  return (
    <OperationalShell
      mode="kitchen"
      userName="Mutfak Kullanıcısı"
      stationName="Hazırlık istasyonu"
      fullBleed
    >
      {children}
    </OperationalShell>
  );
}
