import type { Metadata } from "next"

import { AuditLogExplorer } from "@/components/super-admin/secondary/audit-log-explorer"

export const metadata: Metadata = {
  title: "Denetim Kayıtları",
}

export default function AuditLogsPage() {
  return <AuditLogExplorer />
}
