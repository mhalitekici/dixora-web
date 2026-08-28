"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bike,
  Check,
  Clock,
  Loader2,
  Phone,
  Plus,
  ShoppingBag,
  Store,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  CHANNEL_LABELS,
  PAYMENT_LABELS,
  STATUS_LABELS,
  type DeliveryChannel,
  type DeliveryOrder,
  deliveryApi,
  deliveryKeys,
  elapsedMinutes,
  urgency,
} from "@/components/delivery/delivery-api";
import { NewDeliveryOrderDialog } from "@/components/delivery/new-delivery-order-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const CHANNEL_ICONS: Record<DeliveryChannel, typeof Phone> = {
  PHONE: Phone,
  TAKEAWAY: ShoppingBag,
  OWN_DELIVERY: Bike,
  MARKETPLACE: Store,
};

const CHANNEL_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Tümü" },
  { value: "PHONE", label: "Telefon" },
  { value: "TAKEAWAY", label: "Gel-Al" },
  { value: "OWN_DELIVERY", label: "Kendi Kurye" },
  { value: "MARKETPLACE", label: "Platform" },
];

const PREP_PRESETS = [10, 15, 20, 30];

const REJECT_REASONS = [
  "Ürün tükendi",
  "Yoğunluk",
  "Kapanış saati",
  "Teslimat bölgesi dışında",
  "Teknik sorun",
];

const money = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
});

