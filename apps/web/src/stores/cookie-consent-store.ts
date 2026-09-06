import { create } from "zustand"

/**
 * Real, working consent state for the public site's optional cookie/tracking
 * categories.
 *
 * "Zorunlu" (essential) is not represented here as a toggle — it is always on
 * and cannot be disabled, matching the strictly-necessary auth cookies that
 * already exist regardless of this store. The two categories below currently
 * gate nothing (there is no analytics or marketing script in this codebase
 * yet — see Çerez Politikası), but the state is genuine: "Reddet" really sets
 * both to false, "Kabul Et" really sets both to true, and whoever adds the
 * first analytics loader in the future reads `hasConsent("analytics")` before
 * injecting it rather than building a second consent mechanism.
 */
export type CookieCategory = "analytics" | "marketing"

export interface CookieConsentDecision {
  analytics: boolean
  marketing: boolean
  /** When the decision was made, for support/audit purposes only — never sent anywhere. */
  decidedAt: string
}

const STORAGE_KEY = "dixora.cookie-consent"

interface CookieConsentState {
  /** Null until the visitor has made a choice — the banner shows exactly then. */
  decision: CookieConsentDecision | null
  preferencesOpen: boolean
  acceptAll: () => void
  rejectNonEssential: () => void
  setCategory: (category: CookieCategory, value: boolean) => void
  openPreferences: () => void
  closePreferences: () => void
}

function readStoredDecision(): CookieConsentDecision | null {
  if (typeof window === "undefined") {
    return null
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as CookieConsentDecision).analytics === "boolean" &&
      typeof (parsed as CookieConsentDecision).marketing === "boolean"
    ) {
      return parsed as CookieConsentDecision
    }
    return null
  } catch {
    return null
  }
}

function persist(decision: CookieConsentDecision | null) {
  try {
    if (decision) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(decision))
    } else {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    /* A private window or blocked storage just means the choice is asked again next visit. */
  }
}

export const useCookieConsentStore = create<CookieConsentState>((set, get) => ({
  decision: readStoredDecision(),
  preferencesOpen: false,
  acceptAll: () => {
    const decision: CookieConsentDecision = {
      analytics: true,
      marketing: true,
      decidedAt: new Date().toISOString(),
    }
    persist(decision)
    set({ decision, preferencesOpen: false })
  },
  rejectNonEssential: () => {
    const decision: CookieConsentDecision = {
      analytics: false,
      marketing: false,
      decidedAt: new Date().toISOString(),
    }
    persist(decision)
    set({ decision, preferencesOpen: false })
  },
  setCategory: (category, value) => {
    const current = get().decision ?? {
      analytics: false,
      marketing: false,
      decidedAt: new Date().toISOString(),
    }
    const decision: CookieConsentDecision = {
      ...current,
      [category]: value,
      decidedAt: new Date().toISOString(),
    }
    persist(decision)
    set({ decision })
  },
  openPreferences: () => set({ preferencesOpen: true }),
  closePreferences: () => set({ preferencesOpen: false }),
}))

/** Whether a given optional category is currently allowed. Essential is always true. */
export function hasConsent(category: CookieCategory): boolean {
  return useCookieConsentStore.getState().decision?.[category] === true
}
