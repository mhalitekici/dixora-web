import type { Metadata } from "next";

import { ModifierManagement } from "@/components/catalog/modifier-management";

export const metadata: Metadata = { title: "Modifiyerler" };

export default function ModifiersPage() {
  return <ModifierManagement />;
}
