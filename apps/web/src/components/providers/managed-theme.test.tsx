import { render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ManagedThemeBootstrap } from "@/components/providers/managed-theme"
import { ManagedThemeScope } from "@/components/providers/managed-theme-scope"
import { ThemeProvider } from "@/components/providers/theme-provider"
import {
  forcedThemeFor,
  MANAGED_THEME_STORAGE_KEY,
  useManagedThemeStore,
} from "@/stores/managed-theme-store"

/**
 * Runs the pre-paint script the way the browser would, so these tests exercise
 * the real serialised source rather than a re-implementation of it.
 */
function runBootstrap(element: HTMLElement) {
  const script = element.querySelector("script")
  expect(script).not.toBeNull()
  new Function(script!.innerHTML)()
}

function reset() {
  document.documentElement.className = ""
  document.documentElement.style.colorScheme = ""
  delete document.documentElement.dataset.dixoraManagedTheme
  window.localStorage.clear()
  useManagedThemeStore.setState({ mode: null })
}

beforeEach(reset)
afterEach(reset)

describe("ManagedThemeBootstrap", () => {
  it("paints a pinned dark theme before React ever runs", () => {
    const { container } = render(<ManagedThemeBootstrap mode="DARK" />)
    runBootstrap(container)

    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe("dark")
  })

  it("paints a pinned light theme even on a dark-mode device", () => {
    // The whole point of the feature: the phone's preference must not win.
    const { container } = render(<ManagedThemeBootstrap mode="LIGHT" />)
    runBootstrap(container)

    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(document.documentElement.classList.contains("light")).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe("light")
  })

  it("leaves SYSTEM to next-themes rather than fighting it for the class", () => {
    const { container } = render(<ManagedThemeBootstrap mode="SYSTEM" />)
    runBootstrap(container)

    expect(document.documentElement.className).toBe("")
    expect(document.documentElement.style.colorScheme).toBe("")
  })

  it("records what it applied, so the first client render agrees with it", () => {
    const { container } = render(<ManagedThemeBootstrap mode="DARK" />)
    runBootstrap(container)

    expect(document.documentElement.dataset.dixoraManagedTheme).toBe("DARK")
  })

  it("falls back to this device's last staff theme when asked to", () => {
    window.localStorage.setItem(MANAGED_THEME_STORAGE_KEY, "DARK")
    const { container } = render(<ManagedThemeBootstrap useStored />)
    runBootstrap(container)

    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("never lets a stored staff theme leak into a guest's menu", () => {
    // The public menu passes no `useStored`: a waiter's dark panel on this phone
    // must not decide how somebody else's QR menu renders.
    window.localStorage.setItem(MANAGED_THEME_STORAGE_KEY, "DARK")
    const { container } = render(<ManagedThemeBootstrap />)
    runBootstrap(container)

    expect(document.documentElement.className).toBe("")
  })

  it("prefers the server's answer over anything stored on the device", () => {
    window.localStorage.setItem(MANAGED_THEME_STORAGE_KEY, "DARK")
    const { container } = render(
      <ManagedThemeBootstrap mode="LIGHT" useStored />,
    )
    runBootstrap(container)

    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("ignores a storage value that is not one of the modes", () => {
    window.localStorage.setItem(MANAGED_THEME_STORAGE_KEY, "neon")
    const { container } = render(<ManagedThemeBootstrap useStored />)
    runBootstrap(container)

    expect(document.documentElement.className).toBe("")
  })
})

describe("ManagedThemeScope", () => {
  it("pins the mode so next-themes stops following the device", () => {
    render(<ManagedThemeScope mode="LIGHT" />)
    expect(useManagedThemeStore.getState().mode).toBe("LIGHT")
  })

  it("releases the pin when the screen is left", () => {
    // Navigating from the waiter panel to the back office must hand the theme
    // back to whatever that user chose for themselves.
    const { unmount } = render(<ManagedThemeScope mode="DARK" />)
    unmount()

    expect(useManagedThemeStore.getState().mode).toBeNull()
    expect(document.documentElement.dataset.dixoraManagedTheme).toBeUndefined()
  })

  it("remembers the staff theme for the next load on this device", () => {
    render(<ManagedThemeScope mode="DARK" persist />)
    expect(window.localStorage.getItem(MANAGED_THEME_STORAGE_KEY)).toBe("DARK")
  })

  it("does not remember a theme it was not asked to remember", () => {
    render(<ManagedThemeScope mode="DARK" />)
    expect(window.localStorage.getItem(MANAGED_THEME_STORAGE_KEY)).toBeNull()
  })
})

describe("the pinned theme against next-themes", () => {
  /** jsdom has no media queries; next-themes reads one on mount. */
  function stubDeviceTheme(prefersDark: boolean) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((media: string) => ({
        matches: prefersDark,
        media,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )
  }

  it("outranks a theme the user chose earlier on this device", async () => {
    stubDeviceTheme(true)
    // A waiter who once set dark mode in the back office keeps that preference
    // in localStorage. On a screen the business pins to light, it must not win.
    window.localStorage.setItem("theme", "dark")

    render(
      <ThemeProvider forcedTheme={forcedThemeFor("LIGHT")}>
        <span>menu</span>
      </ThemeProvider>,
    )

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false)
    })
    expect(document.documentElement.classList.contains("light")).toBe(true)
  })

  it("hands the theme back once nothing is pinned", async () => {
    stubDeviceTheme(true)
    window.localStorage.setItem("theme", "dark")

    render(
      <ThemeProvider forcedTheme={forcedThemeFor(null)}>
        <span>dashboard</span>
      </ThemeProvider>,
    )

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true)
    })
  })
})
