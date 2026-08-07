import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  backendFetch: vi.fn(),
  clearAuthCookies: vi.fn(),
  mutationOriginError: vi.fn(),
  readAuthCookies: vi.fn(),
  setAuthCookies: vi.fn(),
}))

vi.mock("@/lib/server/auth-cookies", () => ({
  clearAuthCookies: mocks.clearAuthCookies,
  readAuthCookies: mocks.readAuthCookies,
  setAuthCookies: mocks.setAuthCookies,
}))
vi.mock("@/lib/server/backend", () => ({
  backendFetch: mocks.backendFetch,
}))
vi.mock("@/lib/server/request-security", () => ({
  mutationOriginError: mocks.mutationOriginError,
}))

import { POST } from "@/app/api/auth/switch-branch/route"

const BRANCH_ID = "22222222-2222-4222-8222-222222222222"

function switchRequest(body: unknown = { branch_id: BRANCH_ID }) {
  return new NextRequest("http://localhost/api/auth/switch-branch", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    method: "POST",
  })
}

function backendAuthResponse() {
  return {
    access_token: "new-access",
    refresh_token: "new-refresh",
    expires_in: 900,
    refresh_expires_in: 2_592_000,
    remember_me: true,
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      tenant_id: "33333333-3333-4333-8333-333333333333",
      branch_id: BRANCH_ID,
      username: "owner@dixora.test",
      email: "owner@dixora.test",
      display_name: "İşletme Sahibi",
      role: "BUSINESS_OWNER",
      permissions: ["dashboard.read"],
      is_super_admin: false,
      tenant: {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Dixora Lab",
        slug: "dixora-lab",
        state: "TRIAL",
        is_active: true,
        default_currency: "TRY",
      },
      branch: {
        id: BRANCH_ID,
        name: "Kadıköy",
        slug: "kadikoy",
        timezone: "Europe/Istanbul",
        is_active: true,
      },
    },
  }
}

describe("POST /api/auth/switch-branch", () => {
  beforeEach(() => {
    mocks.mutationOriginError.mockReturnValue(null)
    mocks.readAuthCookies.mockResolvedValue({
      accessToken: "old-access",
      refreshToken: "http-only-refresh",
    })
  })

  it("uses the HttpOnly refresh cookie and replaces both auth cookies", async () => {
    mocks.backendFetch.mockResolvedValue(
      Response.json(backendAuthResponse()),
    )

    const response = await POST(switchRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.backendFetch).toHaveBeenCalledWith(
      "auth/switch-branch",
      expect.objectContaining({
        body: JSON.stringify({
          refresh_token: "http-only-refresh",
          branch_id: BRANCH_ID,
        }),
        method: "POST",
      }),
    )
    expect(mocks.setAuthCookies).toHaveBeenCalledWith({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 900,
      refreshExpiresIn: 2_592_000,
      rememberMe: true,
    })
    expect(body.branch).toMatchObject({ id: BRANCH_ID, name: "Kadıköy" })
    expect(body.permissions).toEqual(["dashboard.read"])
  })

  it("rejects browser-supplied tenant context", async () => {
    const response = await POST(
      switchRequest({
        branch_id: BRANCH_ID,
        tenant_id: "33333333-3333-4333-8333-333333333333",
      }),
    )

    expect(response.status).toBe(422)
    expect(mocks.backendFetch).not.toHaveBeenCalled()
  })

  it("honors the mutation origin guard before reading credentials", async () => {
    mocks.mutationOriginError.mockReturnValue(
      Response.json({ error: { code: "origin_mismatch" } }, { status: 403 }),
    )

    const response = await POST(switchRequest())

    expect(response.status).toBe(403)
    expect(mocks.readAuthCookies).not.toHaveBeenCalled()
    expect(mocks.backendFetch).not.toHaveBeenCalled()
  })

  it("keeps the current cookies when backend denies an inaccessible branch", async () => {
    mocks.backendFetch.mockResolvedValue(
      Response.json(
        {
          error: {
            code: "branch_switch_forbidden",
            message: "Branch access is not allowed",
          },
        },
        { status: 403 },
      ),
    )

    const response = await POST(switchRequest())

    expect(response.status).toBe(403)
    expect(mocks.clearAuthCookies).not.toHaveBeenCalled()
    expect(mocks.setAuthCookies).not.toHaveBeenCalled()
  })
})
