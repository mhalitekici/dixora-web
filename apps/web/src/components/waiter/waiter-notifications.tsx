"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Loader2, QrCode, ReceiptText, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api";

type Order = {
  id: string;
  status: string;
  source: string;
  customer_name?: string | null;
  created_at: string;
  total: string | number;
};
type QrRequest = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  table_id: string;
  items_payload: Array<Record<string, unknown>>;
  customer_note?: string | null;
  created_at: string;
};

type QrResolution = "approve" | "reject";

function unwrap<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: T[] }).items;
  }
  return [];
}

export function WaiterNotifications() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["waiter", "notifications"],
    queryFn: async () => {
      const [ordersResponse, qrResponse] = await Promise.all([
        fetch("/api/backend/orders?limit=50"),
        fetch("/api/backend/qr/requests?status=PENDING"),
      ]);
      return {
        orders: ordersResponse.ok ? unwrap<Order>(await ordersResponse.json()) : [],
        requests: qrResponse.ok ? unwrap<QrRequest>(await qrResponse.json()) : [],
      };
    },
    refetchInterval: 6_000,
  });
  const resolveQrRequest = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: QrResolution }) =>
      api.post<QrRequest>(`qr/requests/${id}/${resolution}`),
    onSuccess: async (_, variables) => {
      toast.success(
        variables.resolution === "approve"
          ? "QR sipariş talebi onaylandı ve mutfağa gönderildi."
          : "QR sipariş talebi reddedildi.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["waiter", "notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["waiter", "tables"] }),
        queryClient.invalidateQueries({ queryKey: ["waiter", "table"] }),
      ]);
    },
    onError: (error, variables) => {
      toast.error(
        variables.resolution === "approve"
          ? "QR sipariş talebi onaylanamadı."
          : "QR sipariş talebi reddedilemedi.",
        {
          description: error instanceof Error ? error.message : undefined,
        },
      );
    },
  });

  if (query.isLoading) {
    return <div className="flex min-h-60 items-center justify-center"><Loader2 className="size-6 animate-spin text-brand" /></div>;
  }

  const orders = query.data?.orders ?? [];
  const requests = query.data?.requests ?? [];
  const ready = orders.filter((order) => ["READY", "PARTIALLY_READY"].includes(order.status));
  const bill = orders.filter((order) => order.status === "BILL_REQUESTED");

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-4">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-brand">Canlı uyarılar</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Bildirimler</h1>
        <p className="mt-1 text-xs text-muted-foreground">Hazır ürünler, hesap talepleri ve QR istekleri</p>
      </header>
      <div className="space-y-3">
        {requests.map((request) => {
          const pendingResolution =
            resolveQrRequest.isPending && resolveQrRequest.variables?.id === request.id
              ? resolveQrRequest.variables.resolution
              : null;

          return (
            <article
              key={request.id}
              className="rounded-2xl border border-brand/20 bg-brand/[0.035] p-4"
            >
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <QrCode className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">Yeni QR sipariş talebi</h2>
                    <StatusBadge tone="brand" pulse>
                      Onay bekliyor
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-[0.65rem] text-muted-foreground">
                    Masa kimliği {request.table_id.slice(0, 8)} ·{" "}
                    {request.items_payload.length} kalem
                  </p>
                  {request.customer_note ? (
                    <p className="mt-2 line-clamp-2 rounded-lg bg-background/70 px-2.5 py-2 text-xs">
                      “{request.customer_note}”
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  disabled={pendingResolution !== null}
                  onClick={() =>
                    resolveQrRequest.mutate({ id: request.id, resolution: "reject" })
                  }
                  aria-label={`Masa ${request.table_id.slice(0, 8)} QR sipariş talebini reddet`}
                >
                  {pendingResolution === "reject" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <X />
                  )}
                  Reddet
                </Button>
                <Button
                  disabled={pendingResolution !== null}
                  onClick={() =>
                    resolveQrRequest.mutate({ id: request.id, resolution: "approve" })
                  }
                  aria-label={`Masa ${request.table_id.slice(0, 8)} QR sipariş talebini onayla`}
                >
                  {pendingResolution === "approve" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Check />
                  )}
                  Onayla
                </Button>
              </div>
            </article>
          );
        })}
        {ready.map((order) => (
          <Link key={order.id} href={`/waiter/orders/${order.id}`} className="flex items-center gap-3 rounded-2xl border border-emerald-600/25 bg-emerald-500/[0.045] p-4">
            <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700"><BellRing className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Sipariş servise hazır</span>
              <span className="text-[0.65rem] text-muted-foreground">#{order.id.slice(0, 8)} · {order.source}</span>
            </span>
            <StatusBadge tone="success">Hazır</StatusBadge>
          </Link>
        ))}
        {bill.map((order) => (
          <Link key={order.id} href={`/waiter/orders/${order.id}`} className="flex items-center gap-3 rounded-2xl border border-violet-600/20 bg-violet-500/[0.04] p-4">
            <span className="flex size-10 items-center justify-center rounded-xl bg-violet-500/15 text-violet-700"><ReceiptText className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Müşteri hesap istedi</span>
              <span className="text-[0.65rem] text-muted-foreground">#{order.id.slice(0, 8)}</span>
            </span>
            <StatusBadge tone="purple">Hesap</StatusBadge>
          </Link>
        ))}
        {!requests.length && !ready.length && !bill.length ? (
          <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed text-center">
            <Check className="size-6 text-emerald-600" />
            <h2 className="mt-3 text-sm font-semibold">Bekleyen bildirim yok</h2>
            <p className="mt-1 text-xs text-muted-foreground">Yeni olaylar gerçek zamanlı burada görünecek.</p>
            <Link
              href="/waiter/tables"
              className={buttonVariants({ variant: "outline", className: "mt-4" })}
            >
              Masalara dön
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
