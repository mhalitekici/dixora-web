import { describe, expect, it } from "vitest"

import {
  asManagedThemeMode,
  forcedThemeFor,
} from "@/stores/managed-theme-store"

describe("asManagedThemeMode", () => {
  it("accepts the three modes the API can send", () => {
    expect(asManagedThemeMode("LIGHT")).toBe("LIGHT")
    expect(asManagedThemeMode("DARK")).toBe("DARK")
    expect(asManagedThemeMode("SYSTEM")).toBe("SYSTEM")
  })

  it("refuses anything else rather than passing it through", () => {
    // The value reaches us from an API response and from localStorage, neither
    // of which is guaranteed to hold what we last wrote.
    expect(asManagedThemeMode("light")).toBeNull()
    expect(asManagedThemeMode("NEON")).toBeNull()
    expect(asManagedThemeMode(undefined)).toBeNull()
    expect(asManagedThemeMode(null)).toBeNull()
    expect(asManagedThemeMode(3)).toBeNull()
  })
})

describe("forcedThemeFor", () => {
  it("overrides the device when the business pinned a theme", () => {
    expect(forcedThemeFor("LIGHT")).toBe("light")
    expect(forcedThemeFor("DARK")).toBe("dark")
  })

  it("forces nothing on SYSTEM, so next-themes keeps following the device", () => {
    // Forcing a resolved value here would freeze the theme at render time and
    // stop the page reacting when the phone switches to dark mode.
    expect(forcedThemeFor("SYSTEM")).toBeUndefined()
  })

  it("forces nothing where no business decides the look", () => {
    expect(forcedThemeFor(null)).toBeUndefined()
  })
})
