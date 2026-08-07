import { NextRequest } from "next/server"
import { z } from "zod"

import { asRecord, normalizeAuthContext } from "@/lib/api/normalizers"
import {
  clearAuthCookies,
  readAuthCookies,
  setAuthCookies,
} from "@/lib/server/auth-cookies"
import { parseAuthTokens } from "@/lib/server/auth-session"
import { backendFetch } from "@/lib/server/backend"
import { mutationOriginError } from "@/lib/server/request-security"
import {
  apiErrorResponse,
  backendErrorResponse,
  requestFailureResponse,
} from "@/lib/server/responses"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_SWITCH_BODY_BYTES = 4 * 1024
const switchSchema = z.object({ branch_id: z.string().uuid() }).strict()

export async function POST(request: NextRequest): Promise<Response> {
  const originError = mutationOriginError(request)
  if (originError) {
    return originError
  }

  const contentLength = Number.parseInt(
    request.headers.get("content-length") ?? "0",
    10,
  )
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_SWITCH_BODY_BYTES
  ) {
    return apiErrorResponse(
      413,
      "payload_too_large",
      "Şube değiştirme isteği izin verilen boyutu aşıyor.",
    )
  }

  let input: unknown
  try {
    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_SWITCH_BODY_BYTES) {
      return apiErrorResponse(
        413,
        "payload_too_large",
        "Şube değiştirme isteği izin verilen boyutu aşıyor.",
      )
    }
    input = JSON.parse(rawBody)
  } catch {
    return apiErrorResponse(
      400,
      "invalid_json",
      "Geçerli bir JSON gövdesi gönderin.",
    )
  }

  const parsed = switchSchema.safeParse(input)
  if (!parsed.success) {
    return apiErrorResponse(
      422,
      "validation_error",
      "Geçerli bir şube seçin.",
      parsed.error.flatten(),
    )
  }

  const { refreshToken } = await readAuthCookies()
  if (!refreshToken) {
    await clearAuthCookies()
    return apiErrorResponse(
      401,
      "refresh_token_missing",
      "Oturum yenileme bilgisi bulunamadı.",
    )
  }

  try {
    const response = await backendFetch("auth/switch-branch", {
      body: JSON.stringify({
        refresh_token: refreshToken,
        branch_id: parsed.data.branch_id,
      }),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": request.headers.get("user-agent") ?? "Dixora Web BFF",
        "x-request-id":
          request.headers.get("x-request-id") ?? crypto.randomUUID(),
      },
      method: "POST",
      signal: request.signal,
    })
    if (!response.ok) {
      if (response.status === 401) {
        await clearAuthCookies()
      }
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
    const tokens = parseAuthTokens(body)
    const context = normalizeAuthContext(asRecord(body)?.user)
    if (!tokens || !context) {
      return apiErrorResponse(
        502,
        "invalid_auth_response",
        "Kimlik sunucusundan geçersiz yanıt alındı.",
      )
    }

    await setAuthCookies(tokens)
    return Response.json(context, {
      headers: { "cache-control": "no-store" },
    })
  } catch (error) {
    return requestFailureResponse(error)
  }
}
