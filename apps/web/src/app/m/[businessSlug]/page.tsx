import type { Metadata } from "next";

import { BranchSelector } from "@/components/qr/branch-selector";

type PageProps = {
  params: Promise<{ businessSlug: string }>;
};

export const metadata: Metadata = {
  title: "Şube seçimi · Dixora QR Menü",
  description: "Dixora QR Menü ile işletmenin güncel menüsünü görüntüleyin.",
};

export default async function Page({ params }: PageProps) {
  const { businessSlug } = await params;
  return <BranchSelector businessSlug={businessSlug} />;
}

