"use client"

import { useQuery } from "@tanstack/react-query"
import { ScrollText } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type OrderActivity = {
  order_id: string
  created_at: string
  branch_id: string
  status: string
  source: string
  table_name: string | null
  staff_name: string | null
  member_code: string | null
  delivery_channel: string | null
  customer_name: string | null
  total: string
}

const SOURCE_LABELS: Record<string, string> = {
  WAITER: "Garson",
  CASHIER: "Kasiyer",
  QR: "QR Menü",
  TAKEAWAY: "Gel-Al",
  DELIVERY: "Paket",
  KIOSK: "Kiosk",
  API: "Entegrasyon",
}

const CHANNEL_LABELS: Record<string, string> = {
  PHONE: "Telefon",
  TAKEAWAY: "Gel-Al",
  OWN_DELIVERY: "Kendi Kurye",
  MARKETPLACE: "Platform",
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Taslak",
  PENDING_APPROVAL: "Onay bekliyor",
  ACCEPTED: "Kabul edildi",
  PREPARING: "Hazırlanıyor",
  PARTIALLY_READY: "Kısmen hazır",
  READY: "Hazır",
  SERVED: "Servis edildi",
  BILL_REQUESTED: "Hesap istendi",
  PAID: "Ödendi",
  CANCELLED: "İptal",
  VOIDED: "İptal",
}

const SOURCE_FILTERS = [
  { value: "all", label: "Tümü" },
  { value: "WAITER", label: "Garson" },
  { value: "CASHIER", label: "Kasiyer" },
  { value: "QR", label: "QR Menü" },
  { value: "DELIVERY", label: "Paket" },
]

const money = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
})

const time = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

/** Local midnight, formatted for a date input. */
function isoDate(offsetDays = 0): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

const RANGE_PRESETS = [
  { label: "Bugün", from: () => isoDate(), to: () => isoDate() },
  { label: "Son 7 gün", from: () => isoDate(-6), to: () => isoDate() },
  { label: "Son 30 gün", from: () => isoDate(-29), to: () => isoDate() },
]

/**
 * "Who put this order through, and how."
 *
 * Every order carried this attribution already, but it was spread across the
 * order, its session and its delivery row, so nobody could answer the question
 * without a database client.
 */
export function OrderActivityReport() {
  const [source, setSource] = useState("all")
  const [from, setFrom] = useState(() => isoDate(-6))
  const [to, setTo] = useState(() => isoDate())

  const activityQuery = useQuery({
    queryKey: ["reports", "order-activity", from, to],
    queryFn: ({ signal }) =>
      api.get<OrderActivity[]>("reports/order-activity", {
        search: {
          limit: 500,
          date_from: `${from}T00:00:00`,
          // Inclusive end of the chosen day, not midnight at its start.
          date_to: `${to}T23:59:59`,
        },
        signal,
      }),
    refetchInterval: 30_000,
  })

  const rows = (activityQuery.data ?? []).filter(
    (row) => source === "all" || row.source === source,
  )

  return (
    <div className="min-h-full bg-muted/20 p-4 sm:p-6">
      <PageHeader
        eyebrow="Raporlar"
        title="Sipariş Hareketleri"
        description="Hangi sipariş ne zaman, hangi kanaldan ve kim tarafından girildi. Saate tıklayarak sipariş detayına gidin."
        icon={ScrollText}
      />

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border bg-card p-3">
        <div className="space-y-1">
          <label
            htmlFor="activity-from"
            className="block text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
          >
            Başlangıç
          </label>
          <input
            id="activity-from"
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            className="h-9 rounded-xl border bg-background px-2.5 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor="activity-to"
            className="block text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
          >
            Bitiş
          </label>
          <input
            id="activity-to"
            type="date"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
            className="h-9 rounded-xl border bg-background px-2.5 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                setFrom(preset.from())
                setTo(preset.to())
              }}
              className="h-9 rounded-xl border bg-muted/60 px-3 text-xs font-semibold hover:bg-muted"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {SOURCE_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setSource(filter.value)}
            className={cn(
              "h-8 rounded-lg border px-3 text-xs font-semibold transition-colors",
              source === filter.value
                ? "border-primary bg-primary/10"
                : "border-transparent bg-muted/70 text-muted-foreground hover:bg-muted",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {activityQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className="h-14 animate-pulse rounded-xl border bg-card"
              aria-hidden="true"
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Kayıt yok"
          description="Bu filtreye uyan sipariş bulunamadı."
          icon={ScrollText}
        />
      ) : (
        // Wide table scrolls inside its own box so the page never shifts.
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr className="text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Saat</th>
                <th className="px-3 py-2 font-semibold">Kanal</th>
                <th className="px-3 py-2 font-semibold">Masa / Müşteri</th>
                <th className="px-3 py-2 font-semibold">Giren</th>
                <th className="px-3 py-2 font-semibold">Sadakat</th>
                <th className="px-3 py-2 font-semibold">Durum</th>
                <th className="px-3 py-2 text-right font-semibold">Tutar</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.order_id} className="hover:bg-muted/30">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                    <Link
                      href={`/admin/orders?order=${row.order_id}`}
                      className="underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {time.format(new Date(row.created_at))}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-medium">
                      {SOURCE_LABELS[row.source] ?? row.source}
                    </span>
                    {row.delivery_channel ? (
                      <span className="ml-1.5 rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] font-semibold">
                        {CHANNEL_LABELS[row.delivery_channel] ??
                          row.delivery_channel}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {row.table_name ?? row.customer_name ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.staff_name ?? (
                      // QR orders have no operator; saying so beats a blank.
                      <span className="text-muted-foreground">
                        Müşteri (QR)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.member_code ? (
                      <span className="rounded-md bg-brand-soft px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold text-brand">
                        {row.member_code}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {STATUS_LABELS[row.status] ?? row.status}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {money.format(Number(row.total))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
