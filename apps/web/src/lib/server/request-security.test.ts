import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"

import { mutationOriginError } from "@/lib/server/request-security"

// In production the browser reaches Next.js through Nginx, so the URL the
// runtime sees is the internal upstream while the browser addressed the public
// name. Every request here is shaped that way unless a case says otherwise.
const UPSTREAM_URL = "http://web:3000/api/auth/login"

function mutation(
  headers: Record<string, string>,
  url: string = UPSTREAM_URL,
): NextRequest {
  return new NextRequest(url, { headers, method: "POST" })
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } }
  return body.error.code
}

describe("mutationOriginError", () => {
  it("allows a same-origin login behind the reverse proxy", async () => {
    // The bug this guards: the browser is on dixoratech.com, the runtime URL is
    // web:3000, and comparing the two rejected every real production login.
    expect(
      mutationOriginError(
        mutation({
          host: "web:3000",
          origin: "https://dixoratech.com",
          "x-forwarded-host": "dixoratech.com",
        }),
      ),
    ).toBeNull()
  })

  it("rejects a foreign origin even when the forwarded host matches us", async () => {
    const response = mutationOriginError(
      mutation({
        host: "web:3000",
        origin: "https://evil.example",
        "x-forwarded-host": "dixoratech.com",
      }),
    )

    expect(response?.status).toBe(403)
    expect(await errorCode(response!)).toBe("origin_mismatch")
  })

  it("falls back to the Host header when nothing forwarded one", async () => {
    expect(
      mutationOriginError(
        mutation(
          { host: "dixoratech.com", origin: "https://dixoratech.com" },
          "http://dixoratech.com/api/auth/login",
        ),
      ),
    ).toBeNull()
  })

  it("rejects an unparseable origin", async () => {
    const response = mutationOriginError(
      mutation({
        host: "web:3000",
        origin: "not-a-url",
        "x-forwarded-host": "dixoratech.com",
      }),
    )

    expect(response?.status).toBe(403)
    expect(await errorCode(response!)).toBe("invalid_origin")
  })

  it("blocks a cross-site fetch before the origin is even read", async () => {
    const response = mutationOriginError(
      mutation({
        host: "web:3000",
        origin: "https://dixoratech.com",
        "sec-fetch-site": "cross-site",
        "x-forwarded-host": "dixoratech.com",
      }),
    )

    expect(response?.status).toBe(403)
    expect(await errorCode(response!)).toBe("cross_site_request_blocked")
  })

  it("trusts only the first forwarded host", async () => {
    // A hop appended after our proxy's value is one we never observed, so it
    // must not be able to nominate the origin a request is measured against.
    expect(
      mutationOriginError(
        mutation({
          host: "web:3000",
          origin: "https://dixoratech.com",
          "x-forwarded-host": "dixoratech.com, evil.example",
        }),
      ),
    ).toBeNull()

    const response = mutationOriginError(
      mutation({
        host: "web:3000",
        origin: "https://evil.example",
        "x-forwarded-host": "dixoratech.com, evil.example",
      }),
    )

    expect(response?.status).toBe(403)
    expect(await errorCode(response!)).toBe("origin_mismatch")
  })

  it("falls through a blank forwarded host to the Host header", async () => {
    expect(
      mutationOriginError(
        mutation({
          host: "dixoratech.com",
          origin: "https://dixoratech.com",
          "x-forwarded-host": "   ",
        }),
      ),
    ).toBeNull()
  })

  it("compares hosts case-insensitively", async () => {
    expect(
      mutationOriginError(
        mutation({
          host: "web:3000",
          origin: "https://dixoratech.com",
          "x-forwarded-host": "Dixoratech.COM",
        }),
      ),
    ).toBeNull()
  })

  it("keeps matching the runtime host when no proxy header is present", async () => {
    expect(
      mutationOriginError(
        new NextRequest("http://localhost/api/auth/login", {
          headers: { origin: "http://localhost" },
          method: "POST",
        }),
      ),
    ).toBeNull()

    const response = mutationOriginError(
      new NextRequest("http://localhost/api/auth/login", {
        headers: { origin: "http://evil.example" },
        method: "POST",
      }),
    )

    expect(response?.status).toBe(403)
    expect(await errorCode(response!)).toBe("origin_mismatch")
  })

  it("leaves safe methods and origin-less requests alone", () => {
    expect(
      mutationOriginError(
        new NextRequest(UPSTREAM_URL, {
          headers: { origin: "https://evil.example" },
          method: "GET",
        }),
      ),
    ).toBeNull()
    expect(mutationOriginError(mutation({ host: "web:3000" }))).toBeNull()
  })
})
