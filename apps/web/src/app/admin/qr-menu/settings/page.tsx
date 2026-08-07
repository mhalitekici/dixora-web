import type { Metadata } from "next"

import { QrSettings } from "@/components/qr/qr-settings"

export const metadata: Metadata = {
  title: "QR Menü Ayarları",
}

export default function QrMenuSettingsPage() {
  return <QrSettings />
}
