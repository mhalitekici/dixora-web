import { create } from "zustand"

/**
 * The colour scheme a business pins for its guest and staff screens.
 *
 * Mirrors the API's `theme_mode`. SYSTEM means "leave it to the device", which
 * is what every screen did before businesses could choose.
 */
export type ManagedThemeMode = "LIGHT" | "DARK" | "SYSTEM"

/**
 * Where the pre-paint script leaves the mode it applied.
 *
 * Read back synchronously below so the very first client render already knows
 * which theme is in force. Without that the provider would mount with no forced
 * theme, next-themes would re-apply the device preference, and a pinned-light
 * menu would flash dark on a dark-mode phone.
 */
export const MANAGED_THEME_DATASET_KEY = "dixoraManagedTheme"

/** Remembers the staff theme between loads, so returning never flashes. */
export const MANAGED_THEME_STORAGE_KEY = "dixora.managed-theme"

const MODES: readonly string[] = ["LIGHT", "DARK", "SYSTEM"]

export function asManagedThemeMode(value: unknown): ManagedThemeMode | null {
  return typeof value === "string" && MODES.includes(value)
    ? (value as ManagedThemeMode)
    : null
}

interface ManagedThemeState {
  /** Null on the back-office, where each user keeps their own preference. */
  mode: ManagedThemeMode | null
  setMode: (mode: ManagedThemeMode | null) => void
}

function initialMode(): ManagedThemeMode | null {
  if (typeof document === "undefined") {
    return null
  }
  return asManagedThemeMode(document.documentElement.dataset[MANAGED_THEME_DATASET_KEY])
}

export const useManagedThemeStore = create<ManagedThemeState>((set) => ({
  mode: initialMode(),
  setMode: (mode) => set({ mode }),
}))

/**
 * The theme to force on next-themes, or undefined to let it decide.
 *
 * SYSTEM deliberately forces nothing: next-themes already defaults to the
 * device preference, so handing control back to it is exactly the behaviour
 * asked for — and it keeps following the device if the phone switches while the
 * page is open, which a value frozen at render time could not do.
 */
export function forcedThemeFor(
  mode: ManagedThemeMode | null,
): "light" | "dark" | undefined {
  if (mode === "LIGHT") return "light"
  if (mode === "DARK") return "dark"
  return undefined
}
