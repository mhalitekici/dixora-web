"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { Button, buttonVariants } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/admin/admin-utils";
import type { DiningTable, Order, PageResult } from "@/components/admin/types";
import { formatMoney } from "@/lib/formatters";

export function OperationAccess({
  panel,
  children,
}: {
  panel: "waiter" | "cashier";
  children: ReactNode;
}) {
  const router = useRouter();
  const cache = useQueryClient();
  const access = useQuery({
    queryKey: ["operation-access", panel],
    queryFn: () =>
      api.get<{ mode: "staff" | "support" }>("auth/operation-access", {
        search: { panel },
      }),
    refetchInterval: 5_000,
    retry: false,
    staleTime: 0,
  });
  const exit = useMutation({
    mutationFn: () => api.delete("auth/operation-grant"),
    onSuccess: async () => {
      await cache.invalidateQueries();
      router.replace("/admin/panels");
    },
  });
  if (access.isPending)
    return <LoadingState label="Panel yetkisi doğrulanıyor…" />;
  if (access.error)
    return (
      <div className="mx-auto max-w-lg space-y-4 p-5">
        <ErrorState
          error={access.error}
          onRetry={() => void access.refetch()}
        />
        <Link className={buttonVariants()} href="/admin/panels">
          Panellerden yetkili giriş yap
        </Link>
      </div>
    );
  return (
    <>
      {access.data.mode === "support" ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/30 bg-primary/10 p-3 text-sm"
        >
          <p>
            <strong>Operasyon destek modu</strong> · Gerçek hesabınızla işlem
            yapıyorsunuz.
            {panel === "cashier"
              ? " Kasa yalnız gözlem içindir; vardiya ve tahsilat işlemleri kapalıdır."
              : " Erişim 10 dakika geçerlidir."}
          </p>
          <Button
            variant="outline"
            disabled={exit.isPending}
            onClick={() => exit.mutate()}
          >
            Destek modundan çık
          </Button>
          {exit.error ? <p role="alert">{exit.error.message}</p> : null}
        </div>
      ) : null}
      {panel === "cashier" && access.data.mode === "support" ? (
        <CashierSupport />
      ) : (
        children
      )}
    </>
  );
}

function CashierSupport() {
  const tables = useQuery({
    queryKey: ["operation-support", "tables"],
    queryFn: () => api.get<DiningTable[]>("tables"),
    refetchInterval: 10_000,
  });
  const orders = useQuery({
    queryKey: ["operation-support", "orders"],
    queryFn: () =>
      api.get<PageResult<Order>>("orders", { search: { limit: 100 } }),
    refetchInterval: 10_000,
  });
  if (tables.isPending || orders.isPending)
    return <LoadingState label="Şube operasyonu yükleniyor…" />;
  if (tables.error || orders.error)
    return (
      <ErrorState
        error={tables.error ?? orders.error}
        onRetry={() => {
          void tables.refetch();
          void orders.refetch();
        }}
      />
    );
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4">
      <h1 className="text-xl font-semibold">Kasa gözlem ekranı</h1>
      <p className="text-sm text-muted-foreground">
        Seçili şubenin masaları ve son 100 adisyonu. Hiçbir kasiyerin
        vardiyasına bağlanılmaz.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {tables.data?.map((table) => (
          <div
            key={table.id}
            className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border bg-card p-3 text-center"
          >
            <strong>{table.name}</strong>
            <span className="text-xs text-muted-foreground">
              {table.state === "AVAILABLE" ? "Boş" : "Aktif"}
            </span>
          </div>
        ))}
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {orders.data?.items.map((order) => (
          <li
            key={order.id}
            className="flex flex-wrap justify-between gap-2 p-3 text-sm"
          >
            <span>Adisyon {order.id.slice(0, 8)}</span>
            <span>{formatMoney(order.total)}</span>
          </li>
        ))}
      </ul>
      {orders.data?.items.length === 0 ? (
        <p>Bu şubede henüz sipariş yok.</p>
      ) : null}
    </div>
  );
}
