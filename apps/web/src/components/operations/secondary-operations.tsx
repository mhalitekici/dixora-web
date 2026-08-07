"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  BookOpenText,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  History,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime, formatMoney } from "@/lib/formatters";
import { cn } from "@/lib/utils";

type Order = {
  id: string;
  status: string;
  source: string;
  customer_name?: string | null;
  table_name?: string | null;
  currency?: string;
  total: string | number;
  created_at: string;
  payments?: Array<{ id: string; method: string; amount: string | number; status: string }>;
};

type KitchenTicket = {
  id: string;
  order_id: string;
  station_name?: string;
  table_name?: string | null;
  waiter_name?: string | null;
  status: string;
  created_at: string;
  items?: Array<{ id: string; name: string; quantity: string | number }>;
};

type PrintJob = {
  id: string;
  order_id?: string | null;
  kitchen_ticket_id?: string | null;
  status: string;
  kind: string;
  attempt_count: number;
  last_error?: string | null;
  created_at: string;
  payload?: Record<string, unknown>;
};

type CashierShift = {
  id: string;
  status: string;
  opening_cash: string | number;
  closing_cash?: string | number | null;
  cash_sales: string | number;
  card_sales: string | number;
  total_sales: string | number;
  cash_variance?: string | number | null;
  opened_at: string;
  closed_at?: string | null;
  closing_note?: string | null;
};

type PrinterDevice = {
  id: string;
  code: string;
  name: string;
  transport: string;
  is_active: boolean;
  last_seen_at?: string | null;
};

type Page<T> = { items: T[]; total: number };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = (await response.json().catch(() => null)) as
    | T
    | { detail?: string; error?: { message?: string } }
    | null;
  if (!response.ok) {
    const error = payload as { detail?: string; error?: { message?: string } } | null;
    throw new Error(error?.detail ?? error?.error?.message ?? "İşlem tamamlanamadı.");
  }
  return payload as T;
}

function compactId(value: string) {
  return value.slice(0, 8).toUpperCase();
}

function statusLabel(status: string) {
  return {
    PAID: "Ödendi",
    VOIDED: "İptal",
    CANCELLED: "İptal",
    COMPLETED: "Tamamlandı",
    PRINTED: "Yazdırıldı",
    PENDING: "Bekliyor",
    CLAIMED: "İşleniyor",
    SENT: "Gönderildi",
    FAILED: "Hata",
  }[status] ?? status;
}

