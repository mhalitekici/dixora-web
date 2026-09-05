import "server-only"

import { NextRequest } from "next/server"

import { apiErrorResponse } from "@/lib/server/responses"

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export function mutationOriginError(request: NextRequest): Response | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return null
  }

  const fetchSite = request.headers.get("sec-fetch-site")
  if (fetchSite === "cross-site") {
    return apiErrorResponse(
      403,
      "cross_site_request_blocked",
      "Çapraz site isteği engellendi.",
    )
  }

  const origin = request.headers.get("origin")
  if (!origin) {
    return null
  }

  const expectedHost = requestHost(request)

  try {
    const originUrl = new URL(origin)
    if (originUrl.host !== expectedHost) {
      return apiErrorResponse(
        403,
        "origin_mismatch",
        "İstek kaynağı doğrulanamadı.",
      )
    }
  } catch {
    return apiErrorResponse(
      403,
      "invalid_origin",
      "İstek kaynağı doğrulanamadı.",
    )
  }

  return null
}

/**
 * The host the browser actually addressed, not the one this container answers on.
 *
 * Behind the reverse proxy `nextUrl.host` is the internal upstream ("web:3000"),
 * so measuring a browser's `Origin` against it rejects every genuine same-origin
 * mutation with `origin_mismatch` — the production login POST included.
 *
 * `X-Forwarded-Host` and `Host` are both overwritten by our own proxy on every
 * hop (see `infrastructure/nginx/snippets/forwarded.conf`), so a caller cannot
 * forge either one. Only the first entry is read: anything after it was appended
 * by a hop we did not observe. This holds only while the app is reachable
 * exclusively through that proxy — the same assumption `clientAddress` makes.
 * `nextUrl.host` remains the fallback for direct, unproxied requests.
 */
function requestHost(request: NextRequest): string {
  return (
    headerHost(request.headers.get("x-forwarded-host")) ??
    headerHost(request.headers.get("host")) ??
    request.nextUrl.host
  )
}

function headerHost(value: string | null): string | null {
  // Hosts are case-insensitive, and `URL` already lowercases the origin side.
  const host = value?.split(",")[0]?.trim().toLowerCase()
  return host || null
}
