import { NextRequest } from "next/server"

import {
  clearAuthCookies,
  readAuthCookies,
  setAuthCookies,
} from "@/lib/server/auth-cookies"
import { refreshSession } from "@/lib/server/auth-session"
import { mutationOriginError } from "@/lib/server/request-security"
import {
  apiErrorResponse,
  backendErrorResponse,
  requestFailureResponse,
} from "@/lib/server/responses"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest): Promise<Response> {
  const originError = mutationOriginError(request)
  if (originError) {
    return originError
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
    const outcome = await refreshSession(refreshToken)
    if (!outcome.ok) {
      if (outcome.status === 401 || outcome.status === 403) {
        await clearAuthCookies()
      }

      return backendErrorResponse(
        new Response(JSON.stringify(outcome.body ?? {}), {
          status: outcome.status,
          headers: {
            "content-type": "application/json",
            ...(outcome.requestId
              ? { "x-request-id": outcome.requestId }
              : {}),
            ...(outcome.retryAfter
              ? { "retry-after": outcome.retryAfter }
              : {}),
          },
        }),
      )
    }

    await setAuthCookies(outcome.tokens)
    return Response.json(
      { refreshed: true, expiresIn: outcome.tokens.expiresIn },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (error) {
    return requestFailureResponse(error)
  }
}
