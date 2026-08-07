import type { Metadata } from "next"

import { PublicMenu } from "@/components/qr/public-menu"

export const metadata: Metadata = {
  title: "Masa Menüsü",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
}

interface TableMenuPageProps {
  params: Promise<{
    businessSlug: string
    branchSlug: string
    tableToken: string
  }>
}

export default async function TableMenuPage({ params }: TableMenuPageProps) {
  const { businessSlug, branchSlug, tableToken } = await params
  return (
    <PublicMenu
      businessSlug={businessSlug}
      branchSlug={branchSlug}
      tableToken={tableToken}
    />
  )
}
