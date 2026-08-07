"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  CircleDot,
  Clock3,
  Grid2X2,
  Loader2,
  ReceiptText,
  RefreshCw,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Area = { id: string; name: string };
type Table = {
  id: string;
  area_id: string;
  name: string;
  capacity: number;
  state: string;
  current_total?: string | number | null;
  guest_count?: number | null;
  customer_name?: string | null;
  occupied_since?: string | null;
};

const stateMeta: Record<string, { label: string; tone: Parameters<typeof StatusBadge>[0]["tone"]; card: string; dot: string }> = {
  AVAILABLE: { label: "Müsait", tone: "neutral", card: "border-border bg-card", dot: "bg-emerald-500" },
  OCCUPIED: { label: "Oturum açık", tone: "info", card: "border-blue-600/20 bg-blue-500/[0.035]", dot: "bg-blue-500" },
  ORDER_PENDING: { label: "Sipariş bekliyor", tone: "warning", card: "border-amber-600/25 bg-amber-500/[0.045]", dot: "bg-amber-500" },
  PREPARING: { label: "Hazırlanıyor", tone: "brand", card: "border-brand/25 bg-brand/[0.035]", dot: "bg-brand" },
  READY: { label: "Servise hazır", tone: "success", card: "border-emerald-600/30 bg-emerald-500/[0.06]", dot: "bg-emerald-500" },
  BILL_REQUESTED: { label: "Hesap istendi", tone: "purple", card: "border-violet-600/25 bg-violet-500/[0.045]", dot: "bg-violet-500" },
  PAYMENT_PENDING: { label: "Ödeme bekliyor", tone: "purple", card: "border-violet-600/25 bg-violet-500/[0.045]", dot: "bg-violet-500" },
  CLEANING: { label: "Temizleniyor", tone: "info", card: "border-cyan-600/20 bg-cyan-500/[0.035]", dot: "bg-cyan-500" },
  DISABLED: { label: "Kapalı", tone: "danger", card: "border-border bg-muted/30 opacity-60", dot: "bg-red-500" },
};

function unwrap<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: T[] }).items;
  }
  return [];
}

async function getList<T>(path: string): Promise<T[]> {
  const response = await fetch(`/api/backend${path}`);
  if (!response.ok) throw new Error("Veri yüklenemedi.");
  return unwrap<T>(await response.json());
}

const currency = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});

