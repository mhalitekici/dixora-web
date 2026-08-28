"use client"

import { useQuery } from "@tanstack/react-query"
import { CreditCard, Receipt, TriangleAlert } from "lucide-react"
import { useState } from "react"

import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type PlatformInvoice = {
  id: string
  tenant_id: string
  business_name: string
  business_slug: string
  number: string
  amount: string
  currency: string
  status: string
  period_start: string
  branch_count: number
  due_at: string | null
  paid_at: string | null
  attempt_count: number
  failure_reason: string | null
  has_card: boolean
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Taslak",
  ISSUED: "Ödeme bekliyor",
  PAID: "Ödendi",
  FAILED: "Ödenemedi",
  VOID: "İptal",
}

const FILTERS = [
  { value: "", label: "Tümü" },
  { value: "ISSUED", label: "Ödeme bekliyor" },
  { value: "FAILED", label: "Ödenemedi" },
  { value: "PAID", label: "Ödendi" },
]

const money = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
})

const month = new Intl.DateTimeFormat("tr-TR", { year: "numeric", month: "long" })

/**
 * What every business owes, for the platform operator.
 *
 * The column that matters most is whether a card exists at all: chasing a
 * business for a failed payment when they never added one wastes everybody's
 * time, and the two look identical without it.
 */
export function PlatformInvoices() {
  const [status, setStatus] = useState("")

  const invoicesQuery = useQuery({
    queryKey: ["platform", "invoices", status],
    queryFn: ({ signal }) =>
      api.get<PlatformInvoice[]>("businesses/invoices", {
        search: status ? { status } : {},
        signal,
      }),
    refetchInterval: 60_000,
  })

  const invoices = invoicesQuery.data ?? []
  const owed = invoices
    .filter((invoice) => invoice.status !== "PAID" && invoice.status !== "VOID")
    .reduce((sum, invoice) => sum + Number(invoice.amount), 0)
  const cardless = invoices.filter(
    (invoice) => !invoice.has_card && invoice.status !== "PAID",
  ).length

  return (
    <div className="min-h-full bg-muted/20 p-4 sm:p-6">
      <PageHeader
        eyebrow="Platform"
        title="Faturalar"
        description="İşletmelerin abonelik faturaları ve tahsilat durumu."
        icon={Receipt}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2">
          <span className="flex flex-col leading-tight">
            <span className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Tahsil edilecek
            </span>
            <span className="text-sm font-bold tabular-nums">
              {money.format(owed)}
            </span>
          </span>
          {cardless > 0 ? (
            <>
              <span className="h-7 w-px bg-border" aria-hidden="true" />
              <span className="flex flex-col leading-tight">
                <span className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Kartsız
                </span>
                <span className="text-sm font-bold tabular-nums text-amber-600">
                  {cardless}
                </span>
              </span>
            </>
          ) : null}
        </div>

        {FILTERS.map((filter) => (
          <button
            key={filter.label}
            type="button"
            onClick={() => setStatus(filter.value)}
            className={cn(
              "h-8 rounded-lg border px-3 text-xs font-semibold transition-colors",
              status === filter.value
                ? "border-primary bg-primary/10"
                : "border-transparent bg-muted/70 text-muted-foreground hover:bg-muted",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {invoicesQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-14 animate-pulse rounded-xl border bg-card"
              aria-hidden="true"
            />
          ))}
        </div>
      ) : invoices.length === 0 ? (
        <EmptyState
          title="Fatura yok"
          description="Bu filtreye uyan fatura bulunamadı."
          icon={Receipt}
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr className="text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">
                <th className="px-3 py-2 font-semibold">İşletme</th>
                <th className="px-3 py-2 font-semibold">Dönem</th>
                <th className="px-3 py-2 font-semibold">Şube</th>
                <th className="px-3 py-2 font-semibold">Durum</th>
                <th className="px-3 py-2 font-semibold">Kart</th>
                <th className="px-3 py-2 text-right font-semibold">Tutar</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <p className="font-medium">{invoice.business_name}</p>
                    <p className="text-[0.68rem] text-muted-foreground">
                      {invoice.number}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {month.format(new Date(invoice.period_start))}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{invoice.branch_count}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-lg px-2 py-1 text-[0.65rem] font-semibold",
                        invoice.status === "PAID"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : invoice.status === "FAILED"
                            ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {STATUS_LABELS[invoice.status] ?? invoice.status}
                    </span>
                    {invoice.failure_reason ? (
                      <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
                        {invoice.failure_reason}
                        {invoice.attempt_count > 1
                          ? ` (${invoice.attempt_count} deneme)`
                          : ""}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {invoice.has_card ? (
                      <span className="flex items-center gap-1 text-[0.7rem] text-muted-foreground">
                        <CreditCard className="size-3.5" aria-hidden="true" />
                        Kayıtlı
                      </span>
                    ) : (
                      // Never collectable until they add one — a different
                      // problem from a card that was declined.
                      <span className="flex items-center gap-1 text-[0.7rem] font-semibold text-amber-700 dark:text-amber-300">
                        <TriangleAlert className="size-3.5" aria-hidden="true" />
                        Kart yok
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {money.format(Number(invoice.amount))}
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
