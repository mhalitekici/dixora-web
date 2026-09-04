import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LandingFooter } from "@/components/marketing/landing/landing-footer"
import { LandingHeader } from "@/components/marketing/landing/landing-header"

vi.mock("next/image", () => ({
  default: () => null,
}))

describe("public entry links", () => {
  it("offers distinct business and waiter entries in the header", () => {
    render(<LandingHeader />)

    expect(
      screen.getByRole("link", { name: "İşletme girişi" }),
    ).toHaveAttribute("href", "/login")
    expect(
      screen.getByRole("link", { name: "Çalışan girişi" }),
    ).toHaveAttribute("href", "/login?mode=staff")
  })

  it("keeps both entry choices available in the footer", () => {
    render(<LandingFooter />)

    expect(
      screen.getByRole("link", { name: "İşletme girişi" }),
    ).toHaveAttribute("href", "/login")
    expect(
      screen.getByRole("link", { name: "Çalışan girişi" }),
    ).toHaveAttribute("href", "/login?mode=staff")
  })
})
