import type { ReactNode } from "react";

import { OperationalShell } from "@/components/layout/operational-shell";
import { ManagedThemeBootstrap } from "@/components/providers/managed-theme";
import { SessionManagedTheme } from "@/components/providers/session-managed-theme";

export default function CashierLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Paints the theme this device saw last before anything renders; the
          session then confirms or corrects it. */}
      <ManagedThemeBootstrap useStored />
      <SessionManagedTheme />
      <OperationalShell mode="cashier" userName="Kasiyer" fullBleed>
        {children}
      </OperationalShell>
    </>
  );
}
