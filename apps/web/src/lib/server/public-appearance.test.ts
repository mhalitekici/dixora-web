import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  backendFetch: vi.fn<(path: string) => Promise<Response>>(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/server/backend", () => ({ backendFetch: mocks.backendFetch }))

import { readPublicThemeMode } from "@/lib/server/public-appearance"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => {
  mocks.backendFetch.mockReset()
})

describe("readPublicThemeMode", () => {
  it("asks the public appearance route for the named business", async () => {
    mocks.backendFetch.mockResolvedValue(jsonResponse({ theme_mode: "LIGHT" }))

    await expect(readPublicThemeMode("aleyin-mutfagi")).resolves.toBe("LIGHT")
    expect(mocks.backendFetch.mock.calls[0]?.[0]).toBe(
      "qr/public/aleyin-mutfagi/appearance",
    )
  })

  it("returns nothing when the API is unreachable, so the menu still renders", async () => {
    // A theme is not worth failing a page over: falling through leaves the
    // guest with their device's own preference, which is the old behaviour.
    mocks.backendFetch.mockRejectedValue(new Error("connect ECONNREFUSED"))

    await expect(readPublicThemeMode("aleyin-mutfagi")).resolves.toBeNull()
  })

  it("returns nothing on an error status", async () => {
    mocks.backendFetch.mockResolvedValue(jsonResponse({ detail: "nope" }, 500))

    await expect(readPublicThemeMode("aleyin-mutfagi")).resolves.toBeNull()
  })

  it("refuses a mode it does not recognise rather than passing it through", async () => {
    mocks.backendFetch.mockResolvedValue(jsonResponse({ theme_mode: "NEON" }))

    await expect(readPublicThemeMode("aleyin-mutfagi")).resolves.toBeNull()
  })

  it("survives a response that is not an object", async () => {
    mocks.backendFetch.mockResolvedValue(jsonResponse("LIGHT"))

    await expect(readPublicThemeMode("aleyin-mutfagi")).resolves.toBeNull()
  })
})
