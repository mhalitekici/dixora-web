import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn<
    (name: string, value: string, options: Record<string, unknown>) => void
  >(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  cookies: async () => mocks,
}))

import {
  clearLoyaltyToken,
  LOYALTY_TOKEN_COOKIE,
  loyaltyTokenCookieName,
  readLoyaltyToken,
  setLoyaltyToken,
} from "@/lib/server/loyalty-cookie"

describe("public loyalty cookie policy", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_COOKIE_SECURE", "true")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("stores only an HttpOnly first-party membership token", async () => {
    vi.stubEnv("AUTH_COOKIE_DOMAIN", ".dixorapos.com")

    await setLoyaltyToken("lm_random-token")

    expect(mocks.set).toHaveBeenCalledWith(
      LOYALTY_TOKEN_COOKIE,
      "lm_random-token",
      expect.objectContaining({
        domain: ".dixorapos.com",
        httpOnly: true,
        maxAge: 180 * 24 * 60 * 60,
        path: "/",
        sameSite: "lax",
        secure: true,
      }),
    )
  })

  it("does not add a domain attribute on localhost", async () => {
    await setLoyaltyToken("lm_local-token")

    const options = mocks.set.mock.calls[0]?.[2]
    expect(options).not.toHaveProperty("domain")
  })

  it("reads and clears the token with the same cookie scope", async () => {
    mocks.get.mockReturnValue({ value: "lm_existing-token" })
    expect(await readLoyaltyToken()).toBe("lm_existing-token")

    await clearLoyaltyToken()

    expect(mocks.set).toHaveBeenCalledWith(
      LOYALTY_TOKEN_COOKIE,
      "",
      expect.objectContaining({
        httpOnly: true,
        maxAge: 0,
        path: "/",
        sameSite: "lax",
        secure: true,
      }),
    )
  })

  it("isolates membership sessions by business without exposing the slug", async () => {
    const firstName = loyaltyTokenCookieName("birinci-isletme")
    const secondName = loyaltyTokenCookieName("ikinci-isletme")

    expect(firstName).not.toBe(secondName)
    expect(firstName).not.toContain("birinci-isletme")

    await setLoyaltyToken("lm_scoped-token", "birinci-isletme")
    expect(mocks.set).toHaveBeenLastCalledWith(
      firstName,
      "lm_scoped-token",
      expect.objectContaining({ httpOnly: true }),
    )
  })
})
