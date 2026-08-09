"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Banknote,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  History,
  Loader2,
  Printer,
  ReceiptText,
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
import { useCurrentUser } from "@/hooks/use-auth";
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
  payments?: Array<{
    id: string;
    method: string;
    amount: string | number;
    status: string;
    reference?: string | null;
  }>;
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
  user_id: string;
  cashier_name?: string | null;
  predecessor_shift_id?: string | null;
  status: string;
  opening_cash: string | number;
  opening_note?: string | null;
  closing_cash?: string | number | null;
  cash_sales: string | number;
  card_sales: string | number;
  total_sales: string | number;
  cash_variance?: string | number | null;
  opened_at: string;
  closed_at?: string | null;
  closing_note?: string | null;
};

type ShiftHandoffResult = {
  closed: CashierShift;
  opened: CashierShift;
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

const METHOD_FILTERS = ["ALL", "CASH", "CARD", "ROOM_CHARGE"] as const;
type MethodFilter = (typeof METHOD_FILTERS)[number];

export function ClosedOrdersPage() {
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState<MethodFilter>("ALL");
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
    return orders.filter((order) => {
      const methodMatch =
        methodFilter === "ALL" ||
        (order.payments ?? []).some((payment) => payment.method === methodFilter);
      if (!methodMatch) return false;
      if (!needle) return true;
      return [
        order.id,
        order.table_name,
        order.customer_name,
        order.source,
        ...orderRoomReferences(order),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("tr-TR").includes(needle));
    });
  }, [orders, search, methodFilter]);
  const paidTotal = orders
    .filter((order) => order.status === "PAID")
    .reduce((total, order) => total + Number(order.total), 0);
  const roomTotal = paymentTotal(orders, "ROOM_CHARGE");

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
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Kapanan hesap" value={String(orders.length)} icon={CheckCircle2} />
        <Metric label="Tahsilat toplamı" value={formatMoney(paidTotal)} icon={CircleDollarSign} />
        <Metric
          label="Kart / nakit"
          value={`${paymentCount(orders, "CARD")} / ${paymentCount(orders, "CASH")}`}
          icon={WalletCards}
        />
        <Metric
          label="Oda hesapları"
          value={`${formatMoney(roomTotal)} · ${paymentCount(orders, "ROOM_CHARGE")} kayıt`}
          icon={ReceiptText}
        />
      </div>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>İşlem geçmişi</CardTitle>
          <CardDescription>En yeni kapanan hesaplar önce gösterilir.</CardDescription>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {METHOD_FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMethodFilter(value)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  methodFilter === value
                    ? "border-brand/35 bg-brand-soft text-brand"
                    : "border-input text-muted-foreground hover:bg-muted/45",
                )}
              >
                {value === "ALL" ? "Tümü" : paymentMethodLabel(value)}
              </button>
            ))}
          </div>
          <div className="relative mt-3 max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Masa, sipariş, kanal veya oda ara"
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
  const session = useCurrentUser();
  const [cashierName, setCashierName] = useState("");
  const [openingFloat, setOpeningFloat] = useState("2500");
  const [openingNote, setOpeningNote] = useState("");
  const [action, setAction] = useState<"close" | "handoff">("close");
  const [countedCash, setCountedCash] = useState("");
  const [closingNote, setClosingNote] = useState("");
  const [nextCashierName, setNextCashierName] = useState("");
  const [nextOpeningCash, setNextOpeningCash] = useState("");

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
        body: JSON.stringify({
          cashier_name: cashierName.trim(),
          opening_cash: openingFloat,
          note: openingNote.trim() || null,
        }),
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
  const handoffShift = useMutation({
    mutationFn: () => {
      if (!shift) throw new Error("Açık vardiya bulunamadı.");
      if (nextCashierName.trim().length < 2) throw new Error("Devralan kasiyerin adını yazın.");
      return request<ShiftHandoffResult>(`/shifts/${shift.id}/handoff`, {
        method: "POST",
        body: JSON.stringify({
          counted_cash: countedCash,
          next_cashier_name: nextCashierName.trim(),
          next_opening_cash: nextOpeningCash || null,
          note: closingNote || null,
        }),
      });
    },
    onSuccess: async (result) => {
      setCountedCash("");
      setClosingNote("");
      setNextCashierName("");
      setNextOpeningCash("");
      toast.success("Vardiya devredildi", {
        description: `${result.opened.cashier_name} · ${formatMoney(result.opened.opening_cash)} açılış bakiyesiyle başladı.`,
      });
      await queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Vardiya devredilemedi."),
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
              <CardDescription>
                {session.data?.branch?.name ?? "Şube"}
              </CardDescription>
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
              <ShiftRow
                label="Kasiyer"
                value={shift?.cashier_name || session.data?.user.displayName || "Kasa kullanıcısı"}
              />
              {shift?.opening_note ? (
                <ShiftRow label="Açılış notu" value={shift.opening_note} />
              ) : null}
              {shift?.predecessor_shift_id ? (
                <ShiftRow label="Devir" value="Önceki kasiyerden devralındı" />
              ) : null}
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>
              {shift ? (action === "close" ? "Vardiyayı kapat" : "Vardiyayı devret") : "Yeni vardiya aç"}
            </CardTitle>
            <CardDescription>
              {shift
                ? "Fiziksel kasayı sayın; fark varsa açıklama ekleyin."
                : "Kasadaki başlangıç nakdini girerek vardiyayı başlatın."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {shift ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={action === "close" ? "default" : "outline"}
                    onClick={() => setAction("close")}
                  >
                    <ShieldCheck className="size-4" />
                    Kapat
                  </Button>
                  <Button
                    type="button"
                    variant={action === "handoff" ? "default" : "outline"}
                    onClick={() => setAction("handoff")}
                  >
                    <ArrowLeftRight className="size-4" />
                    Devret
                  </Button>
                </div>
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
                {action === "handoff" ? (
                  <>
                    <label className="block text-sm font-medium">
                      Devralan kasiyerin adı
                      <Input
                        className="mt-2"
                        value={nextCashierName}
                        onChange={(event) => setNextCashierName(event.target.value)}
                        placeholder="Örn. Zeynep Kaya"
                        autoFocus
                      />
                    </label>
                    <label className="block text-sm font-medium">
                      Yeni açılış bakiyesi (opsiyonel)
                      <Input
                        className="mt-2"
                        inputMode="decimal"
                        value={nextOpeningCash}
                        onChange={(event) => setNextOpeningCash(event.target.value)}
                        placeholder={countedCash ? `Varsayılan: ${countedCash}` : "0,00"}
                      />
                    </label>
                  </>
                ) : null}
                <label className="block text-sm font-medium">
                  {action === "close" ? "Kapanış notu" : "Devir notu"}
                  <Input
                    className="mt-2"
                    value={closingNote}
                    onChange={(event) => setClosingNote(event.target.value)}
                    placeholder="İsteğe bağlı açıklama"
                  />
                </label>
                {action === "close" ? (
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
                ) : (
                  <Button
                    className="w-full"
                    disabled={!countedCash || nextCashierName.trim().length < 2 || handoffShift.isPending}
                    onClick={() => handoffShift.mutate()}
                  >
                    {handoffShift.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ArrowLeftRight className="size-4" />
                    )}
                    Vardiyayı devret
                  </Button>
                )}
              </>
            ) : (
              <>
                <label className="block text-sm font-medium">
                  Kasiyer adı
                  <Input
                    className="mt-2"
                    value={cashierName}
                    onChange={(event) => setCashierName(event.target.value)}
                    placeholder="Örn. Ahmet Yılmaz"
                    autoFocus
                  />
                </label>
                <label className="block text-sm font-medium">
                  Açılış bakiyesi
                  <Input
                    className="mt-2"
                    inputMode="decimal"
                    value={openingFloat}
                    onChange={(event) => setOpeningFloat(event.target.value)}
                  />
                </label>
                <label className="block text-sm font-medium">
                  Not (opsiyonel)
                  <Input
                    className="mt-2"
                    value={openingNote}
                    onChange={(event) => setOpeningNote(event.target.value)}
                    placeholder="Örn. devir teslim tutanağı"
                  />
                </label>
                <Button
                  className="w-full"
                  disabled={!openingFloat || cashierName.trim().length < 2 || openShift.isPending}
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

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Nakit",
  CARD: "Kart",
  ROOM_CHARGE: "Oda",
};

function paymentMethodLabel(method: string) {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

function paymentCount(orders: Order[], method: string) {
  return orders.flatMap((order) => order.payments ?? []).filter((payment) => payment.method === method).length;
}

function paymentTotal(orders: Order[], method: string) {
  return orders
    .flatMap((order) => order.payments ?? [])
    .filter((payment) => payment.method === method)
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
}

function orderRoomReferences(order: Order) {
  return [
    ...new Set(
      (order.payments ?? [])
        .filter((payment) => payment.method === "ROOM_CHARGE" && payment.reference)
        .map((payment) => payment.reference as string),
    ),
  ];
}

function paymentSummary(order: Order) {
  const methods = [...new Set((order.payments ?? []).map((payment) => payment.method))];
  if (!methods.length) return order.status === "PAID" ? "Tahsil edildi" : "Tahsilat yok";
  const rooms = orderRoomReferences(order);
  const label = methods.map(paymentMethodLabel).join(" + ");
  return rooms.length ? `${label} · ${rooms.join(", ")}` : label;
}
