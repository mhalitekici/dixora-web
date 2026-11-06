"use client";

import { useState } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { OperationPanels } from "@/components/auth/operation-panels";
import { Button } from "@/components/ui/button";
import { ShiftLogoutGuard } from "@/components/cashier/shift-logout-guard";
import { useLogout } from "@/hooks/use-auth";
import { ManagedThemeBootstrap } from "@/components/providers/managed-theme";
import { SessionManagedTheme } from "@/components/providers/session-managed-theme";

export default function PanelsPage() {
  const [exit, setExit] = useState(false);
  const logout = useLogout({
    onSettled: () => window.location.replace("/login"),
  });
  return (
    <>
      <ManagedThemeBootstrap useStored />
      <SessionManagedTheme />
      <div className="min-h-dvh bg-background">
        <header className="flex min-h-20 items-center justify-between gap-4 border-b px-5 sm:px-8">
          <BrandLogo className="h-9" />
          <Button
            variant="outline"
            onClick={() => setExit(true)}
            disabled={logout.isPending}
          >
            Çıkış yap
          </Button>
        </header>
        <main id="dixora-main" className="mx-auto max-w-3xl px-5 py-8 sm:py-14">
          <OperationPanels />
        </main>
        <ShiftLogoutGuard
          open={exit}
          onOpenChange={setExit}
          onLogoutAnyway={() => logout.mutate()}
        />
      </div>
    </>
  );
}
