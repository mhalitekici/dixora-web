import type { Metadata } from "next";

import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { PRIVACY_POLICY } from "@/components/legal/documents/privacy-policy";

export const metadata: Metadata = {
  title: "Gizlilik Politikası",
  description: "Dixora'nın işletme ve çalışan bilgilerini nasıl kullandığı.",
};

export default function PrivacyPolicyPage() {
  return <LegalPageShell document={PRIVACY_POLICY} />;
}
