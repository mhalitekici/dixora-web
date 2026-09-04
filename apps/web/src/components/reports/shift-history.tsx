"use client"

import { useQuery } from "@tanstack/react-query"
import { MonitorDot } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type Shift = {
  id: string
  user_display_name: string | null
  cashier_name: string | null
  status: string
  opening_cash: string
  closing_cash: string | null
  cash_sales: string
  card_sales: string
  total_sales: string
  cash_variance: string | null
  opened_at: string
  closed_at: string | null
  closing_note: string | null
}

const money = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
})

const stamp = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

function duration(from: string, to: string | null): string {
  const end = to ? new Date(to).getTime() : Date.now()
  const minutes = Math.max(0, Math.floor((end - new Date(from).getTime()) / 60_000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours > 0 ? `${hours}s ${rest}dk` : `${rest}dk`
}

/**
 * Closed and running tills, newest first.
 *
 * The records existed and the API served them, but only the cashier's own
 * screen ever read them — a manager had no way to see who held the drawer or
 * whether it balanced.
 */
export function ShiftHistory() {
  const shiftsQuery = useQuery({
    queryKey: ["shifts", "history"],
    queryFn: ({ signal }) =>
      api.get<Shift[]>("shifts/history", { search: { limit: 100 }, signal }),
    refetchInterval: 60_000,
  })

  const shifts = shiftsQuery.data ?? []

  return (
    <div className="min-h-full bg-muted/20 p-4 sm:p-6">
      <PageHeader
        eyebrow="Raporlar"
        title="Vardiya Kayıtları"
        description="Kasayı kim devraldı, ne kadar sattı, sayım tuttu mu."
        icon={MonitorDot}
      />

      {shiftsQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-20 animate-pulse rounded-2xl border bg-card"
              aria-hidden="true"
            />
          ))}
        </div>
      ) : shifts.length === 0 ? (
        <EmptyState
          title="Vardiya kaydı yok"
          description="Kasa açıldığında vardiyalar burada listelenir."
          icon={MonitorDot}
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {shifts.map((shift) => {
            const variance = shift.cash_variance
              ? Number(shift.cash_variance)
              : null
            const open = shift.status === "OPEN"
            return (
              <li
                key={shift.id}
                className={cn(
                  "rounded-2xl border bg-card p-4 shadow-sm",
                  open && "border-emerald-400/60",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">
                      {shift.cashier_name || shift.user_display_name || "Kasiyer"}
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {stamp.format(new Date(shift.opened_at))}
                      {" · "}
                      {duration(shift.opened_at, shift.closed_at)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-lg px-2 py-1 text-[0.65rem] font-semibold",
                      open
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {open ? "Açık" : "Kapandı"}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {(
                    [
                      ["Nakit", shift.cash_sales],
                      ["Kart", shift.card_sales],
                      ["Toplam", shift.total_sales],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-muted/50 p-2">
                      <dt className="text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        {label}
                      </dt>
                      <dd className="mt-0.5 text-sm font-bold tabular-nums">
                        {money.format(Number(value))}
                      </dd>
                    </div>
                  ))}
                </dl>

                {variance !== null ? (
                  <p
                    className={cn(
                      "mt-2.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold",
                      // Zero is the good case and gets no alarm colour; a gap
                      // in either direction is what a manager is looking for.
                      variance === 0
                        ? "bg-muted/50 text-muted-foreground"
                        : "bg-rose-500/10 text-rose-700 dark:text-rose-300",
                    )}
                  >
                    Kasa farkı: {variance > 0 ? "+" : ""}
                    {money.format(variance)}
                    {variance === 0 ? " (tuttu)" : ""}
                  </p>
                ) : null}

                {shift.closing_note ? (
                  <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-muted/40 px-2.5 py-1.5 text-xs leading-5 text-muted-foreground">
                    {shift.closing_note}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
