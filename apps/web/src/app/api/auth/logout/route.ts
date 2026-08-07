import { NextRequest } from "next/server"

import {
  clearAuthCookies,
  readAuthCookies,
} from "@/lib/server/auth-cookies"
import { backendFetch } from "@/lib/server/backend"
import { mutationOriginError } from "@/lib/server/request-security"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest): Promise<Response> {
  const originError = mutationOriginError(request)
  if (originError) {
    // A reverse proxy with an incorrect forwarded host can make a legitimate
    // same-origin browser request fail the strict Origin check. Do not leave a
    // user trapped in the current account in that case. Cross-site requests
    // still cannot force a logout.
    if (request.headers.get("sec-fetch-site") === "cross-site") {
      return originError
    }

    await clearAuthCookies()
    return noContentResponse()
  }

  const { accessToken, refreshToken } = await readAuthCookies()
  try {
    if (accessToken || refreshToken) {
      const response = await backendFetch("auth/logout", {
        body: JSON.stringify({ refresh_token: refreshToken }),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(accessToken
            ? { authorization: `Bearer ${accessToken}` }
            : {}),
        },
        method: "POST",
      })
      await response.body?.cancel()
    }
  } catch {
    // Revocation is best effort. Local credentials must still be removed, and
    // no token or backend error details are exposed from this endpoint.
  } finally {
    await clearAuthCookies()
  }

  return noContentResponse()
}

function noContentResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  })
}
