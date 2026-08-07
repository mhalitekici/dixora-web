import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { QrBrandIntro } from "@/components/qr/qr-brand-intro"

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

function renderIntro() {
  return render(
    <QrBrandIntro
      businessSlug="dixora-lab"
      branchSlug="merkez"
      logoUrl="/logo.png"
      primaryColor="#ec5a20"
    />,
  )
}

describe("QrBrandIntro", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockReducedMotion(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("is visible on its first render, leaves at 850ms, and unmounts at 1150ms", () => {
    const { container } = renderIntro()
    const intro = container.querySelector("[data-qr-brand-intro]")

    expect(intro).toBeVisible()
    expect(intro).toHaveStyle({ opacity: "1" })

    act(() => vi.advanceTimersByTime(850))
    expect(intro).toHaveStyle({ opacity: "0" })

    act(() => vi.advanceTimersByTime(300))
    expect(container.querySelector("[data-qr-brand-intro]")).toBeNull()
  })

  it("shows only once for the same business and branch in a session", () => {
    const first = renderIntro()
    expect(first.container.querySelector("[data-qr-brand-intro]")).toBeVisible()
    expect(
      window.sessionStorage.getItem("dixora:qr-intro:dixora-lab:merkez"),
    ).toBe("shown")

    first.unmount()
    const second = renderIntro()
    expect(second.container.querySelector("[data-qr-brand-intro]")).toBeNull()
  })

  it("skips animation when reduced motion is requested", () => {
    mockReducedMotion(true)
    const { container } = renderIntro()

    expect(container.querySelector("[data-qr-brand-intro]")).toBeNull()
    expect(
      window.sessionStorage.getItem("dixora:qr-intro:dixora-lab:merkez"),
    ).toBe("shown")
  })
})
