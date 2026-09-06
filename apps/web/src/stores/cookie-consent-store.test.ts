import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { hasConsent, useCookieConsentStore } from "@/stores/cookie-consent-store"

function reset() {
  window.localStorage.clear()
  useCookieConsentStore.setState({ decision: null, preferencesOpen: false })
}

beforeEach(reset)
afterEach(reset)

describe("cookie consent store", () => {
  it("shows no decision until the visitor makes one", () => {
    expect(useCookieConsentStore.getState().decision).toBeNull()
    expect(hasConsent("analytics")).toBe(false)
    expect(hasConsent("marketing")).toBe(false)
  })

  it("rejecting really disables every optional category", () => {
    useCookieConsentStore.getState().rejectNonEssential()

    const decision = useCookieConsentStore.getState().decision
    expect(decision?.analytics).toBe(false)
    expect(decision?.marketing).toBe(false)
    expect(hasConsent("analytics")).toBe(false)
    expect(hasConsent("marketing")).toBe(false)
  })

  it("accepting really enables every optional category", () => {
    useCookieConsentStore.getState().acceptAll()

    const decision = useCookieConsentStore.getState().decision
    expect(decision?.analytics).toBe(true)
    expect(decision?.marketing).toBe(true)
    expect(hasConsent("analytics")).toBe(true)
    expect(hasConsent("marketing")).toBe(true)
  })

  it("lets each category be toggled independently", () => {
    useCookieConsentStore.getState().rejectNonEssential()
    useCookieConsentStore.getState().setCategory("analytics", true)

    expect(hasConsent("analytics")).toBe(true)
    expect(hasConsent("marketing")).toBe(false)
  })

  it("persists the decision so a reload does not ask again", () => {
    useCookieConsentStore.getState().acceptAll()

    // Simulate a fresh page load: a brand-new store instance reading from the
    // same localStorage the first one wrote to.
    const stored = window.localStorage.getItem("dixora.cookie-consent")
    expect(stored).toBeTruthy()
    const parsed = JSON.parse(stored!)
    expect(parsed.analytics).toBe(true)
    expect(parsed.marketing).toBe(true)
  })

  it("opens and closes the preferences panel", () => {
    useCookieConsentStore.getState().openPreferences()
    expect(useCookieConsentStore.getState().preferencesOpen).toBe(true)

    useCookieConsentStore.getState().closePreferences()
    expect(useCookieConsentStore.getState().preferencesOpen).toBe(false)
  })
})
