import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  backendFetch: vi.fn(),
  clearAuthCookies: vi.fn(),
  clearTrustedDeviceCookie: vi.fn(),
  mutationOriginError: vi.fn(),
  readAuthCookies: vi.fn(),
}))

vi.mock("@/lib/server/auth-cookies", () => ({
  clearAuthCookies: mocks.clearAuthCookies,
  clearTrustedDeviceCookie: mocks.clearTrustedDeviceCookie,
  readAuthCookies: mocks.readAuthCookies,
}))
vi.mock("@/lib/server/backend", () => ({
  backendFetch: mocks.backendFetch,
}))
vi.mock("@/lib/server/request-security", () => ({
  mutationOriginError: mocks.mutationOriginError,
}))

import { POST } from "@/app/api/auth/logout/route"

function logoutRequest() {
  return new NextRequest("http://localhost/api/auth/logout", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
    },
  })
}

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    mocks.mutationOriginError.mockReturnValue(null)
    mocks.readAuthCookies.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    })
  })

  it("revokes the persisted refresh session and always clears local cookies", async () => {
    mocks.backendFetch.mockResolvedValue(
      new Response(null, { status: 204 }),
    )

    const response = await POST(logoutRequest())

    expect(response.status).toBe(204)
    expect(mocks.backendFetch).toHaveBeenCalledWith(
      "auth/logout",
      expect.objectContaining({
        body: JSON.stringify({ refresh_token: "refresh-token" }),
        method: "POST",
      }),
    )
    expect(mocks.clearAuthCookies).toHaveBeenCalledTimes(1)
    expect(mocks.clearTrustedDeviceCookie).not.toHaveBeenCalled()
  })

  it("remains idempotent and returns 204 when backend revocation fails", async () => {
    mocks.backendFetch.mockRejectedValue(new Error("backend unavailable"))

    const response = await POST(logoutRequest())

    expect(response.status).toBe(204)
    expect(mocks.clearAuthCookies).toHaveBeenCalledTimes(1)
  })

  it("does not call the backend when the browser has no credentials", async () => {
    mocks.readAuthCookies.mockResolvedValue({
      accessToken: null,
      refreshToken: null,
    })

    const response = await POST(logoutRequest())

    expect(response.status).toBe(204)
    expect(mocks.backendFetch).not.toHaveBeenCalled()
    expect(mocks.clearAuthCookies).toHaveBeenCalledTimes(1)
  })

  it("completes local logout for a rejected same-site origin check", async () => {
    mocks.mutationOriginError.mockReturnValue(
      new Response(null, { status: 403 }),
    )

    const response = await POST(logoutRequest())

    expect(response.status).toBe(204)
    expect(mocks.backendFetch).not.toHaveBeenCalled()
    expect(mocks.clearAuthCookies).toHaveBeenCalledTimes(1)
    expect(mocks.clearTrustedDeviceCookie).not.toHaveBeenCalled()
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("does not let a cross-site request force a logout", async () => {
    mocks.mutationOriginError.mockReturnValue(
      new Response(null, { status: 403 }),
    )
    const request = new NextRequest("http://localhost/api/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
    })

    const response = await POST(request)

    expect(response.status).toBe(403)
    expect(mocks.backendFetch).not.toHaveBeenCalled()
    expect(mocks.clearAuthCookies).not.toHaveBeenCalled()
  })
})
