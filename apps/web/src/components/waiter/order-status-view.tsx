"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Circle, Loader2, QrCode, ReceiptText } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/shared/status-badge";
import { StaffLoyaltyPanel } from "@/components/loyalty/staff-loyalty-panel";
import { buttonVariants } from "@/components/ui/button";

type Order = {
  id: string;
  status: string;
  source: string;
  customer_name?: string | null;
  total: string | number;
  created_at: string;
  items: Array<{
    id: string;
    product_name_snapshot: string;
    quantity: string | number;
    line_total: string | number;
    status: string;
    note?: string | null;
  }>;
};

// Cafe-friendly order status: the kitchen (PREPARING/READY/SERVED) timeline
// is not shown here — only the operational state relevant to the waiter.
const statusMeta: Record<string, { label: string; tone: Parameters<typeof StatusBadge>[0]["tone"]; hint: string }> = {
  DRAFT: { label: "Açık", tone: "info", hint: "Sipariş henüz mutfağa gönderilmedi." },
  SUBMITTED: { label: "Açık", tone: "info", hint: "Sipariş mutfağa/bara iletildi." },
  AWAITING_APPROVAL: { label: "Açık", tone: "info", hint: "Sipariş onay bekliyor." },
  ACCEPTED: { label: "Açık", tone: "info", hint: "Sipariş hazırlanıyor." },
  PREPARING: { label: "Açık", tone: "info", hint: "Sipariş hazırlanıyor." },
  PARTIALLY_READY: { label: "Açık", tone: "info", hint: "Sipariş hazırlanıyor." },
  READY: { label: "Açık", tone: "info", hint: "Sipariş hazır, servis bekliyor." },
  SERVED: { label: "Açık", tone: "info", hint: "Sipariş servis edildi." },
  BILL_REQUESTED: { label: "Hesap İstendi", tone: "purple", hint: "Hesap talebi kasaya iletildi." },
  PAYMENT_PENDING: { label: "Ödeme Bekliyor", tone: "purple", hint: "Kasada ödeme tamamlanmayı bekliyor." },
  PAID: { label: "Ödendi", tone: "success", hint: "Hesap tahsil edildi." },
  CANCELLED: { label: "İptal", tone: "danger", hint: "Sipariş iptal edildi." },
  VOIDED: { label: "İptal", tone: "danger", hint: "Sipariş iptal edildi." },
};
const currency = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
});

export function OrderStatusView({ orderId }: { orderId: string }) {
  const query = useQuery({
    queryKey: ["waiter", "orders", orderId],
    queryFn: async () => {
      const response = await fetch(`/api/backend/orders/${orderId}`);
      const data = (await response.json().catch(() => null)) as Order | { detail?: string } | null;
      if (!response.ok) throw new Error((data as { detail?: string } | null)?.detail ?? "Sipariş yüklenemedi.");
      return data as Order;
    },
    refetchInterval: 5_000,
  });

  if (query.isLoading) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center text-center">
        <ReceiptText className="size-7 text-muted-foreground" />
        <h1 className="mt-4 text-lg font-semibold">Sipariş bulunamadı</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {query.error instanceof Error ? query.error.message : "Bu kayda erişiminiz olmayabilir."}
        </p>
        <Link
          href="/waiter/tables"
          className={buttonVariants({ variant: "outline", className: "mt-5" })}
        >
          Masalara dön
        </Link>
      </div>
    );
  }

  const order = query.data;
  const status = statusMeta[order.status] ?? { label: order.status, tone: "neutral" as const, hint: "" };

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-4 flex items-center gap-3">
        <Link
          href="/waiter/tables"
          className="flex size-10 items-center justify-center rounded-xl border bg-card"
          aria-label="Masalara dön"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold">Sipariş #{order.id.slice(0, 8)}</h1>
            {order.source === "QR" ? (
              <span className="flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[0.6rem] font-semibold text-brand">
                <QrCode className="size-3" />
                QR
              </span>
            ) : null}
          </div>
          <p className="text-[0.65rem] text-muted-foreground">
            {new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date(order.created_at))}
          </p>
        </div>
        <StatusBadge tone={status.tone} pulse={order.status === "BILL_REQUESTED"}>
          {status.label}
        </StatusBadge>
      </header>

      {status.hint ? (
        <section className="mb-3 flex items-center gap-2 rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
          <Circle className="size-2 shrink-0 fill-current" />
          {status.hint}
        </section>
      ) : null}

      <section className="rounded-2xl border bg-card">
        <header className="flex items-center justify-between border-b p-4">
          <div>
            <h2 className="text-sm font-semibold">Sipariş kalemleri</h2>
            <p className="text-[0.65rem] text-muted-foreground">{order.items.length} kalem</p>
          </div>
          <span className="text-lg font-semibold">{currency.format(Number(order.total))}</span>
        </header>
        <div className="space-y-2 p-3">
          {order.items.map((item) => (
            <article key={item.id} className="flex items-start gap-3 rounded-xl bg-muted/35 p-3">
              <span className="flex size-8 items-center justify-center rounded-xl bg-card text-xs font-bold">
                {Number(item.quantity)}×
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{item.product_name_snapshot}</p>
                {item.note ? (
                  <p className="mt-1 text-[0.65rem] text-amber-700">{item.note}</p>
                ) : null}
                {item.status === "CANCELLED" || item.status === "VOIDED" ? (
                  <StatusBadge tone="danger" dot={false} className="mt-1.5 h-5 px-1.5 text-[0.56rem]">
                    İptal
                  </StatusBadge>
                ) : null}
              </div>
              <span className="text-xs font-semibold">{currency.format(Number(item.line_total))}</span>
            </article>
          ))}
        </div>
      </section>

      <div className="mt-3">
        <StaffLoyaltyPanel
          orderId={order.id}
          items={order.items}
          disabled={
            ![
              "ACCEPTED",
              "PREPARING",
              "PARTIALLY_READY",
              "READY",
              "SERVED",
              "BILL_REQUESTED",
            ].includes(order.status)
          }
          onChanged={() => void query.refetch()}
        />
      </div>
    </div>
  );
}
