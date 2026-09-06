import type { Metadata } from "next";

import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { CANCELLATION_REFUND_POLICY } from "@/components/legal/documents/cancellation-refund-policy";

export const metadata: Metadata = {
  title: "İptal ve İade Politikası",
  description:
    "Dixora abonelik iptali, iade koşulları ve deneme süresi kuralları.",
};

export default function CancellationRefundPolicyPage() {
  return <LegalPageShell document={CANCELLATION_REFUND_POLICY} />;
}
