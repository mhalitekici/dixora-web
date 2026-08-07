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
  ACCESS_TOKEN_COOKIE,
  clearAuthCookies,
  clearTrustedDeviceCookie,
  REFRESH_TOKEN_COOKIE,
  setAuthCookies,
  setTrustedDeviceCookie,
  TRUSTED_DEVICE_COOKIE,
} from "@/lib/server/auth-cookies"

describe("auth cookie policy", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_COOKIE_SECURE", "true")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("persists both credentials only for a remembered session", async () => {
    vi.stubEnv("AUTH_COOKIE_DOMAIN", ".dixorapos.com")

    await setAuthCookies({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 900,
      refreshExpiresIn: 30 * 24 * 60 * 60,
      rememberMe: true,
    })

    expect(mocks.set).toHaveBeenNthCalledWith(
      1,
      ACCESS_TOKEN_COOKIE,
      "access-token",
      expect.objectContaining({
        domain: ".dixorapos.com",
        httpOnly: true,
        maxAge: 900,
        path: "/",
        sameSite: "lax",
        secure: true,
      }),
    )
    expect(mocks.set).toHaveBeenNthCalledWith(
      2,
      REFRESH_TOKEN_COOKIE,
      "refresh-token",
      expect.objectContaining({ maxAge: 30 * 24 * 60 * 60 }),
    )
  })

  it("uses browser-session cookies when remember me is disabled", async () => {
    await setAuthCookies({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 900,
      refreshExpiresIn: 24 * 60 * 60,
      rememberMe: false,
    })

    for (const call of mocks.set.mock.calls) {
      const options = call[2] as Record<string, unknown>
      expect(options).not.toHaveProperty("domain")
      expect(options).not.toHaveProperty("expires")
      expect(options).not.toHaveProperty("maxAge")
    }
  })

  it("expires both host-only and domain-scoped cookie variants", async () => {
    vi.stubEnv("AUTH_COOKIE_DOMAIN", ".dixorapos.com")

    await clearAuthCookies()

    expect(mocks.set).toHaveBeenCalledTimes(4)
    expect(
      mocks.set.mock.calls.map(([name, , options]) => ({
        domain: options.domain,
        name,
      })),
    ).toEqual([
      { domain: undefined, name: ACCESS_TOKEN_COOKIE },
      { domain: ".dixorapos.com", name: ACCESS_TOKEN_COOKIE },
      { domain: undefined, name: REFRESH_TOKEN_COOKIE },
      { domain: ".dixorapos.com", name: REFRESH_TOKEN_COOKIE },
    ])

    for (const call of mocks.set.mock.calls) {
      const options = call[2] as Record<string, unknown>
      expect(call[1]).toBe("")
      expect(options).toEqual(
        expect.objectContaining({
          maxAge: 0,
          path: "/",
          secure: true,
        }),
      )
      expect(options.expires).toEqual(new Date(0))
    }
  })

  it("expires only host-only variants when no cookie domain is configured", async () => {
    await clearAuthCookies()

    expect(mocks.set).toHaveBeenCalledTimes(2)
    expect(mocks.set.mock.calls.map((call) => call[0])).toEqual([
      ACCESS_TOKEN_COOKIE,
      REFRESH_TOKEN_COOKIE,
    ])
    for (const call of mocks.set.mock.calls) {
      expect(call[2]).not.toHaveProperty("domain")
    }
  })

  it("stores trusted-device credentials in a narrow HttpOnly cookie", async () => {
    vi.stubEnv("AUTH_COOKIE_DOMAIN", ".dixorapos.com")

    await setTrustedDeviceCookie({
      token: "tdv_high-entropy-device-token-value",
      expiresIn: 180 * 24 * 60 * 60,
    })

    expect(mocks.set).toHaveBeenNthCalledWith(
      1,
      TRUSTED_DEVICE_COOKIE,
      "",
      expect.objectContaining({ maxAge: 0, path: "/" }),
    )
    expect(mocks.set).toHaveBeenNthCalledWith(
      2,
      TRUSTED_DEVICE_COOKIE,
      "tdv_high-entropy-device-token-value",
      expect.objectContaining({
        httpOnly: true,
        maxAge: 180 * 24 * 60 * 60,
        path: "/api/auth",
        sameSite: "strict",
        secure: true,
      }),
    )
    expect(mocks.set.mock.calls[1]?.[2]).not.toHaveProperty("domain")
  })

  it("clears both current and legacy trusted-device cookie paths", async () => {
    await clearTrustedDeviceCookie()

    expect(mocks.set).toHaveBeenCalledTimes(2)
    expect(mocks.set.mock.calls.map((call) => call[2].path)).toEqual([
      "/api/auth",
      "/",
    ])
    for (const call of mocks.set.mock.calls) {
      expect(call[0]).toBe(TRUSTED_DEVICE_COOKIE)
      expect(call[1]).toBe("")
      expect(call[2]).toEqual(
        expect.objectContaining({ httpOnly: true, maxAge: 0 }),
      )
    }
  })
})
