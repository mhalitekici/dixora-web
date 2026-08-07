import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  clearLoyaltyToken: vi.fn(),
  mutationOriginError: vi.fn(),
}))

vi.mock("@/lib/server/loyalty-cookie", () => ({
  clearLoyaltyToken: mocks.clearLoyaltyToken,
}))
vi.mock("@/lib/server/request-security", () => ({
  mutationOriginError: mocks.mutationOriginError,
}))

import { POST } from "@/app/api/public-loyalty/[businessSlug]/forget/route"

describe("POST /api/public-loyalty/[businessSlug]/forget", () => {
  beforeEach(() => {
    mocks.mutationOriginError.mockReturnValue(null)
  })

  it("clears only the selected business session", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/public-loyalty/dixora-lab/forget", {
        method: "POST",
      }),
      { params: Promise.resolve({ businessSlug: "dixora-lab" }) },
    )

    expect(response.status).toBe(204)
    expect(mocks.clearLoyaltyToken).toHaveBeenCalledWith("dixora-lab")
  })

  it("does not mutate cookies when origin validation fails", async () => {
    mocks.mutationOriginError.mockReturnValue(
      Response.json({ error: "forbidden" }, { status: 403 }),
    )

    const response = await POST(
      new NextRequest("http://localhost/api/public-loyalty/dixora-lab/forget", {
        method: "POST",
      }),
      { params: Promise.resolve({ businessSlug: "dixora-lab" }) },
    )

    expect(response.status).toBe(403)
    expect(mocks.clearLoyaltyToken).not.toHaveBeenCalled()
  })
})
