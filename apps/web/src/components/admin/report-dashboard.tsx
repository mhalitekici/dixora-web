"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  CreditCard,
  ReceiptText,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { z } from "zod";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { adminApi, adminKeys } from "./admin-api";
import {
  AdapterNotice,
  dateTime,
  ErrorState,
  FieldError,
  LoadingState,
  money,
  number,
} from "./admin-utils";

const rangeSchema = z
  .object({
    from: z.string().min(1, "Başlangıç tarihi seçin."),
    to: z.string().min(1, "Bitiş tarihi seçin."),
  })
  .refine((value) => new Date(value.from) <= new Date(value.to), {
    message: "Başlangıç tarihi bitişten sonra olamaz.",
    path: ["to"],
  })
  .refine(
    (value) =>
      new Date(value.to).getTime() - new Date(value.from).getTime() <=
      366 * 24 * 60 * 60 * 1000,
    { message: "Tarih aralığı en fazla 366 gün olabilir.", path: ["to"] },
  );
type RangeValues = z.infer<typeof rangeSchema>;

const paymentLabels: Record<string, string> = {
  CASH: "Nakit",
  CREDIT_CARD: "Kredi kartı",
  DEBIT_CARD: "Banka kartı",
  ONLINE: "Online",
  MEAL_CARD: "Yemek kartı",
  OTHER: "Diğer",
};
const chartColors = ["#f15a24", "#2563eb", "#059669", "#7c3aed", "#d97706", "#64748b"];