export function WaiterTableList() {
  const [area, setArea] = useState("all");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const areasQuery = useQuery({
    queryKey: ["waiter", "areas"],
    queryFn: () => getList<Area>("/tables/areas"),
    staleTime: 30_000,
  });
  const tablesQuery = useQuery({
    queryKey: ["waiter", "tables"],
    queryFn: () => getList<Table>("/tables"),
    refetchInterval: 10_000,
  });

  const areas = areasQuery.data ?? [];
  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);
  const filtered = useMemo(
    () =>
      tables.filter((table) => {
        const areaMatch = area === "all" || table.area_id === area;
        const searchMatch =
          table.name.toLocaleLowerCase("tr-TR").includes(search.toLocaleLowerCase("tr-TR")) ||
          table.customer_name?.toLocaleLowerCase("tr-TR").includes(search.toLocaleLowerCase("tr-TR"));
        return areaMatch && searchMatch && table.state !== "DISABLED";
      }),
    [area, search, tables],
  );
  const readyCount = tables.filter((table) => table.state === "READY").length;
  const billCount = tables.filter((table) => table.state === "BILL_REQUESTED").length;
  const dataLoading = areasQuery.isLoading || tablesQuery.isLoading;
  const dataError = areasQuery.error ?? tablesQuery.error;
  const dataFetching = areasQuery.isFetching || tablesQuery.isFetching;

  if (dataLoading) {
    return (
      <div className="flex min-h-60 items-center justify-center" role="status">
        <Loader2 className="size-6 animate-spin text-brand" />
        <span className="sr-only">Masalar yükleniyor</span>
      </div>
    );
  }

  if (dataError) {
    return (
      <div className="flex min-h-60 flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center">
        <AlertTriangle className="size-7 text-destructive" />
        <h1 className="mt-4 text-base font-semibold">Masalar yüklenemedi</h1>
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
          Alan veya masa verilerine ulaşılamıyor. Bağlantınızı kontrol edip yeniden deneyin.
        </p>
        <Button
          variant="outline"
          className="mt-4"
          disabled={dataFetching}
          onClick={() => {
            void Promise.all([areasQuery.refetch(), tablesQuery.refetch()]);
          }}
        >
          <RefreshCw className={cn(dataFetching && "animate-spin")} />
          Yeniden dene
        </Button>
      </div>
    );
  }

  return (
    <div className="pb-3">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-brand">Servis ekranı</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Masalarım</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {tables.filter((table) => table.state !== "AVAILABLE").length} aktif · {tables.length} toplam
          </p>
        </div>
        <StatusBadge tone="success" pulse>
          Canlı
        </StatusBadge>
      </header>

      {(readyCount > 0 || billCount > 0) && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="flex min-h-16 items-center gap-3 rounded-2xl border border-emerald-600/20 bg-emerald-500/8 p-3 text-left">
            <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-4" />
            </span>
            <span>
              <span className="block text-lg font-bold tabular-nums">{readyCount}</span>
              <span className="block text-[0.65rem] text-emerald-800/70 dark:text-emerald-200/70">
                Servise hazır
              </span>
            </span>
          </div>
          <div className="flex min-h-16 items-center gap-3 rounded-2xl border border-violet-600/20 bg-violet-500/8 p-3 text-left">
            <span className="flex size-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-700 dark:text-violet-300">
              <ReceiptText className="size-4" />
            </span>
            <span>
              <span className="block text-lg font-bold tabular-nums">{billCount}</span>
              <span className="block text-[0.65rem] text-violet-800/70 dark:text-violet-200/70">
                Hesap istiyor
              </span>
            </span>
          </div>
        </div>
      )}

      <div className="sticky top-[4.45rem] z-20 -mx-3 mb-3 bg-background/94 px-3 pb-3 pt-1 backdrop-blur-xl sm:-mx-5 sm:px-5">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Masa veya müşteri ara"
            name="waiter-table-search"
            className="h-11 rounded-xl bg-card pl-10"
            placeholder="Masa veya müşteri ara…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="scrollbar-subtle -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          <button
            type="button"
            onClick={() => setArea("all")}
            className={cn(
              "h-10 shrink-0 rounded-xl px-4 text-sm font-semibold",
              area === "all" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground ring-1 ring-border",
            )}
          >
            Tümü
          </button>
          {areas.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setArea(item.id)}
              className={cn(
                "h-10 shrink-0 rounded-xl px-4 text-sm font-semibold",
                area === item.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground ring-1 ring-border",
              )}
            >
              {item.name}
            </button>
          ))}
        </div>
      </div>

      {tablesQuery.isLoading ? (
        <div className="flex min-h-60 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-brand" />
        </div>
      ) : filtered.length ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {filtered.map((table) => {
            const meta = stateMeta[table.state] ?? stateMeta.AVAILABLE;
            const duration = table.occupied_since
              ? Math.max(0, Math.floor((now - new Date(table.occupied_since).getTime()) / 60_000))
              : null;
            return (
              <Link
                key={table.id}
                href={`/waiter/tables/${table.id}`}
                className={cn(
                  "group relative min-h-40 overflow-hidden rounded-2xl border p-3.5 transition-transform active:scale-[0.98]",
                  meta.card,
                )}
              >
                <span className={cn("absolute inset-x-0 top-0 h-1", meta.dot)} />
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-bold">{table.name}</h2>
                    <span className="mt-1 flex items-center gap-1 text-[0.65rem] text-muted-foreground">
                      <Users className="size-3" />
                      {table.guest_count ?? 0}/{table.capacity}
                    </span>
                  </div>
                  {table.state === "READY" ? (
                    <span className="flex size-8 animate-pulse items-center justify-center rounded-xl bg-emerald-500 text-white">
                      <BellRing className="size-4" />
                    </span>
                  ) : (
                    <CircleDot className={cn("size-4", meta.dot.replace("bg-", "text-"))} />
                  )}
                </div>
                <div className="mt-5">
                  <StatusBadge tone={meta.tone} dot={false} className="max-w-full text-[0.58rem]">
                    {meta.label}
                  </StatusBadge>
                  {duration !== null ? (
                    <p className="mt-2 flex items-center gap-1 text-[0.65rem] text-muted-foreground">
                      <Clock3 className="size-3" />
                      {duration} dakika
                    </p>
                  ) : (
                    <p className="mt-2 text-[0.65rem] text-muted-foreground">Yeni oturum</p>
                  )}
                </div>
                <div className="absolute inset-x-3.5 bottom-3.5 flex items-center justify-between">
                  <span className="text-sm font-semibold tabular-nums">
                    {table.current_total ? currency.format(Number(table.current_total)) : "Masa aç"}
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed text-center">
          <Grid2X2 className="size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">Bu alanda masa bulunamadı</p>
          <p className="mt-1 text-xs text-muted-foreground">Aramayı temizleyin veya başka bir alan seçin.</p>
          <Button
            variant="outline"
            className="mt-4 h-10 rounded-xl"
            onClick={() => {
              setSearch("");
              setArea("all");
            }}
          >
            <Sparkles />
            Tüm masaları göster
          </Button>
        </div>
      )}
    </div>
  );
}
