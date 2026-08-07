import type { Metadata } from "next"

import { BusinessDetail } from "@/components/super-admin/secondary/business-detail"

export const metadata: Metadata = {
  title: "İşletme Ayrıntısı",
}

export default async function BusinessDetailPage({
  params,
}: {
  params: Promise<{ businessId: string }>
}) {
  const { businessId } = await params
  return <BusinessDetail businessId={businessId} />
}
