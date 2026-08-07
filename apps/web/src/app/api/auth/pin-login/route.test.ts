import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  backendFetch: vi.fn(),
  clearTrustedDeviceCookie: vi.fn(),
  mutationOriginError: vi.fn(),
  setAuthCookies: vi.fn(),
}))

vi.mock("@/lib/server/auth-cookies", () => ({
  clearTrustedDeviceCookie: mocks.clearTrustedDeviceCookie,
  setAuthCookies: mocks.setAuthCookies,
  TRUSTED_DEVICE_COOKIE: "dixora_trusted_device",
}))
vi.mock("@/lib/server/backend", () => ({
  backendFetch: mocks.backendFetch,
}))
vi.mock("@/lib/server/request-security", () => ({
  mutationOriginError: mocks.mutationOriginError,
}))

import { POST } from "@/app/api/auth/pin-login/route"

const DEVICE_TOKEN = `tdv_${"c".repeat(43)}`

function pinRequest(withDevice = true) {
  return new NextRequest("http://localhost/api/auth/pin-login", {
    body: JSON.stringify({
      business_slug: "dixora-lab",
      branch_slug: "merkez",
      username: "waiter@dixora.test",
      pin: "2468",
    }),
    headers: {
      "content-type": "application/json",
      ...(withDevice
        ? { cookie: `dixora_trusted_device=${DEVICE_TOKEN}` }
        : {}),
      origin: "http://localhost",
    },
    method: "POST",
  })
}

function backendAuthResponse() {
  return {
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_in: 900,
    refresh_expires_in: 86_400,
    remember_me: false,
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      tenant_id: "22222222-2222-4222-8222-222222222222",
      branch_id: "33333333-3333-4333-8333-333333333333",
      username: "waiter@dixora.test",
      email: "waiter@dixora.test",
      display_name: "Garson",
      role: "WAITER",
      is_super_admin: false,
    },
  }
}

describe("POST /api/auth/pin-login trusted-device policy", () => {
  beforeEach(() => {
    mocks.mutationOriginError.mockReturnValue(null)
  })

  it("forwards only the server-readable device credential", async () => {
    mocks.backendFetch.mockResolvedValue(Response.json(backendAuthResponse()))

    const response = await POST(pinRequest())

    expect(response.status).toBe(200)
    const [, options] = mocks.backendFetch.mock.calls[0] ?? []
    expect(JSON.parse(String(options?.body))).toEqual({
      business_slug: "dixora-lab",
      branch_slug: "merkez",
      username: "waiter@dixora.test",
      pin: "2468",
      device_token: DEVICE_TOKEN,
    })
    expect(mocks.setAuthCookies).toHaveBeenCalledTimes(1)
  })

  it("never manufactures a credential when the cookie is missing", async () => {
    mocks.backendFetch.mockResolvedValue(
      Response.json(
        {
          error: {
            code: "trusted_device_required",
            message: "Password login required",
          },
        },
        { status: 403 },
      ),
    )

    const response = await POST(pinRequest(false))
    const [, options] = mocks.backendFetch.mock.calls[0] ?? []

    expect(response.status).toBe(403)
    expect(JSON.parse(String(options?.body))).toEqual(
      expect.objectContaining({ device_token: null }),
    )
    expect(mocks.clearTrustedDeviceCookie).toHaveBeenCalledTimes(1)
    expect(mocks.setAuthCookies).not.toHaveBeenCalled()
  })
})
