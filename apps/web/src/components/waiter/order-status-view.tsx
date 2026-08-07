"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChefHat,
  Clock3,
  Loader2,
  ReceiptText,
  Send,
  Utensils,
} from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/shared/status-badge";
import { StaffLoyaltyPanel } from "@/components/loyalty/staff-loyalty-panel";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

const steps = [
  { status: "SUBMITTED", label: "Gönderildi", icon: Send },
  { status: "ACCEPTED", label: "Kabul edildi", icon: Check },
  { status: "PREPARING", label: "Hazırlanıyor", icon: ChefHat },
  { status: "READY", label: "Hazır", icon: Utensils },
  { status: "SERVED", label: "Servis", icon: Check },
];
const orderStatusRank: Record<string, number> = {
  DRAFT: 0,
  SUBMITTED: 1,
  AWAITING_APPROVAL: 1,
  ACCEPTED: 2,
  PREPARING: 3,
  PARTIALLY_READY: 3,
  READY: 4,
  SERVED: 5,
  BILL_REQUESTED: 5,
  PAYMENT_PENDING: 5,
  PAID: 5,
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
  const rank = orderStatusRank[order.status] ?? 0;

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
          <h1 className="truncate text-lg font-semibold">Sipariş #{order.id.slice(0, 8)}</h1>
          <p className="text-[0.65rem] text-muted-foreground">
            {order.source} · {new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date(order.created_at))}
          </p>
        </div>
        <StatusBadge tone={order.status === "READY" ? "success" : "brand"} pulse={order.status === "READY"}>
          {order.status}
        </StatusBadge>
      </header>

      <section className="rounded-2xl border bg-card p-4">
        <div className="grid grid-cols-5">
          {steps.map((step, index) => {
            const reached = rank >= index + 1;
            return (
              <div key={step.status} className="relative flex flex-col items-center text-center">
                {index > 0 ? (
                  <span
                    className={cn(
                      "absolute right-1/2 top-4 h-0.5 w-full",
                      reached ? "bg-brand" : "bg-muted",
                    )}
                  />
                ) : null}
                <span
                  className={cn(
                    "relative z-10 flex size-8 items-center justify-center rounded-full border",
                    reached
                      ? "border-brand bg-brand text-brand-foreground"
                      : "border-border bg-card text-muted-foreground",
                  )}
                >
                  <step.icon className="size-3.5" />
                </span>
                <span className="mt-2 text-[0.56rem] font-semibold text-muted-foreground sm:text-[0.65rem]">
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-3 rounded-2xl border bg-card">
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
                <p className="mt-1 flex items-center gap-1 text-[0.62rem] text-muted-foreground">
                  <Clock3 className="size-3" />
                  {item.status}
                </p>
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
