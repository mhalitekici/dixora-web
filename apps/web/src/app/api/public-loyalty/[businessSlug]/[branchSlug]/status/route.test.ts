import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  backendFetch: vi.fn(),
  clearLoyaltyToken: vi.fn(),
  readLoyaltyToken: vi.fn(),
}))

vi.mock("@/lib/server/backend", () => ({
  backendFetch: mocks.backendFetch,
}))
vi.mock("@/lib/server/loyalty-cookie", () => ({
  clearLoyaltyToken: mocks.clearLoyaltyToken,
  readLoyaltyToken: mocks.readLoyaltyToken,
}))

import { GET } from "@/app/api/public-loyalty/[businessSlug]/[branchSlug]/status/route"

const request = new NextRequest(
  "http://localhost/api/public-loyalty/dixora-lab/merkez/status",
)
const context = {
  params: Promise.resolve({ businessSlug: "dixora-lab", branchSlug: "merkez" }),
}

describe("GET /api/public-loyalty/:business/:branch/status", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns an empty status without calling the backend when no cookie exists", async () => {
    mocks.readLoyaltyToken.mockResolvedValue(null)

    const response = await GET(request, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toBeNull()
    expect(mocks.backendFetch).not.toHaveBeenCalled()
  })

  it("forwards a valid private token only from the server", async () => {
    mocks.readLoyaltyToken.mockResolvedValue("lm_private-token")
    mocks.backendFetch.mockResolvedValue(
      Response.json({ membership_code: "MEMBER123" }),
    )

    const response = await GET(request, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ membership_code: "MEMBER123" })
    expect(mocks.backendFetch).toHaveBeenCalledWith(
      "loyalty/public/dixora-lab/merkez/status",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-loyalty-token": "lm_private-token",
        }),
      }),
    )
  })

  it("clears an expired cookie and turns the expected 401 into an empty status", async () => {
    mocks.readLoyaltyToken.mockResolvedValue("lm_expired-token")
    mocks.backendFetch.mockResolvedValue(Response.json({}, { status: 401 }))

    const response = await GET(request, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toBeNull()
    expect(mocks.clearLoyaltyToken).toHaveBeenCalledWith("dixora-lab")
  })
})
