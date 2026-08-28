"use client"

import { useQuery } from "@tanstack/react-query"

import { deliveryApi, deliveryKeys } from "@/components/delivery/delivery-api"

/**
 * Count of package orders still waiting to be accepted.
 *
 * The till is usually on the tables screen, so a new phone or platform order
 * would otherwise sit unseen until someone thought to look.
 */
export function NewDeliveryBadge() {
  const countsQuery = useQuery({
    queryKey: deliveryKeys.counts(),
    queryFn: ({ signal }) => deliveryApi.counts(signal),
    refetchInterval: 15_000,
  })

  const waiting = countsQuery.data?.new ?? 0
  if (waiting <= 0) return null

  return (
    <span
      // Announced rather than colour-only: "3" on its own means nothing to a
      // screen reader, or to anyone glancing at the bar.
      aria-label={`${waiting} yeni paket sipariş bekliyor`}
      className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[0.65rem] font-bold leading-5 text-destructive-foreground"
    >
      {waiting > 99 ? "99+" : waiting}
    </span>
  )
}
