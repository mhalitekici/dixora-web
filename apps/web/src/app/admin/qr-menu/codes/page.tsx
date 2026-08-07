import type { Metadata } from "next"

import { QrCodeList } from "@/components/qr/qr-code-list"

export const metadata: Metadata = {
  title: "QR Kodları",
}

export default function QrMenuCodesPage() {
  return <QrCodeList />
}
