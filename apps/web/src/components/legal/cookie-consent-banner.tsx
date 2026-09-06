"use client"

import { useSyncExternalStore } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { useCookieConsentStore } from "@/stores/cookie-consent-store"

const noopSubscribe = () => () => {}

/**
 * True only once this component has hydrated on the client.
 *
 * The store reads localStorage at creation time, which runs during SSR too
 * (where there is no localStorage) — the server always sees "no decision".
 * Rendering the banner unconditionally would flash it open on a returning
 * visitor for one frame before the real, already-decided state took over.
 * `useSyncExternalStore` gives an SSR-safe "have we mounted" boolean without
 * the render-then-setState-in-an-effect pattern that trips the
 * react-hooks/set-state-in-effect rule.
 */
function useHasMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )
}

/**
 * Non-modal notice shown once, before a choice has been recorded.
 *
 * Mounted only on public-facing surfaces (the landing page and the legal
 * pages) — see `CookieConsentMount` — never inside the authenticated app,
 * where a first-visit cookie notice has no place interrupting a shift.
 */
export function CookieConsentBanner() {
  const mounted = useHasMounted()
  const decision = useCookieConsentStore((state) => state.decision)
  const acceptAll = useCookieConsentStore((state) => state.acceptAll)
  const rejectNonEssential = useCookieConsentStore(
    (state) => state.rejectNonEssential,
  )
  const openPreferences = useCookieConsentStore((state) => state.openPreferences)

  return (
    <>
      {mounted && decision === null ? (
        <div
          role="region"
          aria-label="Çerez bildirimi"
          className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/98 p-4 shadow-[0_-4px_24px_rgb(0_0_0/0.08)] backdrop-blur-sm sm:p-5"
        >
          <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-muted-foreground">
              Hizmetin çalışması için zorunlu çerezleri her zaman kullanırız.
              Analitik ve pazarlama amaçlı çerezler ise yalnızca izin
              verdiğinizde etkinleşir. Ayrıntılar için{" "}
              <Link
                href="/cerez-politikasi"
                className="font-medium text-foreground underline underline-offset-2 hover:text-brand"
              >
                Çerez Politikası
              </Link>
              &apos;nı inceleyebilirsiniz.
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="outline" onClick={rejectNonEssential}>
                Reddet
              </Button>
              <Button variant="outline" onClick={openPreferences}>
                Tercihleri yönet
              </Button>
              <Button onClick={acceptAll}>Kabul et</Button>
            </div>
          </div>
        </div>
      ) : null}
      <CookiePreferencesDialog />
    </>
  )
}

/**
 * The detailed per-category panel, reachable from the banner and from the
 * "Çerez Tercihleri" link in the footer at any time afterwards.
 */
export function CookiePreferencesDialog() {
  const preferencesOpen = useCookieConsentStore((state) => state.preferencesOpen)
  const closePreferences = useCookieConsentStore((state) => state.closePreferences)
  const decision = useCookieConsentStore((state) => state.decision)
  const setCategory = useCookieConsentStore((state) => state.setCategory)

  return (
    <Dialog
      open={preferencesOpen}
      onOpenChange={(open) => {
        if (!open) closePreferences()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Çerez tercihleri</DialogTitle>
          <DialogDescription>
            Zorunlu çerezler her zaman etkindir. Aşağıdaki kategorileri
            dilediğiniz zaman açıp kapatabilirsiniz; değişiklikler hemen
            uygulanır.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <CategoryRow
            title="Zorunlu"
            description="Oturum açma ve temel güvenlik için gereklidir. Kapatılamaz."
            checked
            disabled
          />
          <CategoryRow
            title="Analitik"
            description="Şu anda kullanılmıyor; ileride eklenecek bir analitik araç için ayrılmıştır."
            checked={decision?.analytics ?? false}
            onCheckedChange={(value) => setCategory("analytics", value)}
          />
          <CategoryRow
            title="Pazarlama"
            description="Şu anda kullanılmıyor; ileride eklenecek bir pazarlama aracı için ayrılmıştır."
            checked={decision?.marketing ?? false}
            onCheckedChange={(value) => setCategory("marketing", value)}
          />
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Kapat</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CategoryRow({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string
  description: string
  checked: boolean
  disabled?: boolean
  onCheckedChange?: (value: boolean) => void
}) {
  const labelId = `cookie-category-${title.toLowerCase()}`
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border p-3">
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-medium text-foreground">
          {title}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        aria-labelledby={labelId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="mt-0.5 shrink-0"
      />
    </div>
  )
}
