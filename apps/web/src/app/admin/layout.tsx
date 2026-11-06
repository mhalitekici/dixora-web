"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/use-auth";
import { LoadingState } from "@/components/admin/admin-utils";

import { AppShell } from "@/components/layout/app-shell";
import { adminNavigation } from "@/components/layout/nav-config";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const current = useCurrentUser();
  const router = useRouter();
  useEffect(() => {
    if (current.data?.user.staffSession) router.replace("/panels");
  }, [current.data?.user.staffSession, router]);
  if (current.isPending || current.data?.user.staffSession)
    return <LoadingState label="Çalışan paneline geçiliyor…" />;
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
