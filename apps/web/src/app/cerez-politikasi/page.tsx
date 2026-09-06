import type { Metadata } from "next";

import { CookiePreferencesButton } from "@/components/legal/cookie-preferences-button";
import { COOKIE_POLICY } from "@/components/legal/documents/cookie-policy";
import { LegalPageShell } from "@/components/legal/legal-page-shell";

export const metadata: Metadata = {
  title: "Çerez Politikası",
  description:
    "Dixora'nın kullandığı çerezler, tarayıcı depolama kayıtları ve tercihlerinizi yönetme yöntemleri.",
};

export default function CookiePolicyPage() {
  return (
    <LegalPageShell
      document={COOKIE_POLICY}
      afterHeading={<CookiePreferencesButton className="mt-4" />}
    />
  );
}