export function DeliveryInbox() {
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState("all");
  const [now, setNow] = useState(() => Date.now());
  const [accepting, setAccepting] = useState<DeliveryOrder | null>(null);
  const [rejecting, setRejecting] = useState<DeliveryOrder | null>(null);
  const [promised, setPromised] = useState<number | null>(20);
  const [reason, setReason] = useState("");
  const [creating, setCreating] = useState(false);

  // Elapsed time must keep moving without refetching the whole list.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const ordersQuery = useQuery({
    queryKey: deliveryKeys.list(channel),
    queryFn: ({ signal }) => deliveryApi.list(channel, signal),
    refetchInterval: 15_000,
  });
  const countsQuery = useQuery({
    queryKey: deliveryKeys.counts(),
    queryFn: ({ signal }) => deliveryApi.counts(signal),
    refetchInterval: 15_000,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: deliveryKeys.root }),
    ]);

  const acceptMutation = useMutation({
    mutationFn: ({ id, minutes }: { id: string; minutes: number | null }) =>
      deliveryApi.accept(id, minutes),
    onSuccess: async () => {
      setAccepting(null);
      toast.success("Sipariş kabul edildi, mutfağa iletildi.");
      await refresh();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Sipariş kabul edilemedi.",
      ),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) =>
      deliveryApi.reject(id, why),
    onSuccess: async () => {
      setRejecting(null);
      setReason("");
      toast.success("Sipariş reddedildi.");
      await refresh();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Sipariş reddedilemedi."),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: DeliveryOrder["delivery_status"] }) =>
      deliveryApi.setStatus(id, status),
    onSuccess: refresh,
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Durum güncellenemedi."),
  });

  const orders = ordersQuery.data?.items ?? [];
  const counts = countsQuery.data;

  return (
    <div className="min-h-full bg-muted/20 p-4 sm:p-6">
      <PageHeader
        eyebrow="Operasyon"
        title="Siparişler"
        description="Telefon, gel-al ve paket servis siparişlerini tek ekrandan yönetin."
        icon={Bike}
        actions={
          <Button size="lg" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            Yeni Paket Siparişi
          </Button>
        }
      />

      <NewDeliveryOrderDialog open={creating} onOpenChange={setCreating} />

      {counts ? (
        <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {(
            [
              ["Yeni", counts.new, "text-brand"],
              ["Kabul", counts.accepted, ""],
              ["Hazırlanıyor", counts.preparing, ""],
              ["Hazır", counts.ready, ""],
              ["Yolda", counts.dispatched, ""],
              ["Teslim", counts.delivered, ""],
            ] as const
          ).map(([label, value, tone]) => (
            <div key={label} className="rounded-xl border bg-card px-3 py-2">
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {label}
              </p>
              <p className={cn("text-xl font-bold tabular-nums", tone)}>{value}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {CHANNEL_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setChannel(filter.value)}
            className={cn(
              "h-8 rounded-lg border px-3 text-xs font-semibold transition-colors",
              channel === filter.value
                ? "border-primary bg-primary/10"
                : "border-transparent bg-muted/70 text-muted-foreground hover:bg-muted",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {ordersQuery.isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-52 animate-pulse rounded-2xl border bg-card"
              aria-hidden="true"
            />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          title="Henüz paket sipariş yok"
          description="Telefon, gel-al ve kendi kuryenizle aldığınız siparişler burada tek ekranda görünür."
          icon={Bike}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              now={now}
              busy={statusMutation.isPending}
              onAccept={() => {
                setPromised(20);
                setAccepting(order);
              }}
              onReject={() => {
                setReason("");
                setRejecting(order);
              }}
              onAdvance={(status) => statusMutation.mutate({ id: order.id, status })}
            />
          ))}
        </div>
      )}

      <Dialog
        open={accepting !== null}
        onOpenChange={(open) => !open && setAccepting(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Siparişi kabul et</DialogTitle>
            <DialogDescription>
              Hazırlama süresini seçin; müşteriye bu süre bildirilir.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {PREP_PRESETS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => setPromised(minutes)}
                className={cn(
                  "h-10 rounded-xl border-2 px-4 text-sm font-semibold transition-colors",
                  promised === minutes
                    ? "border-brand bg-brand-soft/40 text-brand"
                    : "hover:bg-muted/50",
                )}
              >
                {minutes} dk
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="promised-custom">Özel süre (dk)</Label>
            <Input
              id="promised-custom"
              inputMode="numeric"
              value={promised ?? ""}
              onChange={(event) => {
                const value = event.target.value.replace(/\D/g, "");
                setPromised(value ? Number(value) : null);
              }}
              className="h-11 rounded-xl"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccepting(null)}>
              Vazgeç
            </Button>
            <Button
              disabled={acceptMutation.isPending}
              onClick={() =>
                accepting &&
                acceptMutation.mutate({ id: accepting.id, minutes: promised })
              }
            >
              {acceptMutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
              Siparişi kabul et
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rejecting !== null}
        onOpenChange={(open) => !open && setRejecting(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Siparişi reddet</DialogTitle>
            <DialogDescription>
              Sebep kayıt altına alınır ve rapora yansır.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {REJECT_REASONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setReason(option)}
                className={cn(
                  "h-9 rounded-xl border-2 px-3 text-xs font-semibold transition-colors",
                  reason === option
                    ? "border-destructive/50 bg-destructive/10 text-destructive"
                    : "hover:bg-muted/50",
                )}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Sebep</Label>
            <Input
              id="reject-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Sebep girin"
              className="h-11 rounded-xl"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 2 || rejectMutation.isPending}
              onClick={() =>
                rejecting &&
                rejectMutation.mutate({ id: rejecting.id, why: reason.trim() })
              }
            >
              {rejectMutation.isPending ? <Loader2 className="animate-spin" /> : <X />}
              Reddet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OrderCard({
  order,
  now,
  busy,
  onAccept,
  onReject,
  onAdvance,
}: {
  order: DeliveryOrder;
  now: number;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
  onAdvance: (status: DeliveryOrder["delivery_status"]) => void;
}) {
  const Icon = CHANNEL_ICONS[order.channel];
  const minutes = elapsedMinutes(order.created_at, now);
  const level = urgency(minutes);

  // Only one action leads at a time, so staff never hunt for the next step.
  const next: Record<string, DeliveryOrder["delivery_status"] | undefined> = {
    ACCEPTED: "READY",
    PREPARING: "READY",
    READY: order.channel === "TAKEAWAY" ? "DELIVERED" : "DISPATCHED",
    DISPATCHED: "DELIVERED",
  };
  const nextStatus = next[order.delivery_status];

  return (
    <article
      className={cn(
        "flex flex-col rounded-2xl border-2 bg-card p-4",
        order.delivery_status === "NEW" ? "border-brand/40" : "border-border",
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-muted">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-bold">
              {order.provider ?? CHANNEL_LABELS[order.channel]}
            </p>
            <p className="text-[0.68rem] text-muted-foreground">
              {order.external_display_id ?? `#${order.id.slice(0, 6).toUpperCase()}`}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold tabular-nums",
            level === "late"
              ? "bg-destructive/10 text-destructive"
              : level === "warning"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                : "bg-muted text-muted-foreground",
          )}
        >
          <Clock className="size-3" aria-hidden="true" />
          {minutes} dk
        </span>
      </header>

      {/* Status is never colour-only: the label carries the meaning. */}
      <p className="mt-3 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {STATUS_LABELS[order.delivery_status]}
        {order.customer_name ? ` · ${order.customer_name}` : ""}
      </p>

      <ul className="mt-2 space-y-0.5 text-sm">
        {order.items.slice(0, 4).map((item, index) => (
          <li key={`${item.name}-${index}`} className="flex justify-between gap-2">
            <span className="min-w-0 truncate">
              {Number(item.quantity)} × {item.name}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {money.format(Number(item.line_total))}
            </span>
          </li>
        ))}
        {order.items.length > 4 ? (
          <li className="text-xs text-muted-foreground">
            +{order.items.length - 4} ürün daha
          </li>
        ) : null}
      </ul>

      {order.customer_note ? (
        <p className="mt-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[0.72rem] leading-4 text-amber-800 dark:text-amber-200">
          Not: {order.customer_note}
        </p>
      ) : null}

      <div className="mt-3 flex items-baseline justify-between border-t pt-3">
        <span className="text-[0.7rem] text-muted-foreground">
          {PAYMENT_LABELS[order.payment_method] ?? order.payment_method}
        </span>
        <span className="text-lg font-bold tabular-nums">
          {money.format(Number(order.total))}
        </span>
      </div>

      {order.sync_status === "FAILED" ? (
        <p className="mt-2 rounded-lg bg-destructive/10 px-2 py-1.5 text-[0.7rem] text-destructive">
          Platforma durum gönderilemedi. Sipariş Dixora&apos;da kayıtlı.
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        {order.delivery_status === "NEW" ? (
          <>
            <Button className="flex-1" onClick={onAccept}>
              <Check className="size-4" />
              Kabul Et
            </Button>
            <Button variant="outline" onClick={onReject}>
              <X className="size-4" />
              Reddet
            </Button>
          </>
        ) : nextStatus ? (
          <Button
            className="flex-1"
            variant="outline"
            disabled={busy}
            onClick={() => onAdvance(nextStatus)}
          >
            {STATUS_LABELS[nextStatus]} olarak işaretle
          </Button>
        ) : null}
      </div>
    </article>
  );
}
