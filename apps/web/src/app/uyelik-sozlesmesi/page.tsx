import type { Metadata } from "next";

import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { MEMBERSHIP_AGREEMENT } from "@/components/marketing/membership-agreement";

export const metadata: Metadata = {
  title: "Üyelik ve SaaS Hizmet Sözleşmesi",
  description:
    "Dixora Üyelik ve SaaS Hizmet Sözleşmesi'nin güncel ve tam metni.",
};

export default function MembershipAgreementPage() {
  return <LegalPageShell document={MEMBERSHIP_AGREEMENT} />;
}