export function ReportDashboard() {
  const today = useMemo(() => startOfToday(), []);
  const defaultRange = useMemo(
    () => ({
      from: dateInput(addDays(today, -29)),
      to: dateInput(today),
    }),
    [today],
  );
  const [range, setRange] = useState<RangeValues>(defaultRange);
  const form = useForm<RangeValues>({
    resolver: zodResolver(rangeSchema),
    defaultValues: defaultRange,
  });

  const queryRange = toApiRange(range);
  const previousRange = previousPeriod(range);
  const previousApiRange = toApiRange(previousRange);
  const currentQuery = useQuery({
    queryKey: adminKeys.report(queryRange.from, queryRange.to),
    queryFn: ({ signal }) =>
      adminApi.salesSummary(queryRange.from, queryRange.to, signal),
  });
  const previousQuery = useQuery({
    queryKey: adminKeys.report(previousApiRange.from, previousApiRange.to),
    queryFn: ({ signal }) =>
      adminApi.salesSummary(previousApiRange.from, previousApiRange.to, signal),
  });
  const shiftHistoryQuery = useQuery({
    queryKey: adminKeys.shiftHistory(100),
    queryFn: ({ signal }) => adminApi.shiftHistory(100, signal),
  });

  const applyPreset = (days: number) => {
    const next = {
      from: dateInput(addDays(today, -(days - 1))),
      to: dateInput(today),
    };
    form.reset(next);
    setRange(next);
  };

  if (currentQuery.isLoading || previousQuery.isLoading) {
    return <LoadingState label="Satış raporu hesaplanıyor…" />;
  }
  const firstError = currentQuery.error ?? previousQuery.error;
  if (firstError) {
    return (
      <ErrorState
        error={firstError}
        onRetry={() => {
          void currentQuery.refetch();
          void previousQuery.refetch();
        }}
      />
    );
  }

  const summary = currentQuery.data;
  const previous = previousQuery.data;
  const paymentData = Object.entries(summary?.by_payment_method ?? {})
    .map(([method, value]) => ({
      method: paymentLabels[method] ?? prettify(method),
      value: Number(value),
    }))
    .sort((a, b) => b.value - a.value);
  const grossTrend = percentChange(Number(summary?.gross_sales), Number(previous?.gross_sales));
  const ordersTrend = percentChange(
    Number(summary?.paid_orders),
    Number(previous?.paid_orders),
  );
  const averageTrend = percentChange(
    Number(summary?.average_order_value),
    Number(previous?.average_order_value),
  );
  const paymentTotal = paymentData.reduce((sum, item) => sum + item.value, 0);

  return (
    <>
      <PageHeader
        eyebrow="Gerçek rapor API’si"
        title="Satış raporları"
        description="Seçili dönemin ödenmiş siparişlerini önceki eş dönemle karşılaştırın."
        icon={BarChart3}
      />

      <form
        className="mb-5 rounded-2xl border bg-card p-4"
        onSubmit={form.handleSubmit(setRange)}
      >
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="report-from">Başlangıç</Label>
              <Input id="report-from" type="date" className="mt-1.5" {...form.register("from")} />
            </div>
            <div>
              <Label htmlFor="report-to">Bitiş</Label>
              <Input id="report-to" type="date" className="mt-1.5" {...form.register("to")} />
              <FieldError>{form.formState.errors.to?.message}</FieldError>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => applyPreset(7)}>
              Son 7 gün
            </Button>
            <Button type="button" variant="outline" onClick={() => applyPreset(30)}>
              Son 30 gün
            </Button>
            <Button type="button" variant="outline" onClick={() => applyPreset(90)}>
              Son 90 gün
            </Button>
            <Button type="submit">
              <CalendarDays />
              Raporu getir
            </Button>
          </div>
        </div>
      </form>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Brüt satış"
          value={money(summary?.gross_sales ?? 0)}
          detail="Ödenmiş sipariş toplamı"
          trend={grossTrend}
          icon={CircleDollarSign}
          tone="brand"
        />
        <StatCard
          title="Ödenen sipariş"
          value={number(summary?.paid_orders ?? 0)}
          detail="Seçili tarih aralığı"
          trend={ordersTrend}
          icon={ReceiptText}
          tone="success"
        />
        <StatCard
          title="Ortalama sepet"
          value={money(summary?.average_order_value ?? 0)}
          detail="Sipariş başına"
          trend={averageTrend}
          icon={TrendingUp}
          tone="info"
        />
        <StatCard
          title="Ödeme kanalı"
          value={number(paymentData.length)}
          detail="Tahsilat dağılımı"
          icon={CreditCard}
          tone="warning"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
        <SectionCard
          title="Ödeme yöntemi dağılımı"
          description="Gerçek tamamlanmış ödeme tutarları"
        >
          {paymentData.length ? (
            <div className="h-80 w-full" aria-label="Ödeme yöntemi satış grafiği">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={paymentData} margin={{ top: 10, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                  <XAxis dataKey="method" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => compactMoney(Number(value))}
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.35 }}
                    formatter={(value) => money(Number(value))}
                  />
                  <Bar dataKey="value" name="Satış" radius={[8, 8, 2, 2]}>
                    {paymentData.map((entry, index) => (
                      <Cell key={entry.method} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              compact
              title="Bu dönemde ödeme yok"
              description="Ödenmiş sipariş oluştuğunda ödeme dağılımı burada görünecek."
              icon={CreditCard}
            />
          )}
        </SectionCard>

        <SectionCard
          title="Kanal payları"
          description={`Toplam ${money(paymentTotal)}`}
        >
          {paymentData.length ? (
            <div className="space-y-4">
              {paymentData.map((item, index) => {
                const share = paymentTotal > 0 ? (item.value / paymentTotal) * 100 : 0;
                return (
                  <div key={item.method}>
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: chartColors[index % chartColors.length] }}
                        />
                        {item.method}
                      </span>
                      <span className="font-semibold tabular-nums">{money(item.value)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(2, share)}%`,
                          backgroundColor: chartColors[index % chartColors.length],
                        }}
                      />
                    </div>
                    <p className="mt-1 text-right text-[0.65rem] text-muted-foreground">
                      %{number(share, 1)}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Dağılım hesaplanamadı.</p>
          )}
        </SectionCard>
      </div>

      <SectionCard
        className="mt-5"
        title="Vardiya geçmişi"
        description="Kasa açılış/kapanış hareketleri, beklenen ve sayılan nakit farkıyla birlikte."
      >
        {shiftHistoryQuery.isLoading ? (
          <LoadingState label="Vardiyalar yükleniyor…" />
        ) : shiftHistoryQuery.isError ? (
          <ErrorState error={shiftHistoryQuery.error} onRetry={() => void shiftHistoryQuery.refetch()} />
        ) : (shiftHistoryQuery.data ?? []).length === 0 ? (
          <EmptyState
            compact
            title="Henüz vardiya kaydı yok"
            description="Kasiyerler vardiya açıp kapattıkça geçmiş burada listelenir."
            icon={WalletCards}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kasiyer</TableHead>
                  <TableHead>Açılış</TableHead>
                  <TableHead>Kapanış</TableHead>
                  <TableHead className="text-right">Açılış nakdi</TableHead>
                  <TableHead className="text-right">Beklenen</TableHead>
                  <TableHead className="text-right">Sayılan</TableHead>
                  <TableHead className="text-right">Fark</TableHead>
                  <TableHead>Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(shiftHistoryQuery.data ?? []).map((shift) => {
                  const expected = Number(shift.opening_cash) + Number(shift.cash_sales);
                  const variance = shift.cash_variance !== null ? Number(shift.cash_variance) : null;
                  return (
                    <TableRow key={shift.id}>
                      <TableCell className="font-medium">
                        {shift.cashier_name || shift.user_display_name || "—"}
                        {shift.predecessor_shift_id ? (
                          <span className="ml-1.5 text-xs text-muted-foreground">(devir)</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {dateTime(shift.opened_at)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {shift.closed_at ? dateTime(shift.closed_at) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(shift.opening_cash)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(expected)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {shift.closing_cash !== null ? money(shift.closing_cash) : "—"}
                      </TableCell>
                      <TableCell
                        className={
                          variance === null
                            ? "text-right tabular-nums text-muted-foreground"
                            : Math.abs(variance) < 0.01
                              ? "text-right tabular-nums text-emerald-600"
                              : "text-right tabular-nums text-destructive"
                        }
                      >
                        {variance === null ? "—" : money(variance)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={shift.status === "OPEN" ? "info" : "neutral"} dot={false}>
                          {shift.status === "OPEN" ? "Açık" : "Kapalı"}
                        </StatusBadge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <AdapterNotice className="mt-5" title="Rapor kapsamı">
        Backend şu anda yalnız satış özeti ve ödeme yöntemi kırılımı döndürüyor. Grafikler bu gerçek
        toplamlardan üretilir; sahte zaman serisi kullanılmaz. Saatlik/günlük trend için
        <code> /reports/sales-timeseries</code> adapter endpoint’i eklenmelidir (TODO).
      </AdapterNotice>
    </>
  );
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value: Date, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function dateInput(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toApiRange(range: RangeValues) {
  const from = new Date(`${range.from}T00:00:00`);
  const to = new Date(`${range.to}T23:59:59.999`);
  return { from: from.toISOString(), to: to.toISOString() };
}

function previousPeriod(range: RangeValues): RangeValues {
  const from = new Date(`${range.from}T00:00:00`);
  const to = new Date(`${range.to}T00:00:00`);
  const durationDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, -(durationDays - 1));
  return { from: dateInput(previousFrom), to: dateInput(previousTo) };
}

function percentChange(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return undefined;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function compactMoney(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function prettify(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .split("_")
    .map((part) => part.charAt(0).toLocaleUpperCase("tr-TR") + part.slice(1))
    .join(" ");
}
