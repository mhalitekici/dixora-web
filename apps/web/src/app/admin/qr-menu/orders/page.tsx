import type { Metadata } from "next"

import { QrRequestList } from "@/components/qr/qr-request-list"

export const metadata: Metadata = {
  title: "QR Müşteri Talepleri",
}

export default function QrMenuOrdersPage() {
  return <QrRequestList />
}
