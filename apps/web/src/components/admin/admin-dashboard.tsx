"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  BellRing,
  ChefHat,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Grid2X2,
  PackageMinus,
  Plus,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  TimerReset,
} from "lucide-react";
import Link from "next/link";

import { SalesChart } from "@/components/dashboard/sales-chart";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { adminApi, adminKeys } from "./admin-api";
import { ErrorState, LoadingState, money, number } from "./admin-utils";

const unitLabels: Record<string, string> = {
  piece: "adet",
  gram: "g",
  kilogram: "kg",
  milliliter: "ml",
  liter: "L",
};

export function AdminDashboard() {
  const dashboardQuery = useQuery({
    queryKey: adminKeys.dashboard(),
    queryFn: ({ signal }) => adminApi.dashboard(signal),
    refetchInterval: 30_000,
  });

  if (dashboardQuery.isLoading) {
    return <LoadingState label="Kontrol merkezi yükleniyor…" />;
  }
  if (dashboardQuery.error || !dashboardQuery.data) {
    return (
      <ErrorState
        error={dashboardQuery.error ?? new Error("Dashboard yanıtı boş döndü.")}
        onRetry={() => void dashboardQuery.refetch()}
      />
    );
  }

  const dashboard = dashboardQuery.data;
  const hasOperationalWarning =
    dashboard.printer_warnings > 0 ||
    dashboard.station_warnings > 0 ||
    dashboard.low_stock_items > 0;

  return (
    <>
      <PageHeader
        eyebrow="Canlı şube görünümü · 30 saniyede bir yenilenir"
        title="Operasyon kontrol merkezi"
        description="Satış, masa, hazırlık, stok ve cihaz sağlığını tek bakışta yönetin."
        actions={
          <>
            <Button
              variant="outline"
              className="h-10 rounded-xl"
              onClick={() => void dashboardQuery.refetch()}
              disabled={dashboardQuery.isFetching}
            >
              <RefreshCw className={cn(dashboardQuery.isFetching && "animate-spin")} />
              Yenile
            </Button>
            <Link
              href="/admin/products"
              className={cn(buttonVariants({ variant: "default" }), "h-10 rounded-xl px-3.5")}
            >
              <Plus />
              Hızlı ürün ekle
            </Link>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Bugünkü satış"
          value={money(dashboard.sales_today)}
          detail={`${number(dashboard.paid_orders_today)} tamamlanan sipariş`}
          icon={CircleDollarSign}
          tone="brand"
        />
        <StatCard
          title="Ortalama sepet"
          value={money(dashboard.average_order_value)}
          detail={dashboard.paid_orders_today ? "Bugünkü ödenen siparişler" : "Henüz ödeme alınmadı"}
          icon={ShoppingBag}
          tone="info"
        />
        <StatCard
          title="Açık masa"
          value={`${dashboard.open_tables} / ${dashboard.total_tables}`}
          detail={`${Math.max(0, dashboard.total_tables - dashboard.open_tables)} masa açık değil`}
          icon={Grid2X2}
          tone="success"
        />
        <StatCard
          title="Aktif sipariş"
          value={dashboard.active_orders}
          detail={`${dashboard.waiting_preparation} sipariş hazırlık bekliyor`}
          icon={ReceiptText}
          tone="warning"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_0.9fr]">
        <SectionCard
          title="Saatlik satış akışı"
          description="Bugünkü ödenen siparişler"
          action={
            <Link
              href="/admin/reports"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Raporu aç
              <ArrowRight />
            </Link>
          }
          contentClassName="pt-1"
        >
          <SalesChart
            data={dashboard.hourly_sales.map((point) => ({
              hour: point.hour,
              revenue: Number(point.revenue),
              orders: point.orders,
            }))}
          />
          <div className="mt-2 grid grid-cols-3 divide-x rounded-xl border bg-muted/25 py-3">
            <div className="px-4">
              <p className="text-[0.68rem] text-muted-foreground">Hazırlık bekleyen</p>
              <p className="mt-1 text-sm font-semibold">{dashboard.waiting_preparation}</p>
            </div>
            <div className="px-4">
              <p className="text-[0.68rem] text-muted-foreground">Hazır sipariş</p>
              <p className="mt-1 text-sm font-semibold">{dashboard.ready_orders}</p>
            </div>
            <div className="px-4">
              <p className="text-[0.68rem] text-muted-foreground">İndirim</p>
              <p className="mt-1 text-sm font-semibold">{money(dashboard.discounts_today)}</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Servis ritmi"
          description="Güncel operasyon özeti"
          action={
            <StatusBadge tone={hasOperationalWarning ? "warning" : "success"} pulse>
              {hasOperationalWarning ? "Kontrol gerekli" : "Sağlıklı"}
            </StatusBadge>
          }
        >
          <div className="space-y-2.5">
            {[
              {
                icon: ChefHat,
                label: "Hazırlık kuyruğu",
                value: `${dashboard.waiting_preparation} sipariş`,
                href: "/admin/live",
              },
              {
                icon: TimerReset,
                label: "Servise hazır",
                value: `${dashboard.ready_orders} sipariş`,
                href: "/admin/live",
              },
              {
                icon: Banknote,
                label: "Kasa vardiyası",
                value: dashboard.current_shift_status === "OPEN" ? "Açık" : "Kapalı",
                href: "/cashier",
              },
              {
                icon: BellRing,
                label: "Yazıcı uyarıları",
                value: `${dashboard.printer_warnings + dashboard.station_warnings} uyarı`,
                href: "/admin/printers",
              },
            ].map(({ icon: Icon, label, value, href }) => (
              <Link
                key={label}
                href={href}
                className="group flex items-center gap-3 rounded-xl border p-3 transition-colors hover:border-brand/25 hover:bg-brand-soft/30"
              >
                <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground group-hover:text-brand">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">{label}</span>
                  <span className="block text-sm font-semibold">{value}</span>
                </span>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
          {dashboard.cancelled_items_today > 0 ? (
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-amber-500/8 p-3 text-amber-800 dark:text-amber-200">
              <AlertTriangle className="size-4 shrink-0" />
              <p className="text-xs leading-5">
                Bugün {dashboard.cancelled_items_today} kalem iptal edildi. Ayrıntıları denetim
                kayıtlarından inceleyin.
              </p>
            </div>
          ) : null}
        </SectionCard>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard
          title="En çok satan ürünler"
          description="Bugünkü adet ve net satış"
          action={<Sparkles className="size-4 text-brand" />}
        >
          {dashboard.top_products.length ? (
            <div className="space-y-2">
              {dashboard.top_products.map((product, index) => (
                <div key={product.product_id} className="flex items-center gap-3 rounded-xl border p-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-xs font-bold text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {number(product.quantity, 2)} adet
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
                    {money(product.revenue)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="Henüz satış yok"
              description="Bugünün ödenen siparişleri burada ürün bazında sıralanacak."
              icon={ShoppingBag}
            />
          )}
        </SectionCard>

        <SectionCard
          title="Düşük stok"
          description={`${dashboard.low_stock_items} kalem eşik seviyesinde`}
          action={
            <Link
              href="/admin/inventory"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Envanteri aç
              <ArrowRight />
            </Link>
          }
        >
          {dashboard.low_stock_products.length ? (
            <div className="space-y-2.5">
              {dashboard.low_stock_products.map((item) => (
                <div
                  key={item.item_id}
                  className="flex items-start gap-2.5 rounded-xl border border-amber-600/15 bg-amber-500/5 p-3"
                >
                  <PackageMinus className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{item.name}</p>
                    <p className="mt-1 text-[0.68rem] text-muted-foreground">
                      {number(item.current_stock, 2)} {unitLabels[item.unit] ?? item.unit} · min.{" "}
                      {number(item.minimum_stock, 2)}
                    </p>
                  </div>
                  <StatusBadge tone="warning" dot={false}>
                    Düşük
                  </StatusBadge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="Stoklar dengeli"
              description="Minimum seviyenin altında aktif stok kalemi bulunmuyor."
              icon={PackageMinus}
            />
          )}
        </SectionCard>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [ClipboardCheck, "Onaylar", "İptal ve indirim taleplerini yönet", "/admin/approvals"],
          [Clock3, "Canlı operasyon", "Masa ve siparişleri izle", "/admin/live"],
          [Banknote, "Kasa", "Tahsilat ve vardiya", "/cashier"],
          [PackageMinus, "Envanter", "Stok ve reçeteler", "/admin/inventory"],
        ].map(([Icon, label, description, href]) => {
          const ItemIcon = Icon as typeof ChefHat;
          return (
            <Link
              key={String(label)}
              href={String(href)}
              className="group flex items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-brand/20"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground group-hover:bg-brand-soft group-hover:text-brand">
                <ItemIcon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{String(label)}</span>
                <span className="block truncate text-[0.68rem] text-muted-foreground">
                  {String(description)}
                </span>
              </span>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          );
        })}
      </div>
    </>
  );
}
