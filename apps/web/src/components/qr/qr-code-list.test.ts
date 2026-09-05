import { describe, expect, it } from "vitest"

import { buildMenuUrl, resolveAppUrl } from "@/components/qr/qr-code-list"

describe("resolveAppUrl", () => {
  it("uses the configured production origin", () => {
    expect(resolveAppUrl("https://dixoratech.com")).toBe(
      "https://dixoratech.com",
    )
  })

  it("falls back to localhost for development", () => {
    // `next dev` has no build step to inline a value, and the fallback is what
    // keeps a local QR code openable.
    expect(resolveAppUrl(undefined)).toBe("http://localhost:3000")
  })

  it("treats an empty value as absent", () => {
    // Compose renders an unset variable as an empty string; keeping it would
    // build a scheme-less "/m/..." link that no phone camera can open.
    expect(resolveAppUrl("")).toBe("http://localhost:3000")
  })

  it("drops trailing slashes so the path is not doubled", () => {
    expect(resolveAppUrl("https://dixoratech.com/")).toBe(
      "https://dixoratech.com",
    )
    expect(resolveAppUrl("https://dixoratech.com///")).toBe(
      "https://dixoratech.com",
    )
  })
})

describe("buildMenuUrl", () => {
  const appUrl = resolveAppUrl("https://dixoratech.com")

  it("prints the public origin onto a table code, not localhost", () => {
    const url = buildMenuUrl(
      appUrl,
      "aleyin-mutfagi",
      "merkez",
      "tkn_abc123",
    )

    expect(url).toBe(
      "https://dixoratech.com/m/aleyin-mutfagi/merkez/table/tkn_abc123",
    )
    expect(url).not.toContain("localhost")
  })

  it("builds the branch-level code without a table segment", () => {
    expect(buildMenuUrl(appUrl, "aleyin-mutfagi", "merkez", null)).toBe(
      "https://dixoratech.com/m/aleyin-mutfagi/merkez",
    )
  })

  it("escapes slugs and tokens into the path", () => {
    expect(buildMenuUrl(appUrl, " kebap evi ", " şube ", "a/b")).toBe(
      "https://dixoratech.com/m/kebap%20evi/%C5%9Fube/table/a%2Fb",
    )
  })

  it("still points at localhost when nothing is configured", () => {
    expect(
      buildMenuUrl(resolveAppUrl(undefined), "demo", "merkez", null),
    ).toBe("http://localhost:3000/m/demo/merkez")
  })
})
