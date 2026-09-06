import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LegalPageShell } from "@/components/legal/legal-page-shell"
import type { LegalDocument } from "@/components/legal/legal-document"

const doc: LegalDocument = {
  title: "Test Belgesi",
  version: "2026-01-01-v1",
  effectiveDate: "1 Ocak 2026",
  sections: [
    {
      heading: "1. Madde",
      paragraphs: ["Bu bir test paragrafıdır."],
      list: ["Birinci madde", "İkinci madde"],
    },
  ],
}

describe("LegalPageShell", () => {
  it("renders the document title, version and content", () => {
    render(<LegalPageShell document={doc} />)

    expect(screen.getByRole("heading", { name: "Test Belgesi", level: 1 })).toBeVisible()
    expect(screen.getByText(/Sürüm 2026-01-01-v1/)).toBeVisible()
    expect(screen.getByText("Bu bir test paragrafıdır.")).toBeVisible()
    expect(screen.getByText("Birinci madde")).toBeVisible()
  })

  it("links back to every other published legal document", () => {
    render(<LegalPageShell document={doc} />)
    // Scoped to the page's own footer: the cookie banner rendered alongside
    // it also mentions "Çerez Politikası" inline, which would otherwise match
    // twice.
    const footer = within(screen.getByRole("contentinfo"))

    const expectedLinks: Record<string, string> = {
      "Üyelik ve SaaS Hizmet Sözleşmesi": "/uyelik-sozlesmesi",
      "KVKK Aydınlatma Metni": "/kvkk-aydinlatma-metni",
      "Gizlilik Politikası": "/gizlilik-politikasi",
      "Çerez Politikası": "/cerez-politikasi",
      "İptal ve İade Politikası": "/iptal-iade-politikasi",
    }
    for (const [name, href] of Object.entries(expectedLinks)) {
      expect(footer.getByRole("link", { name })).toHaveAttribute("href", href)
    }
  })

  it("offers a way back to the home page", () => {
    render(<LegalPageShell document={doc} />)

    expect(
      screen.getAllByRole("link", { name: /ana sayfa/i })[0],
    ).toHaveAttribute("href", "/")
  })

  it("exposes a working cookie preferences control", async () => {
    render(<LegalPageShell document={doc} />)

    expect(
      screen.getByRole("button", { name: "Çerez Tercihleri" }),
    ).toBeVisible()
  })
})
