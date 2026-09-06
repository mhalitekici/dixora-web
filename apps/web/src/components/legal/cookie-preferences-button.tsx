"use client"

import { SlidersHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useCookieConsentStore } from "@/stores/cookie-consent-store"

/** Inline call-to-action for the Çerez Politikası page itself. */
export function CookiePreferencesButton({ className }: { className?: string }) {
  const openPreferences = useCookieConsentStore((state) => state.openPreferences)
  return (
    <Button variant="outline" onClick={openPreferences} className={className}>
      <SlidersHorizontal />
      Çerez tercihlerimi yönet
    </Button>
  )
}
