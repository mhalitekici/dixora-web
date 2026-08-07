import { NextRequest } from "next/server"

import { backendFetch } from "@/lib/server/backend"
import { setLoyaltyToken } from "@/lib/server/loyalty-cookie"
import { mutationOriginError } from "@/lib/server/request-security"
import {
  apiErrorResponse,
  backendErrorResponse,
  requestFailureResponse,
} from "@/lib/server/responses"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface Context {
  params: Promise<{ businessSlug: string; branchSlug: string }>
}

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  const originError = mutationOriginError(request)
  if (originError) return originError
  const { businessSlug, branchSlug } = await context.params
  let body: string
  try {
    body = await request.text()
    if (new TextEncoder().encode(body).byteLength > 32 * 1024) {
      return apiErrorResponse(413, "payload_too_large", "Kayıt isteği çok büyük.")
    }
  } catch {
    return apiErrorResponse(400, "invalid_body", "Kayıt isteği okunamadı.")
  }

  try {
    const response = await backendFetch(
      `loyalty/public/${encodeURIComponent(businessSlug)}/${encodeURIComponent(branchSlug)}/enroll`,
      {
        method: "POST",
        body,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": request.headers.get("user-agent") ?? "Dixora Public Menu",
          "x-request-id": request.headers.get("x-request-id") ?? crypto.randomUUID(),
        },
        signal: request.signal,
      },
    )
    if (!response.ok) return backendErrorResponse(response)
    const result = (await response.json()) as Record<string, unknown>
    const token = result.membership_token
    if (typeof token !== "string" || !token.startsWith("lm_")) {
      return apiErrorResponse(
        502,
        "invalid_loyalty_response",
        "Sadakat oturumu oluşturulamadı.",
      )
    }
    await setLoyaltyToken(token, businessSlug)
    const safeResult = { ...result }
    delete safeResult.membership_token
    return Response.json(safeResult, {
      status: 201,
      headers: { "cache-control": "no-store" },
    })
  } catch (error) {
    return requestFailureResponse(error)
  }
}
