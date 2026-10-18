"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowRight, ReceiptText, RefreshCw } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import {
  dateTime,
  ErrorState,
  LoadingState,
  money,
  orderStatusText,
  toneForOrder,
} from "@/components/admin/admin-utils"
import type { OrderStatus } from "@/components/admin/types"
import { DataToolbar } from "@/components/shared/data-toolbar"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"

type ActiveOrder = {
  id: string
  table_id: string | null
  status: OrderStatus
  total: string
  currency: string
  created_at: string
}

export function WaiterOrderList() {
  const [search, setSearch] = useState("")
  const query = useQuery({
    queryKey: ["waiter", "active-orders"],
    queryFn: async ({ signal }) => {
      const [orders, tables] = await Promise.all([
        api.get<{ items: ActiveOrder[]; total: number }>("orders", {
          signal,
          search: { active_only: true, limit: 200 },
        }),
        api.get<Array<{ id: string; name: string }>>("tables", { signal }),
      ])
      return { ...orders, tables }
    },
    refetchInterval: 10_000,
  })
  const tables = new Map(
    (query.data?.tables ?? []).map((table) => [table.id, table.name]),
  )
  const name = (order: ActiveOrder) =>
    tables.get(order.table_id ?? "") ?? "Masasız sipariş"
  const term = search.trim().toLocaleLowerCase("tr")
  const orders = (query.data?.items ?? [])
    .filter((order) =>
      `${name(order)} ${orderStatusText[order.status]}`
        .toLocaleLowerCase("tr")
        .includes(term),
    )
    .toSorted(
      (a, b) =>
        Number(b.status === "BILL_REQUESTED") -
        Number(a.status === "BILL_REQUESTED"),
    )

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Açık Siparişler"
        description="Şubenizdeki açık hesapları izleyin. Hesap isteyen masalar ilk sırada görünür."
        icon={ReceiptText}
        actions={
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw aria-hidden="true" />
            Yenile
          </Button>
        }
      />
      <DataToolbar
        value={search}
        onValueChange={setSearch}
        placeholder="Masa veya sipariş durumu ara…"
        className="mb-4"
      />
      {query.isLoading ? (
        <LoadingState label="Açık siparişler yükleniyor…" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : orders.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/waiter/orders/${order.id}`}
                className="flex min-h-28 items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-brand focus-visible:outline-2 focus-visible:outline-ring"
              >
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{name(order)}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dateTime(order.created_at)}
                  </p>
                  <p className="mt-2 font-semibold tabular-nums">
                    {money(order.total, order.currency)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-3">
                  <StatusBadge tone={toneForOrder(order.status)}>
                    {orderStatusText[order.status]}
                  </StatusBadge>
                  <ArrowRight
                    className="size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={ReceiptText}
          title={term ? "Aramaya uygun sipariş yok" : "Açık sipariş yok"}
          description={
            term
              ? "Masa adını veya aramanızı değiştirin."
              : "Masadan alınan siparişler burada görünür."
          }
          action={
            <Button variant="outline" render={<Link href="/waiter/tables" />}>
              Masalara git
            </Button>
          }
        />
      )}
      {query.data && query.data.total > 200 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Son 200 açık sipariş gösteriliyor. Masalar ekranından diğer açık
          hesaplara ulaşabilirsiniz.
        </p>
      ) : null}
    </div>
  )
}
