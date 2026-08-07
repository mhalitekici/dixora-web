import type { Metadata } from "next"

import { PublicMenu } from "@/components/qr/public-menu"

export const metadata: Metadata = {
  title: "Dijital Menü",
  description: "Güncel ürünleri ve menü kategorilerini görüntüleyin.",
}

interface PublicMenuPageProps {
  params: Promise<{
    businessSlug: string
    branchSlug: string
  }>
  searchParams: Promise<{
    table_token?: string | string[]
    table?: string | string[]
  }>
}

export default async function PublicMenuPage({
  params,
  searchParams,
}: PublicMenuPageProps) {
  const { businessSlug, branchSlug } = await params
  const query = await searchParams
  const rawToken = query.table_token ?? query.table
  const tableToken = Array.isArray(rawToken) ? rawToken[0] : rawToken

  return (
    <PublicMenu
      businessSlug={businessSlug}
      branchSlug={branchSlug}
      tableToken={tableToken ?? null}
    />
  )
}
