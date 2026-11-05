"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, UserRoundCog } from "lucide-react";

import { CustomRoleEditor } from "./custom-role-editor";
import { PageHeader } from "@/components/shared/page-header";
import { adminApi, adminKeys } from "./admin-api";
import { ErrorState, LoadingState } from "./admin-utils";

export function RoleManagement() {
  const query = useQuery({
    queryKey: adminKeys.roles(),
    queryFn: ({ signal }) => adminApi.roles(signal),
  });

  if (query.isLoading)
    return <LoadingState label="Rol presetleri yükleniyor…" />;
  if (query.error)
    return (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );

  const roles = query.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Ekip ve erişim"
        title="Roller ve yetkiler"
        description="Sistem rollerini kopyalayın, özel rolleri düzenleyin ve çalışanlara ihtiyacı kadar yetki verin."
        icon={ShieldCheck}
      />

      <CustomRoleEditor roles={roles} />

      <div className="mt-4 flex items-start gap-3 rounded-xl border bg-muted/30 p-4">
        <UserRoundCog className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">İşletme sahibi ayrı bir sistem hesabıdır</p>
          <p className="mt-1 text-sm text-muted-foreground">
            İşletme Sahibi rolü çalışanlara atanamaz, devre dışı bırakılamaz ve bu preset listesinde
            yer almaz.
          </p>
        </div>
      </div>
    </>
  );
}
