import { NextRequest } from "next/server"

import { backendFetch } from "@/lib/server/backend"
import {
  clearLoyaltyToken,
  readLoyaltyToken,
} from "@/lib/server/loyalty-cookie"
import {
  backendErrorResponse,
  requestFailureResponse,
} from "@/lib/server/responses"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface Context {
  params: Promise<{ businessSlug: string; branchSlug: string }>
}

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  const { businessSlug, branchSlug } = await context.params
  const token = await readLoyaltyToken(businessSlug)
  if (!token) return emptyStatusResponse()

  try {
    const response = await backendFetch(
      `loyalty/public/${encodeURIComponent(businessSlug)}/${encodeURIComponent(branchSlug)}/status`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": request.headers.get("user-agent") ?? "Dixora Public Menu",
          "x-loyalty-token": token,
          "x-request-id": request.headers.get("x-request-id") ?? crypto.randomUUID(),
        },
        signal: request.signal,
      },
    )

    if (response.status === 401) {
      await response.body?.cancel()
      await clearLoyaltyToken(businessSlug)
      return emptyStatusResponse()
    }
    if (!response.ok) return backendErrorResponse(response)

    return Response.json(await response.json(), {
      headers: { "cache-control": "no-store" },
    })
  } catch (error) {
    return requestFailureResponse(error)
  }
}

function emptyStatusResponse(): Response {
  return Response.json(null, {
    headers: { "cache-control": "no-store" },
  })
}
