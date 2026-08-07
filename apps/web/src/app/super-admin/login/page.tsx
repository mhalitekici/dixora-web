import type { Metadata } from "next";

import { LoginPanel } from "@/components/auth/login-panel";

export const metadata: Metadata = {
  title: "Platform Girişi",
  description: "Dixora Super Admin güvenli erişimi.",
  robots: { index: false, follow: false },
};

export default async function SuperAdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  return <LoginPanel superAdmin returnTo={returnTo} />;
}
