import { OperationAccess } from "@/components/auth/operation-access";
import type { ReactNode } from "react";

import { OperationalShell } from "@/components/layout/operational-shell";
import { ManagedThemeBootstrap } from "@/components/providers/managed-theme";
import { SessionManagedTheme } from "@/components/providers/session-managed-theme";

export default function WaiterLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Paints the theme this device saw last before anything renders; the
          session then confirms or corrects it. */}
      <ManagedThemeBootstrap useStored />
      <SessionManagedTheme />
      <OperationAccess panel="waiter">
        <OperationalShell mode="waiter" userName="Garson">
          {children}
        </OperationalShell>
      </OperationAccess>
    </>
  );
}
