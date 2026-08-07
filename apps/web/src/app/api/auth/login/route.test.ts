import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  backendFetch: vi.fn(),
  clearTrustedDeviceCookie: vi.fn(),
  mutationOriginError: vi.fn(),
  setAuthCookies: vi.fn(),
  setTrustedDeviceCookie: vi.fn(),
}))

vi.mock("@/lib/server/auth-cookies", () => ({
  clearTrustedDeviceCookie: mocks.clearTrustedDeviceCookie,
  setAuthCookies: mocks.setAuthCookies,
  setTrustedDeviceCookie: mocks.setTrustedDeviceCookie,
  TRUSTED_DEVICE_COOKIE: "dixora_trusted_device",
}))
vi.mock("@/lib/server/backend", () => ({
  backendFetch: mocks.backendFetch,
}))
vi.mock("@/lib/server/request-security", () => ({
  mutationOriginError: mocks.mutationOriginError,
}))

import { POST } from "@/app/api/auth/login/route"

const TRUSTED_TOKEN = `tdv_${"a".repeat(43)}`
const PREVIOUS_TOKEN = `tdv_${"b".repeat(43)}`

function loginRequest() {
  return new NextRequest("http://localhost/api/auth/login", {
    body: JSON.stringify({
      business_slug: "dixora-lab",
      identifier: "owner@dixora.test",
      password: "DixoraLab!2026",
      remember_me: false,
    }),
    headers: {
      "content-type": "application/json",
      cookie: `dixora_trusted_device=${PREVIOUS_TOKEN}`,
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
    trusted_device: {
      token: TRUSTED_TOKEN,
      expires_in: 180 * 24 * 60 * 60,
    },
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      tenant_id: "22222222-2222-4222-8222-222222222222",
      branch_id: "33333333-3333-4333-8333-333333333333",
      username: "owner@dixora.test",
      email: "owner@dixora.test",
      display_name: "İşletme Sahibi",
      role: "BUSINESS_OWNER",
      is_super_admin: false,
    },
  }
}

describe("POST /api/auth/login trusted-device enrollment", () => {
  beforeEach(() => {
    mocks.mutationOriginError.mockReturnValue(null)
    mocks.backendFetch.mockResolvedValue(Response.json(backendAuthResponse()))
  })

  it("enrolls only after backend password success and keeps secrets out of JSON", async () => {
    const response = await POST(loginRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    const [, options] = mocks.backendFetch.mock.calls[0] ?? []
    expect(JSON.parse(String(options?.body))).toEqual(
      expect.objectContaining({
        enroll_trusted_device: true,
        trusted_device_token: PREVIOUS_TOKEN,
      }),
    )
    expect(mocks.setAuthCookies).toHaveBeenCalledTimes(1)
    expect(mocks.setTrustedDeviceCookie).toHaveBeenCalledWith({
      token: TRUSTED_TOKEN,
      expiresIn: 180 * 24 * 60 * 60,
    })
    expect(body).not.toHaveProperty("access_token")
    expect(body).not.toHaveProperty("refresh_token")
    expect(body).not.toHaveProperty("trusted_device")
  })

  it("does not mutate cookies when the origin guard rejects the request", async () => {
    mocks.mutationOriginError.mockReturnValue(
      Response.json({ error: { code: "origin_mismatch" } }, { status: 403 }),
    )

    const response = await POST(loginRequest())

    expect(response.status).toBe(403)
    expect(mocks.backendFetch).not.toHaveBeenCalled()
    expect(mocks.setAuthCookies).not.toHaveBeenCalled()
    expect(mocks.setTrustedDeviceCookie).not.toHaveBeenCalled()
  })
})
