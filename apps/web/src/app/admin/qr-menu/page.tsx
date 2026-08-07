import type { Metadata } from "next"

import { QrOverview } from "@/components/qr/qr-overview"

export const metadata: Metadata = {
  title: "QR Menü",
  description: "QR menü yayınını, kodları ve müşteri taleplerini yönetin.",
}

export default function QrMenuPage() {
  return <QrOverview />
}
