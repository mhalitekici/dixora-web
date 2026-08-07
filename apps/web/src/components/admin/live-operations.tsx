"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Check,
  ChefHat,
  Clock3,
  Grid2X2,
  QrCode,
  ReceiptText,
  RefreshCw,
  X,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { adminApi, adminKeys } from "./admin-api";
import {
  dateTime,
  ErrorState,
  LoadingState,
  money,
  orderStatusText,
  qrStatusText,
  relativeMinutes,
  shortId,
  tableStateText,
  toneForOrder,
  toneForTable,
} from "./admin-utils";
import type { Order, QrRequest } from "./types";

const activeStatuses = [
  "SUBMITTED",
  "AWAITING_APPROVAL",
  "ACCEPTED",
  "PREPARING",
  "PARTIALLY_READY",
  "READY",
  "SERVED",
  "BILL_REQUESTED",
  "PAYMENT_PENDING",
] as const;

export function LiveOperations() {
  const queryClient = useQueryClient();
  const dashboardQuery = useQuery({
    queryKey: adminKeys.dashboard(),
    queryFn: ({ signal }) => adminApi.dashboard(signal),
    refetchInterval: 10_000,
  });
  const tablesQuery = useQuery({
    queryKey: adminKeys.tables(),
    queryFn: ({ signal }) => adminApi.tables(signal),
    refetchInterval: 10_000,
  });
  const ordersQuery = useQuery({
    queryKey: adminKeys.orders("live", 0, 100),
    queryFn: ({ signal }) => adminApi.orders({ limit: 100 }, signal),
    refetchInterval: 10_000,
  });
  const qrQuery = useQuery({
    queryKey: adminKeys.qrRequests("PENDING"),
    queryFn: ({ signal }) => adminApi.qrRequests("PENDING", signal),
    refetchInterval: 10_000,
  });

  const invalidateLive = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.tables() }),
      queryClient.invalidateQueries({ queryKey: [...adminKeys.root, "orders"] }),
      queryClient.invalidateQueries({ queryKey: [...adminKeys.root, "qr-requests"] }),
    ]);
  };

  const acceptOrder = useMutation({
    mutationFn: adminApi.acceptOrder,
    onSuccess: async () => {
      toast.success("Sipariş kabul edildi.");
      await invalidateLive();
    },
    onError: () => toast.error("Sipariş kabul edilemedi."),
  });
  const approveQr = useMutation({
    mutationFn: adminApi.approveQrRequest,
    onSuccess: async () => {
      toast.success("QR talebi onaylandı.");
      await invalidateLive();
    },
    onError: () => toast.error("QR talebi onaylanamadı."),
  });
  const rejectQr = useMutation({
    mutationFn: adminApi.rejectQrRequest,
    onSuccess: async () => {
      toast.success("QR talebi reddedildi.");
      await invalidateLive();
    },
    onError: () => toast.error("QR talebi reddedilemedi."),
  });

  const firstError =
    dashboardQuery.error ?? tablesQuery.error ?? ordersQuery.error ?? qrQuery.error;
  if (dashboardQuery.isLoading || tablesQuery.isLoading || ordersQuery.isLoading || qrQuery.isLoading) {
    return <LoadingState label="Canlı operasyon yükleniyor…" />;
  }
  if (firstError) {
    return (
      <ErrorState
        error={firstError}
        onRetry={() => {
          void dashboardQuery.refetch();
          void tablesQuery.refetch();
          void ordersQuery.refetch();
          void qrQuery.refetch();
        }}
      />
    );
  }

  const dashboard = dashboardQuery.data;
  const tables = tablesQuery.data ?? [];
  const liveOrders = (ordersQuery.data?.items ?? []).filter((order) =>
    activeStatuses.includes(order.status as (typeof activeStatuses)[number]),
  );
  const qrRequests = qrQuery.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="10 saniyede bir yenilenir"
        title="Canlı operasyon"
        description="Masa, sipariş, hazırlık ve QR onay kuyruğunu tek merkezden izleyin."
        icon={Activity}
        actions={
          <Button
            variant="outline"
            onClick={() => void invalidateLive()}
            disabled={
              dashboardQuery.isFetching ||
              tablesQuery.isFetching ||
              ordersQuery.isFetching ||
              qrQuery.isFetching
            }
          >
            <RefreshCw
              className={cn(
                dashboardQuery.isFetching ||
                  tablesQuery.isFetching ||
                  ordersQuery.isFetching ||
                  qrQuery.isFetching
                  ? "animate-spin"
                  : "",
              )}
            />
            Şimdi yenile
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Açık masa"
          value={dashboard?.open_tables ?? 0}
          detail={`${tables.filter((table) => table.state === "AVAILABLE").length} masa müsait`}
          icon={Grid2X2}
          tone="info"
        />
        <StatCard
          title="Aktif sipariş"
          value={dashboard?.active_orders ?? liveOrders.length}
          detail={`${dashboard?.waiting_preparation ?? 0} sipariş hazırlık bekliyor`}
          icon={ReceiptText}
          tone="brand"
        />
        <StatCard
          title="Hazır sipariş"
          value={dashboard?.ready_orders ?? 0}
          detail="Servise teslim edilmeyi bekliyor"
          icon={ChefHat}
          tone="success"
        />
        <StatCard
          title="QR onayı"
          value={qrRequests.length}
          detail="Müşteri talepleri"
          icon={QrCode}
          tone={qrRequests.length ? "warning" : "default"}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard
          title="Masa akışı"
          description={`${tables.length} masa · backend masa durumları`}
          action={
            <Link href="/admin/tables" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Masa yönetimi
            </Link>
          }
        >
          {tables.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {tables.map((table) => (
                <Link
                  key={table.id}
                  href={`/admin/tables?table=${encodeURIComponent(table.id)}`}
                  className="rounded-xl border p-3 transition-colors hover:border-brand/30 hover:bg-brand-soft/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-base font-bold">{table.name}</span>
                    <StatusBadge
                      tone={toneForTable(table.state)}
                      dot={false}
                      className="h-5 px-1.5 text-[0.6rem]"
                    >
                      {tableStateText[table.state]}
                    </StatusBadge>
                  </div>
                  <p className="mt-4 text-xs text-muted-foreground">{table.capacity} kişilik</p>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="Henüz masa yok"
              description="Canlı akış için masa tanımlarını tamamlayın."
              icon={Grid2X2}
            />
          )}
        </SectionCard>

        <SectionCard
          title="QR onay kuyruğu"
          description="Bekleyen talepler"
          action={
            <Link
              href="/admin/qr-menu/orders"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Tüm talepler
            </Link>
          }
        >
          {qrRequests.length ? (
            <div className="space-y-2">
              {qrRequests.slice(0, 6).map((request) => (
                <QrApprovalRow
                  key={request.id}
                  request={request}
                  tableName={
                    tables.find((table) => table.id === request.table_id)?.name ?? "Bilinmeyen masa"
                  }
                  onApprove={() => approveQr.mutate(request.id)}
                  onReject={() => rejectQr.mutate(request.id)}
                  pending={
                    (approveQr.isPending && approveQr.variables === request.id) ||
                    (rejectQr.isPending && rejectQr.variables === request.id)
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="Bekleyen QR talebi yok"
              description="Yeni müşteri talepleri burada anında görünür."
              icon={QrCode}
            />
          )}
        </SectionCard>
      </div>

      <SectionCard
        className="mt-5"
        title="Aktif siparişler"
        description={`${liveOrders.length} açık kayıt`}
        action={
          <Link href="/admin/orders" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Sipariş arşivi
          </Link>
        }
      >
        {liveOrders.length ? (
          <div className="grid gap-2 lg:grid-cols-2">
            {liveOrders.slice(0, 10).map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                onAccept={() => acceptOrder.mutate(order.id)}
                accepting={acceptOrder.isPending && acceptOrder.variables === order.id}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            compact
            title="Aktif sipariş yok"
            description="Açılan siparişler burada listelenecek."
            icon={ReceiptText}
          />
        )}
      </SectionCard>
    </>
  );
}

function OrderRow({
  order,
  onAccept,
  accepting,
}: {
  order: Order;
  onAccept: () => void;
  accepting: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border p-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
        <ReceiptText className="size-4 text-muted-foreground" />
      </span>
      <Link href={`/admin/orders?order=${order.id}`} className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">#{shortId(order.id)}</p>
          <StatusBadge tone={toneForOrder(order.status)}>{orderStatusText[order.status]}</StatusBadge>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {order.items.length} kalem · {order.source} · {relativeMinutes(order.created_at)}
        </p>
      </Link>
      <div className="text-right">
        <p className="font-semibold tabular-nums">{money(order.total, order.currency)}</p>
        {order.status === "SUBMITTED" ? (
          <Button size="sm" className="mt-1 h-7" onClick={onAccept} disabled={accepting}>
            <Check />
            Kabul
          </Button>
        ) : (
          <p className="mt-1 flex items-center justify-end gap-1 text-[0.68rem] text-muted-foreground">
            <Clock3 className="size-3" />
            {dateTime(order.created_at)}
          </p>
        )}
      </div>
    </div>
  );
}

function QrApprovalRow({
  request,
  tableName,
  onApprove,
  onReject,
  pending,
}: {
  request: QrRequest;
  tableName: string;
  onApprove: () => void;
  onReject: () => void;
  pending: boolean;
}) {
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <QrCode className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{tableName}</p>
            <StatusBadge tone="warning">{qrStatusText[request.status]}</StatusBadge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {request.items_payload.length} kalem · {relativeMinutes(request.created_at)}
          </p>
          {request.customer_note ? (
            <p className="mt-2 line-clamp-2 rounded-lg bg-muted/60 px-2.5 py-2 text-xs">
              “{request.customer_note}”
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={pending}
              />
            }
          >
            <X />
            Reddet
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>QR talebini reddet?</AlertDialogTitle>
              <AlertDialogDescription>
                {tableName} için oluşturulan talep reddedilecek. Bu işlem geri alınamaz.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Vazgeç</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onReject}>
                Talebi reddet
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog>
          <AlertDialogTrigger render={<Button disabled={pending} />}>
            <Check />
            Onayla
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>QR talebini onayla?</AlertDialogTitle>
              <AlertDialogDescription>
                {request.items_payload.length} kalem siparişe dönüştürülerek mutfak akışına alınacak.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Vazgeç</AlertDialogCancel>
              <AlertDialogAction onClick={onApprove}>Onayla ve gönder</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
