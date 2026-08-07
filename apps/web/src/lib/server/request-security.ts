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

  try {
    const originUrl = new URL(origin)
    if (originUrl.host !== request.nextUrl.host) {
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
