import type { Metadata } from "next";
import { Suspense } from "react";

import { BusinessManagement } from "@/components/super-admin/business-management";

export const metadata: Metadata = { title: "İşletmeler" };

export default function BusinessesPage() {
  return (
    <Suspense>
      <BusinessManagement />
    </Suspense>
  );
}
