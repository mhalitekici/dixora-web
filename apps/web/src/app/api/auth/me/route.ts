import { NextRequest } from "next/server"

import { normalizeAuthContext } from "@/lib/api/normalizers"
import { authenticatedBackendFetch } from "@/lib/server/auth-session"
import {
  apiErrorResponse,
  backendErrorResponse,
  requestFailureResponse,
} from "@/lib/server/responses"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const response = await authenticatedBackendFetch("auth/me", {
      headers: { accept: "application/json" },
      method: "GET",
      signal: request.signal,
    })

    if (!response.ok) {
      return backendErrorResponse(response)
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return apiErrorResponse(
        502,
        "invalid_auth_response",
        "Kimlik sunucusundan geçersiz yanıt alındı.",
      )
    }

    const context = normalizeAuthContext(body)
    if (!context) {
      return apiErrorResponse(
        502,
        "invalid_auth_response",
        "Kimlik sunucusundan geçersiz yanıt alındı.",
      )
    }

    return Response.json(context, {
      headers: { "cache-control": "no-store" },
    })
  } catch (error) {
    return requestFailureResponse(error)
  }
}
