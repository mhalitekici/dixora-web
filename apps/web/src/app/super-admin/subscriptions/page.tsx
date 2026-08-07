import type { Metadata } from "next"

import { SubscriptionsOverview } from "@/components/super-admin/secondary/subscriptions-overview"

export const metadata: Metadata = {
  title: "Abonelikler",
}

export default function SubscriptionsPage() {
  return <SubscriptionsOverview />
}
