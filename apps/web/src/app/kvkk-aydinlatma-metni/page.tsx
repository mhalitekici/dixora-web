import type { Metadata } from "next";

import { KVKK_NOTICE } from "@/components/legal/documents/kvkk-notice";
import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { LegalPlaceholderNotice } from "@/components/legal/legal-placeholder-notice";

export const metadata: Metadata = {
  title: "KVKK Aydınlatma Metni",
  description:
    "6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında Dixora aydınlatma metni.",
};

export default function KvkkNoticePage() {
  return (
    <LegalPageShell
      document={KVKK_NOTICE}
      afterHeading={<LegalPlaceholderNotice className="mt-4" />}
    />
  );
}
