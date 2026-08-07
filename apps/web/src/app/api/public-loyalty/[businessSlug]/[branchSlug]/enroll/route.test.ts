import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  backendFetch: vi.fn(),
  mutationOriginError: vi.fn(),
  setLoyaltyToken: vi.fn(),
}))

vi.mock("@/lib/server/backend", () => ({
  backendFetch: mocks.backendFetch,
}))
vi.mock("@/lib/server/loyalty-cookie", () => ({
  setLoyaltyToken: mocks.setLoyaltyToken,
}))
vi.mock("@/lib/server/request-security", () => ({
  mutationOriginError: mocks.mutationOriginError,
}))

import { POST } from "@/app/api/public-loyalty/[businessSlug]/[branchSlug]/enroll/route"

function enrollmentRequest() {
  return new NextRequest(
    "http://localhost/api/public-loyalty/dixora-lab/merkez/enroll",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      body: JSON.stringify({ phone: "05325552211" }),
    },
  )
}

const context = {
  params: Promise.resolve({ businessSlug: "dixora-lab", branchSlug: "merkez" }),
}

describe("POST /api/public-loyalty/:business/:branch/enroll", () => {
  beforeEach(() => {
    mocks.mutationOriginError.mockReturnValue(null)
  })

  it("moves the raw membership token into an HttpOnly cookie", async () => {
    mocks.backendFetch.mockResolvedValue(
      Response.json(
        {
          membership_token: "lm_private-token",
          membership_code: "MEMBER123",
          referral_code: "MEMBER123",
          program_name: "Dixora Müdavim",
          verification_mode: "DEVELOPMENT",
        },
        { status: 201 },
      ),
    )

    const response = await POST(enrollmentRequest(), context)
    const payload = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(201)
    expect(mocks.setLoyaltyToken).toHaveBeenCalledWith(
      "lm_private-token",
      "dixora-lab",
    )
    expect(payload).not.toHaveProperty("membership_token")
    expect(payload.membership_code).toBe("MEMBER123")
  })

  it("rejects an invalid backend token without setting a cookie", async () => {
    mocks.backendFetch.mockResolvedValue(
      Response.json({ membership_token: "predictable" }, { status: 201 }),
    )

    const response = await POST(enrollmentRequest(), context)

    expect(response.status).toBe(502)
    expect(mocks.setLoyaltyToken).not.toHaveBeenCalled()
  })

  it("keeps mutation origin protection in front of the backend", async () => {
    mocks.mutationOriginError.mockReturnValue(
      Response.json({ error: { code: "origin_forbidden" } }, { status: 403 }),
    )

    const response = await POST(enrollmentRequest(), context)

    expect(response.status).toBe(403)
    expect(mocks.backendFetch).not.toHaveBeenCalled()
    expect(mocks.setLoyaltyToken).not.toHaveBeenCalled()
  })
})