function statusClass(status: string) {
  if (["PAID", "COMPLETED", "PRINTED"].includes(status)) {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (["FAILED", "VOIDED", "CANCELLED"].includes(status)) {
    return "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300";
  }
  return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

function OperationQueryState({
  eyebrow,
  title,
  description,
  icon,
  loading,
  fetching,
  onRetry,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: typeof History;
  loading: boolean;
  fetching: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="min-h-full bg-muted/20 p-4 sm:p-6">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        icon={icon}
      />
      {loading ? (
        <div className="flex min-h-72 items-center justify-center" role="status">
          <Loader2 className="size-6 animate-spin text-brand" />
          <span className="sr-only">Veriler yükleniyor</span>
        </div>
      ) : (
        <EmptyState
          title="Veriler yüklenemedi"
          description="Operasyon verilerine şu anda ulaşılamıyor. Bağlantınızı kontrol edip yeniden deneyin."
          icon={TriangleAlert}
          action={
            <Button variant="outline" disabled={fetching} onClick={onRetry}>
              <RefreshCw className={cn(fetching && "animate-spin")} />
              Yeniden dene
            </Button>
          }
        />
      )}
    </div>
  );
}

export function ClosedOrdersPage() {
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["orders", "closed"],
    queryFn: async () => {
      const data = await request<Page<Order>>("/orders?limit=200");
      return data.items.filter((order) =>
        ["PAID", "VOIDED", "CANCELLED"].includes(order.status),
      );
    },
    refetchInterval: 30_000,
  });
  const orders = useMemo(() => query.data ?? [], [query.data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("tr-TR");
    if (!needle) return orders;
    return orders.filter((order) =>
      [order.id, order.table_name, order.customer_name, order.source]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("tr-TR").includes(needle)),
    );
  }, [orders, search]);
  const paidTotal = orders
    .filter((order) => order.status === "PAID")
    .reduce((total, order) => total + Number(order.total), 0);

  const reprint = useMutation({
    mutationFn: (order: Order) =>
      request<PrintJob>("/printing/jobs", {
        method: "POST",
        body: JSON.stringify({
          order_id: order.id,
          kind: "REPRINT",
          idempotency_key: `receipt-reprint-${order.id}-${Date.now()}`,
          payload: { template: "CUSTOMER_RECEIPT", order_id: order.id },
        }),
      }),
    onSuccess: () => toast.success("Fiş yeniden yazdırma kuyruğuna alındı."),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Yazdırılamadı."),
  });

  if (query.isLoading || query.isError) {
    return (
      <OperationQueryState
        eyebrow="Kasa"
        title="Kapanan siparişler"
        description="Tahsilatı tamamlanan ve iptal edilen hesapları inceleyin; gerektiğinde fişi yeniden yazdırın."
        icon={History}
        loading={query.isLoading}
        fetching={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="min-h-full bg-muted/20 p-4 sm:p-6">
      <PageHeader
        eyebrow="Kasa"
        title="Kapanan siparişler"
        description="Tahsilatı tamamlanan ve iptal edilen hesapları inceleyin; gerektiğinde fişi yeniden yazdırın."
        icon={History}
        actions={
          <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={cn("size-4", query.isFetching && "animate-spin")} />
            Yenile
          </Button>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Metric label="Kapanan hesap" value={String(orders.length)} icon={CheckCircle2} />
        <Metric label="Tahsilat toplamı" value={formatMoney(paidTotal)} icon={CircleDollarSign} />
        <Metric
          label="Kart / nakit"
          value={`${paymentCount(orders, "CARD")} / ${paymentCount(orders, "CASH")}`}
          icon={WalletCards}
        />
      </div>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>İşlem geçmişi</CardTitle>
          <CardDescription>En yeni kapanan hesaplar önce gösterilir.</CardDescription>
          <div className="relative mt-3 max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Masa, sipariş veya kanal ara"
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {filtered.map((order) => (
            <div
              key={order.id}
              className="grid gap-3 px-4 py-4 transition-colors hover:bg-muted/35 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-center"
            >
              <div>
                <p className="font-semibold">{order.table_name ?? order.customer_name ?? compactId(order.id)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  #{compactId(order.id)} · {order.source}
                </p>
              </div>
              <div>
                <p className="font-semibold">{formatMoney(order.total, order.currency)}</p>
                <p className="text-xs text-muted-foreground">{paymentSummary(order)}</p>
              </div>
              <div>
                <Badge variant="outline" className={statusClass(order.status)}>
                  {statusLabel(order.status)}
                </Badge>
                <p className="mt-1.5 text-xs text-muted-foreground">{formatDateTime(order.created_at)}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={order.status !== "PAID" || reprint.isPending}
                onClick={() => reprint.mutate(order)}
              >
                <Printer className="size-4" />
                Fiş
              </Button>
            </div>
          ))}
          {filtered.length === 0 ? (
            <div className="px-4 py-14 text-center text-sm text-muted-foreground">
              Aramanızla eşleşen kapanmış sipariş bulunamadı.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function CashierShiftPage() {
  const queryClient = useQueryClient();
  const [openingFloat, setOpeningFloat] = useState("2500");
  const [countedCash, setCountedCash] = useState("");
  const [closingNote, setClosingNote] = useState("");
  const query = useQuery({
    queryKey: ["shifts", "current"],
    queryFn: () => request<CashierShift | null>("/shifts/current"),
  });
  const shift = query.data ?? null;
  const expectedCash =
    Number(shift?.opening_cash ?? 0) + Number(shift?.cash_sales ?? 0);
  const variance = countedCash ? Number(countedCash) - expectedCash : null;
  const openShift = useMutation({
    mutationFn: () =>
      request<CashierShift>("/shifts/open", {
        method: "POST",
        body: JSON.stringify({ opening_cash: openingFloat }),
      }),
    onSuccess: async () => {
      toast.success("Kasa vardiyası açıldı.");
      await queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Vardiya açılamadı."),
  });
  const closeShift = useMutation({
    mutationFn: () => {
      if (!shift) throw new Error("Açık vardiya bulunamadı.");
      return request<CashierShift>(`/shifts/${shift.id}/close`, {
        method: "POST",
        body: JSON.stringify({ closing_cash: countedCash, note: closingNote || null }),
      });
    },
    onSuccess: async () => {
      setCountedCash("");
      setClosingNote("");
      toast.success("Vardiya kapanış özeti ve denetim kaydı oluşturuldu.");
      await queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Vardiya kapatılamadı."),
  });

  if (query.isLoading || query.isError) {
    return (
      <OperationQueryState
        eyebrow="Kasa"
        title="Vardiya kontrolü"
        description="Kasa açılışını, tahsilat özetini ve gün sonu nakit sayımını tek ekrandan yönetin."
        icon={WalletCards}
        loading={query.isLoading}
        fetching={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="min-h-full bg-muted/20 p-4 sm:p-6">
      <PageHeader
        eyebrow="Kasa"
        title="Vardiya kontrolü"
        description="Kasa açılışını, tahsilat özetini ve gün sonu nakit sayımını tek ekrandan yönetin."
        icon={WalletCards}
        actions={
          <Badge
            variant="outline"
            className={shift ? statusClass("COMPLETED") : statusClass("CANCELLED")}
          >
            {shift ? "Vardiya açık" : "Vardiya kapalı"}
          </Badge>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Beklenen nakit" value={formatMoney(expectedCash)} icon={Banknote} />
            <Metric
              label="Kart tahsilatı"
              value={formatMoney(shift?.card_sales ?? 0)}
              icon={WalletCards}
            />
            <Metric
              label="Toplam tahsilat"
              value={formatMoney(shift?.total_sales ?? 0)}
              icon={CircleDollarSign}
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Vardiya özeti</CardTitle>
              <CardDescription>Merkez Şube · Kasa 1</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <ShiftRow
                label="Açılış saati"
                value={shift ? formatDateTime(shift.opened_at) : "—"}
              />
              <ShiftRow
                label="Açılış bakiyesi"
                value={formatMoney(shift?.opening_cash)}
              />
              <ShiftRow label="Nakit tahsilat" value={formatMoney(shift?.cash_sales ?? 0)} />
              <ShiftRow label="Kart tahsilat" value={formatMoney(shift?.card_sales ?? 0)} />
              <ShiftRow label="Vardiya durumu" value={shift ? "Açık" : "Kapalı"} />
              <ShiftRow label="Kasiyer" value="Kasa Kullanıcısı" />
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{shift ? "Vardiyayı kapat" : "Yeni vardiya aç"}</CardTitle>
            <CardDescription>
              {shift
                ? "Fiziksel kasayı sayın; fark varsa kapanış notuna ekleyin."
                : "Kasadaki başlangıç nakdini girerek vardiyayı başlatın."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {shift ? (
              <>
                <label className="block text-sm font-medium">
                  Sayılan nakit
                  <Input
                    className="mt-2"
                    inputMode="decimal"
                    value={countedCash}
                    onChange={(event) => setCountedCash(event.target.value)}
                    placeholder="0,00"
                  />
                </label>
                <div className="rounded-xl bg-muted/60 p-4">
                  <p className="text-xs text-muted-foreground">Kasa farkı</p>
                  <p
                    className={cn(
                      "mt-1 text-xl font-semibold",
                      variance === null
                        ? "text-muted-foreground"
                        : Math.abs(variance) < 0.01
                          ? "text-emerald-600"
                          : "text-red-600",
                    )}
                  >
                    {variance === null ? "—" : formatMoney(variance)}
                  </p>
                </div>
                <label className="block text-sm font-medium">
                  Kapanış notu
                  <Input
                    className="mt-2"
                    value={closingNote}
                    onChange={(event) => setClosingNote(event.target.value)}
                    placeholder="İsteğe bağlı açıklama"
                  />
                </label>
                <Button
                  className="w-full"
                  disabled={!countedCash || closeShift.isPending}
                  onClick={() => closeShift.mutate()}
                >
                  {closeShift.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-4" />
                  )}
                  Sayımı onayla ve kapat
                </Button>
              </>
            ) : (
              <>
                <label className="block text-sm font-medium">
                  Açılış bakiyesi
                  <Input
                    className="mt-2"
                    inputMode="decimal"
                    value={openingFloat}
                    onChange={(event) => setOpeningFloat(event.target.value)}
                  />
                </label>
                <Button
                  className="w-full"
                  disabled={!openingFloat || openShift.isPending}
                  onClick={() => openShift.mutate()}
                >
                  {openShift.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Clock3 className="size-4" />
                  )}
                  Vardiyayı aç
                </Button>
              </>
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              Vardiya hareketleri kasiyer, şube ve cihaz bilgisiyle denetim kaydına bağlanır.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function KitchenHistoryPage() {
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["kitchen", "history"],
    queryFn: async () => {
      const tickets = await request<KitchenTicket[]>("/kitchen/tickets?include_completed=true");
      return tickets.filter((ticket) =>
        ["COMPLETED", "CANCELLED"].includes(ticket.status),
      );
    },
    refetchInterval: 30_000,
  });
  const tickets = query.data ?? [];
  const filtered = tickets.filter((ticket) => {
    const haystack = `${ticket.table_name} ${ticket.station_name} ${ticket.waiter_name} ${ticket.order_id}`;
    return haystack.toLocaleLowerCase("tr-TR").includes(search.toLocaleLowerCase("tr-TR"));
  });

  if (query.isLoading || query.isError) {
    return (
      <OperationQueryState
        eyebrow="Mutfak"
        title="Bilet geçmişi"
        description="Tamamlanan ve iptal edilen üretim biletlerini istasyon, masa ve sipariş bazında inceleyin."
        icon={BookOpenText}
        loading={query.isLoading}
        fetching={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="min-h-full bg-muted/20 p-4 sm:p-6">
      <PageHeader
        eyebrow="Mutfak"
        title="Bilet geçmişi"
        description="Tamamlanan ve iptal edilen üretim biletlerini istasyon, masa ve sipariş bazında inceleyin."
        icon={BookOpenText}
        actions={
          <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={cn("size-4", query.isFetching && "animate-spin")} />
            Yenile
          </Button>
        }
      />
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Tamamlanan biletler</CardTitle>
          <div className="relative mt-3 max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Masa, istasyon veya sipariş ara"
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 lg:grid-cols-2">
          {filtered.map((ticket) => (
            <article key={ticket.id} className="rounded-2xl border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{ticket.table_name ?? "Paket sipariş"}</p>
                  <p className="text-xs text-muted-foreground">
                    #{compactId(ticket.order_id)} · {ticket.station_name ?? "İstasyon"}
                  </p>
                </div>
                <Badge variant="outline" className={statusClass(ticket.status)}>
                  {statusLabel(ticket.status)}
                </Badge>
              </div>
              <ul className="my-4 space-y-2 border-y py-3">
                {(ticket.items ?? []).map((item) => (
                  <li key={item.id} className="flex justify-between gap-3 text-sm">
                    <span>{item.name}</span>
                    <strong>×{Number(item.quantity)}</strong>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                <span>{ticket.waiter_name ?? "Sistem"}</span>
                <span>{formatDateTime(ticket.created_at)}</span>
              </div>
            </article>
          ))}
          {filtered.length === 0 ? (
            <div className="px-4 py-14 text-center text-sm text-muted-foreground lg:col-span-2">
              {search
                ? "Aramanızla eşleşen tamamlanmış bilet bulunamadı."
                : "Henüz tamamlanmış veya iptal edilmiş mutfak bileti yok."}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function KitchenPrintersPage() {
  const queryClient = useQueryClient();
  const devicesQuery = useQuery({
    queryKey: ["printing", "devices"],
    queryFn: () => request<PrinterDevice[]>("/printing/devices"),
    refetchInterval: 15_000,
  });
  const query = useQuery({
    queryKey: ["printing", "jobs"],
    queryFn: () => request<PrintJob[]>("/printing/jobs"),
    refetchInterval: 10_000,
  });
  const jobs = query.data ?? [];
  const devices = devicesQuery.data ?? [];
  const retry = useMutation({
    mutationFn: (job: PrintJob) =>
      request<PrintJob>("/printing/jobs", {
        method: "POST",
        body: JSON.stringify({
          order_id: job.order_id,
          kitchen_ticket_id: job.kitchen_ticket_id,
          kind: "REPRINT",
          idempotency_key: `print-retry-${job.id}-${Date.now()}`,
          payload: job.payload ?? { template: "KITCHEN_TICKET" },
        }),
      }),
    onSuccess: async () => {
      toast.success("Yazdırma işi yeniden kuyruğa alındı.");
      await queryClient.invalidateQueries({ queryKey: ["printing", "jobs"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "İşlem başarısız."),
  });
  const active = jobs.filter((job) => ["PENDING", "CLAIMED", "SENT"].includes(job.status)).length;
  const failed = jobs.filter((job) => job.status === "FAILED").length;
  const dataLoading = query.isLoading || devicesQuery.isLoading;
  const dataError = query.error ?? devicesQuery.error;
  const dataFetching = query.isFetching || devicesQuery.isFetching;

  if (dataLoading || dataError) {
    return (
      <OperationQueryState
        eyebrow="Mutfak altyapısı"
        title="Yazıcı kuyruğu"
        description="Print Bridge durumunu ve mutfak fişlerinin teslim geçmişini izleyin."
        icon={Printer}
        loading={dataLoading}
        fetching={dataFetching}
        onRetry={() => {
          void Promise.all([query.refetch(), devicesQuery.refetch()]);
        }}
      />
    );
  }

  return (
    <div className="min-h-full bg-muted/20 p-4 sm:p-6">
      <PageHeader
        eyebrow="Mutfak altyapısı"
        title="Yazıcı kuyruğu"
        description="Print Bridge durumunu ve mutfak fişlerinin teslim geçmişini izleyin."
        icon={Printer}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              void Promise.all([query.refetch(), devicesQuery.refetch()]);
            }}
            disabled={dataFetching}
          >
            <RefreshCw className={cn("size-4", dataFetching && "animate-spin")} />
            Yenile
          </Button>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Metric label="Kuyrukta" value={String(active)} icon={Loader2} />
        <Metric label="Başarılı" value={String(jobs.filter((job) => job.status === "PRINTED").length)} icon={CheckCircle2} />
        <Metric label="Müdahale gerekli" value={String(failed)} icon={TriangleAlert} />
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {devices.map((device) => (
          <Card key={device.id} size="sm">
            <CardContent className="flex items-center gap-3">
              <span
                className={cn(
                  "flex size-10 items-center justify-center rounded-xl",
                  device.is_active
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Printer className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold">{device.name}</p>
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      device.is_active ? "bg-emerald-500" : "bg-zinc-400",
                    )}
                  />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {device.code} · {device.transport}
                  {device.last_seen_at
                    ? ` · ${formatDateTime(device.last_seen_at, { timeStyle: "short" })}`
                    : ""}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
        {devices.length === 0 ? (
          <Card size="sm">
            <CardContent className="text-sm text-muted-foreground">
              Bu şubede tanımlı yazıcı bulunmuyor.
            </CardContent>
          </Card>
        ) : null}
      </div>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Son yazdırma işleri</CardTitle>
          <CardDescription>Bridge her işi tekil anahtarla sahiplenir; başarısız işler güvenle yeniden denenebilir.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-center"
            >
              <div>
                <p className="font-semibold">#{compactId(job.id)}</p>
                <p className="text-xs text-muted-foreground">{job.kind}</p>
              </div>
              <div>
                <Badge variant="outline" className={statusClass(job.status)}>
                  {statusLabel(job.status)}
                </Badge>
                <p className="mt-1 text-xs text-muted-foreground">{job.attempt_count} deneme</p>
              </div>
              <div className="text-xs text-muted-foreground">
                <p>{formatDateTime(job.created_at)}</p>
                {job.last_error ? <p className="mt-1 text-red-600">{job.last_error}</p> : null}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={job.status !== "FAILED" || retry.isPending}
                onClick={() => retry.mutate(job)}
              >
                {retry.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Tekrar dene
              </Button>
            </div>
          ))}
          {jobs.length === 0 ? (
            <div className="px-4 py-14 text-center text-sm text-muted-foreground">
              Henüz yazdırma işi bulunmuyor.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Banknote;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Icon className="size-5" />
        </span>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-lg font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ShiftRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/25 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function paymentCount(orders: Order[], method: string) {
  return orders.flatMap((order) => order.payments ?? []).filter((payment) => payment.method === method).length;
}

function paymentSummary(order: Order) {
  const methods = [...new Set((order.payments ?? []).map((payment) => payment.method))];
  return methods.length ? methods.join(" + ") : order.status === "PAID" ? "Tahsil edildi" : "Tahsilat yok";
}
