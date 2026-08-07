import type { Metadata } from "next";

import { TableManagement } from "@/components/tables/table-management";

export const metadata: Metadata = {
  title: "Masalar",
  description: "Dixora alan ve canlı masa yönetimi.",
};

export default function TablesPage() {
  return <TableManagement />;
}
