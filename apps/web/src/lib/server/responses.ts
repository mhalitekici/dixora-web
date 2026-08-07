import "server-only"

import {
  defaultErrorMessage,
  normalizeErrorPayload,
} from "@/lib/api/errors"
import type { ApiErrorPayload } from "@/lib/api/types"
import { BackendRequestError } from "@/lib/server/backend"

const RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-disposition",
  "content-language",
  "content-type",
  "etag",
  "expires",
  "last-modified",
  "retry-after",
  "vary",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-request-id",
])

export async function backendResponse(
  response: Response,
): Promise<Response> {
  if (response.status >= 300 && response.status < 400) {
    return apiErrorResponse(
      502,
      "unexpected_backend_redirect",
      "Sunucu beklenmeyen bir yönlendirme döndürdü.",
    )
  }

  if (!response.ok) {
    return backendErrorResponse(response)
  }

  const headers = copyResponseHeaders(response.headers)
  if (response.status === 204 || response.status === 205) {
    return new Response(null, { status: response.status, headers })
  }

  return new Response(response.body, {
    status: response.status,
    headers,
  })
}

export async function backendErrorResponse(
  response: Response,
): Promise<Response> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }

  const requestId = response.headers.get("x-request-id") ?? undefined
  const payload = normalizeErrorPayload(body, response.status, requestId)
  const headers = copyResponseHeaders(response.headers)
  headers.set("content-type", "application/json; charset=utf-8")
  headers.set("cache-control", "no-store")

  return Response.json(payload, {
    status: response.status,
    headers,
  })
}

export function apiErrorResponse(
  status: number,
  code: string,
  message = defaultErrorMessage(status),
  details?: unknown,
  requestId?: string,
): Response {
  const payload: ApiErrorPayload = {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
    ...(requestId ? { requestId } : {}),
  }

  return Response.json(payload, {
    status,
    headers: { "cache-control": "no-store" },
  })
}

export function requestFailureResponse(error: unknown): Response {
  if (error instanceof BackendRequestError) {
    if (error.kind === "timeout") {
      return apiErrorResponse(
        504,
        "backend_timeout",
        "Sunucu zamanında yanıt vermedi.",
      )
    }

    if (error.kind === "configuration") {
      return apiErrorResponse(
        500,
        "server_misconfigured",
        "Sunucu yapılandırması tamamlanmamış.",
      )
    }
  }

  return apiErrorResponse(
    502,
    "backend_unavailable",
    "Sunucuya şu anda ulaşılamıyor.",
  )
}

function copyResponseHeaders(input: Headers): Headers {
  const headers = new Headers()
  for (const [name, value] of input.entries()) {
    if (RESPONSE_HEADERS.has(name.toLowerCase())) {
      headers.set(name, value)
    }
  }
  return headers
}
