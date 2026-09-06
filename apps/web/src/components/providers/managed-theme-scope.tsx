"use client"

import { useEffect } from "react"

import {
  MANAGED_THEME_DATASET_KEY,
  MANAGED_THEME_STORAGE_KEY,
  type ManagedThemeMode,
  useManagedThemeStore,
} from "@/stores/managed-theme-store"

/**
 * Holds a business-pinned theme in force for as long as this subtree is mounted.
 *
 * The pre-paint script already put the right class on the page; this is what
 * stops next-themes from undoing it on mount, and what releases the pin again
 * when the user navigates back to a screen they control themselves.
 *
 * Rendering it with `mode` null is meaningful: it is how a screen says "nothing
 * pinned", clearing a stale pin rather than silently keeping it.
 *
 * @param persist  Remember the mode for the next load on this device. Only the
 *                 staff screens do: they learn their theme from the session, so
 *                 without it every cold start would flash. A guest's view of one
 *                 business's menu must not decide how this device renders the
 *                 next screen it opens.
 */
export function ManagedThemeScope({
  mode,
  persist = false,
}: {
  mode: ManagedThemeMode | null
  persist?: boolean
}) {
  const setMode = useManagedThemeStore((state) => state.setMode)

  useEffect(() => {
    setMode(mode)
    if (mode) {
      document.documentElement.dataset[MANAGED_THEME_DATASET_KEY] = mode
      if (persist) {
        try {
          // Read back by the pre-paint script on the next load, which is the
          // only way a screen that learns its theme from the session avoids a
          // flash on a device that has not seen it before.
          window.localStorage.setItem(MANAGED_THEME_STORAGE_KEY, mode)
        } catch {
          /* Private windows and blocked storage simply lose the head start. */
        }
      }
    }

    return () => {
      setMode(null)
      delete document.documentElement.dataset[MANAGED_THEME_DATASET_KEY]
    }
  }, [mode, persist, setMode])

  return null
}
