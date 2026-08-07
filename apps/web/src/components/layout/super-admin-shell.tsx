"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { superAdminNavigation } from "@/components/layout/nav-config";

export function SuperAdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/super-admin/login") return children;
  return (
    <AppShell
      navigation={superAdminNavigation}
      workspaceName="Dixora"
      branchName="Platform Yönetimi"
      userName="Platform Yöneticisi"
      userRole="Süper Yönetici"
      platformMode
    >
      {children}
    </AppShell>
  );
}
