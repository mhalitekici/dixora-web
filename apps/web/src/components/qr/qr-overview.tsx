"use client"

import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  LayoutDashboard,
  QrCode,
  Settings2,
  ShoppingBag,
  ToggleLeft,
} from "lucide-react"
import Link from "next/link"

import { QrAdminNav } from "@/components/qr/qr-admin-nav"
import {
  useQrConfig,
  useQrRequests,
  useQrTables,
} from "@/components/qr/qr-hooks"
import { requestStatusLabel } from "@/components/qr/qr-utils"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { StatCard } from "@/components/shared/stat-card"
import { StatusBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatRelativeTime } from "@/lib/formatters"

export function QrOverview() {
  const configQuery = useQrConfig()
  const requestsQuery = useQrRequests("ALL")
  const tablesQuery = useQrTables()
  const requests = requestsQuery.data ?? []
  const tables = tablesQuery.data ?? []
  const pending = requests.filter((request) => request.status === "PENDING")
  const approved = requests.filter((request) => request.status === "APPROVED")
  const activeCodes = tables.filter(
    (table) => table.is_active && table.qr_token,
  ).length
  const isPublished = Boolean(
    configQuery.data?.is_enabled &&
      configQuery.data.order_mode !== "DISABLED",
  )

  return (
    <div>
      <QrAdminNav />
      <PageHeader
        eyebrow="Dijital kanal"
        title="QR Menü"
        description="Menü görünümünü, masa kodlarını ve müşteri sipariş taleplerini tek akıştan yönetin."
        icon={LayoutDashboard}
        actions={
          <Button
            render={<Link href="/admin/qr-menu/settings" />}
            variant="outline"
            className="h-10 rounded-xl"
          >
            <Settings2 />
            Menü ayarları
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="QR menü durumu"
          value={
            configQuery.isLoading
              ? "Yükleniyor"
              : isPublished
                ? "Yayında"
                : "Kapalı"
          }
          detail={
            configQuery.data?.order_mode
              ? orderModeLabel(configQuery.data.order_mode)
              : "Yapılandırma bekleniyor"
          }
          icon={ToggleLeft}
          tone={isPublished ? "success" : "default"}
        />
        <StatCard
          title="Aktif masa kodu"
          value={tablesQuery.isLoading ? "—" : activeCodes}
          detail={`${tables.length} masa kaydı`}
          icon={QrCode}
          tone="brand"
        />
        <StatCard
          title="Onay bekleyen"
          value={requestsQuery.isLoading ? "—" : pending.length}
          detail="Müşteri sipariş talebi"
          icon={Clock3}
          tone={pending.length > 0 ? "warning" : "default"}
        />
        <StatCard
          title="Onaylanan"
          value={requestsQuery.isLoading ? "—" : approved.length}
          detail="Son 200 talep içinde"
          icon={CheckCircle2}
          tone="success"
        />
      </section>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <SectionCard
          title="Son müşteri talepleri"
          description="Bekleyen talepler 15 saniyede bir sunucudan yenilenir."
          action={
            <Button
              render={<Link href="/admin/qr-menu/orders" />}
              variant="ghost"
              size="sm"
            >
              Tümünü aç
              <ArrowRight />
            </Button>
          }
          contentClassName="space-y-2"
        >
          {requestsQuery.isLoading ? (
            [1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-16 rounded-xl" />
            ))
          ) : requests.length === 0 ? (
            <div className="rounded-xl border border-dashed p-7 text-center">
              <ShoppingBag className="mx-auto size-7 text-muted-foreground/50" />
              <p className="mt-2 text-sm font-semibold">Henüz talep yok</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Masa QR kodundan gönderilen siparişler burada görünür.
              </p>
            </div>
          ) : (
            requests.slice(0, 5).map((request) => {
              const table = tables.find(
                (item) => item.id === request.table_id,
              )
              return (
                <div
                  key={request.id}
                  className="flex items-center gap-3 rounded-xl border p-3"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                    <ShoppingBag className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {table?.name ?? `Masa ${request.table_id.slice(0, 6)}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeTime(request.created_at)}
                    </p>
                  </div>
                  <StatusBadge
                    tone={statusTone(request.status)}
                    pulse={request.status === "PENDING"}
                  >
                    {requestStatusLabel(request.status)}
                  </StatusBadge>
                </div>
              )
            })
          )}
        </SectionCard>

        <SectionCard
          title="Yayın kontrolü"
          description="Mevcut backend yapılandırmasının anlık özeti."
          contentClassName="space-y-4"
        >
          {configQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
            </div>
          ) : configQuery.data ? (
            <>
              <div className="rounded-xl bg-muted/60 p-4">
                <p className="text-xs text-muted-foreground">Menü adı</p>
                <p className="mt-1 font-semibold">
                  {configQuery.data.menu_name}
                </p>
              </div>
              <div className="rounded-xl bg-muted/60 p-4">
                <p className="text-xs text-muted-foreground">Sipariş modu</p>
                <p className="mt-1 font-semibold">
                  {orderModeLabel(configQuery.data.order_mode)}
                </p>
              </div>
              <Button
                render={<Link href="/admin/qr-menu/codes" />}
                className="h-10 w-full rounded-xl"
              >
                <QrCode />
                QR kodlarını yönet
              </Button>
            </>
          ) : (
            <div className="rounded-xl border border-dashed p-5 text-sm">
              <p className="font-semibold">Yapılandırma bulunamadı</p>
              <p className="mt-1 text-muted-foreground">
                Ayarlar ekranından ilk QR menü yapılandırmasını oluşturun.
              </p>
              <Button
                render={<Link href="/admin/qr-menu/settings" />}
                className="mt-4"
              >
                Yapılandır
              </Button>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}

function orderModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    MENU_ONLY: "Yalnız menü",
    WAITER_APPROVAL: "Personel onaylı sipariş",
    AUTOMATIC_ACCEPTANCE: "Otomatik kabul",
    DISABLED: "Devre dışı",
  }
  return labels[mode] ?? mode
}

function statusTone(
  status: string,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "APPROVED") return "success"
  if (status === "PENDING") return "warning"
  if (status === "REJECTED") return "danger"
  return "neutral"
}
