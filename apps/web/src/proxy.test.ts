import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"

import { proxy } from "@/proxy"

function roleToken(role: string, expiresInSeconds = 300) {
  const payload = Buffer.from(
    JSON.stringify({
      role,
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    }),
  ).toString("base64url")
  return `header.${payload}.signature`
}

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: cookie ? { cookie } : undefined,
  })
}

describe("auth proxy", () => {
  it("redirects a logged-out back navigation to login", () => {
    const response = proxy(request("/admin/orders?status=PAID"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "http://localhost/login?returnTo=%2Fadmin%2Forders%3Fstatus%3DPAID",
    )
  })

  it("redirects an authenticated user away from the login page", () => {
    const response = proxy(
      request("/login", `dixora_refresh=${roleToken("BUSINESS_OWNER")}`),
    )

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("http://localhost/admin")
  })

  it("allows a persisted refresh cookie to reopen the protected workspace", () => {
    const response = proxy(
      request("/admin", `dixora_refresh=${roleToken("BUSINESS_OWNER")}`),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("x-middleware-next")).toBe("1")
  })
})
