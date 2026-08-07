import type { Metadata } from "next"

import { SystemHealth } from "@/components/super-admin/secondary/system-health"

export const metadata: Metadata = {
  title: "Sistem Sağlığı",
}

export default function SystemHealthPage() {
  return <SystemHealth />
}
