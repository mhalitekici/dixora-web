"use client";

import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { adminNavigation } from "@/components/layout/nav-config";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      navigation={adminNavigation}
      workspaceName="Dixora İşletmesi"
      branchName="Aktif şube"
      userName="Dixora Kullanıcısı"
      userRole="İşletme kullanıcısı"
    >
      {children}
    </AppShell>
  );
}
