import type { Metadata } from "next";

import { PrinterManagement } from "@/components/admin/printer-management";

export const metadata: Metadata = { title: "Yazıcılar" };

export default function AdminPrintersPage() {
  return <PrinterManagement />;
}
