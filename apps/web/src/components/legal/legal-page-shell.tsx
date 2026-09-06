"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { CookieConsentBanner } from "@/components/legal/cookie-consent-banner";
import { LegalSections } from "@/components/legal/legal-sections";
import type { LegalDocument } from "@/components/legal/legal-document";
import { useCookieConsentStore } from "@/stores/cookie-consent-store";

/**
 * Standard reading page for a published legal document.
 *
 * Deliberately built with the app's ordinary theme tokens (`bg-background`,
 * `text-foreground`, …) rather than the landing page's own fixed "paper"
 * palette: these are reference pages someone may open in system dark mode
 * from a bookmark or a search result, not part of the marketing pitch.
 */
export function LegalPageShell({
  document: doc,
  afterHeading,
}: {
  document: LegalDocument;
  /** Extra content rendered just under the title — used by the cookie policy
   * page to surface a live "manage preferences" button inline, rather than
   * only in the footer. */
  afterHeading?: ReactNode;
}) {
  const openPreferences = useCookieConsentStore((state) => state.openPreferences);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" aria-label="Dixora ana sayfa">
            <BrandLogo />
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Ana sayfaya dön
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {doc.title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sürüm {doc.version} · Yürürlük tarihi: {doc.effectiveDate}
        </p>

        {afterHeading}

        <div className="mt-8 border-t pt-8">
          <LegalSections sections={doc.sections} />
        </div>
      </main>

      <footer className="border-t py-6">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-4 text-xs text-muted-foreground sm:px-6">
          <Link href="/uyelik-sozlesmesi" className="hover:text-foreground">
            Üyelik ve SaaS Hizmet Sözleşmesi
          </Link>
          <Link href="/kvkk-aydinlatma-metni" className="hover:text-foreground">
            KVKK Aydınlatma Metni
          </Link>
          <Link href="/gizlilik-politikasi" className="hover:text-foreground">
            Gizlilik Politikası
          </Link>
          <Link href="/cerez-politikasi" className="hover:text-foreground">
            Çerez Politikası
          </Link>
          <Link href="/iptal-iade-politikasi" className="hover:text-foreground">
            İptal ve İade Politikası
          </Link>
          <button
            type="button"
            onClick={openPreferences}
            className="hover:text-foreground"
          >
            Çerez Tercihleri
          </button>
        </div>
      </footer>
      <CookieConsentBanner />
    </div>
  );
}
