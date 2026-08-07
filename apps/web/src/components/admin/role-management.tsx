"use client";

import { useQuery } from "@tanstack/react-query";
import { ChefHat, HandPlatter, ShieldCheck, Store, UserRoundCog } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { adminApi, adminKeys } from "./admin-api";
import { ErrorState, LoadingState } from "./admin-utils";

const roleDetails = {
  BUSINESS_ADMIN: {
    icon: ShieldCheck,
    scope: "Tüm şubeler",
    summary: "İşletme ayarları, ekip, katalog ve operasyon yönetimi",
  },
  BUSINESS_MANAGER: {
    icon: Store,
    scope: "Atanan şube",
    summary: "Günlük şube operasyonu, rapor, sipariş ve mutfak yönetimi",
  },
  WAITER: {
    icon: HandPlatter,
    scope: "Atanan şube",
    summary: "Masa, sipariş, QR talebi ve müşteri servis akışı",
  },
  KITCHEN: {
    icon: ChefHat,
    scope: "Şube + istasyon",
    summary: "Atanan hazırlık istasyonundaki mutfak biletleri",
  },
} as const;

export function RoleManagement() {
  const query = useQuery({
    queryKey: adminKeys.roles(),
    queryFn: ({ signal }) => adminApi.roles(signal),
  });

  if (query.isLoading) return <LoadingState label="Rol presetleri yükleniyor…" />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const roles = query.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Ekip ve erişim"
        title="Roller ve yetkiler"
        description="Çalışan erişimleri dört sabit preset üzerinden yönetilir; yetki setleri sunucuda korunur."
        icon={ShieldCheck}
      />

      <SectionCard
        title="Atanabilir roller"
        description="Rol seçimi çalışan hesabında şube ve hazırlık istasyonu alanlarını otomatik belirler."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rol</TableHead>
              <TableHead>Çalışma kapsamı</TableHead>
              <TableHead className="hidden lg:table-cell">Yetki özeti</TableHead>
              <TableHead className="text-right">Durum</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role) => {
              const detail = roleDetails[role.code as keyof typeof roleDetails];
              if (!detail) return null;
              const Icon = detail.icon;
              return (
                <TableRow key={role.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <div>
                        <p className="font-medium">{role.name}</p>
                        <p className="text-xs text-muted-foreground">{role.code}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{detail.scope}</Badge>
                  </TableCell>
                  <TableCell className="hidden max-w-md text-sm text-muted-foreground lg:table-cell">
                    {detail.summary} · {role.permissions.length} sistem yetkisi
                  </TableCell>
                  <TableCell className="text-right">
                    <StatusBadge tone={role.is_active ? "success" : "neutral"}>
                      {role.is_active ? "Atanabilir" : "Kapalı"}
                    </StatusBadge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </SectionCard>

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
