import { NextRequest } from "next/server"

import { authenticatedBackendFetch } from "@/lib/server/auth-session"
import { backendFetch } from "@/lib/server/backend"
import { isPublicBackendRequest } from "@/lib/server/backend-route-policy"
import { readLoyaltyToken } from "@/lib/server/loyalty-cookie"
import { mutationOriginError } from "@/lib/server/request-security"
import {
  apiErrorResponse,
  backendResponse,
  requestFailureResponse,
} from "@/lib/server/responses"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024

interface RouteContext {
  params: Promise<{ path: string[] }>
}

const REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-type",
  "if-match",
  "if-none-match",
  "idempotency-key",
  "range",
  "user-agent",
  "x-idempotency-key",
  "x-request-id",
])

const SENSITIVE_AUTH_PATHS = new Set([
  "auth/login",
  "auth/logout",
  "auth/pin-login",
  "auth/refresh",
])

async function proxy(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const originError = mutationOriginError(request)
  if (originError) {
    return originError
  }

  const { path } = await context.params
  const validatedPath = validatePath(path)
  if (!validatedPath) {
    return apiErrorResponse(400, "invalid_path", "Geçersiz API yolu.")
  }

  if (SENSITIVE_AUTH_PATHS.has(validatedPath.toLowerCase())) {
    return apiErrorResponse(
      404,
      "not_found",
      "İstenen API kaynağı bulunamadı.",
    )
  }

  try {
    const headers = copyRequestHeaders(request.headers)
    if (!headers.has("x-request-id")) {
      headers.set("x-request-id", crypto.randomUUID())
    }
    if (isLoyaltyAwarePublicPath(validatedPath)) {
      const loyaltyToken = await readLoyaltyToken(
        loyaltyBusinessSlug(validatedPath),
      )
      if (loyaltyToken) headers.set("x-loyalty-token", loyaltyToken)
    }

    const declaredLength = Number.parseInt(
      request.headers.get("content-length") ?? "0",
      10,
    )
    const maxBodyBytes = getMaxBodyBytes()
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
      return apiErrorResponse(
        413,
        "payload_too_large",
        "Gönderilen veri izin verilen boyutu aşıyor.",
      )
    }

    const body =
      request.method === "GET" || request.method === "HEAD" || !request.body
        ? undefined
        : await request.arrayBuffer()
    if (body && body.byteLength > maxBodyBytes) {
      return apiErrorResponse(
        413,
        "payload_too_large",
        "Gönderilen veri izin verilen boyutu aşıyor.",
      )
    }

    const init = {
      body,
      headers,
      method: request.method,
      signal: request.signal,
    } satisfies RequestInit
    const response = isPublicBackendRequest(validatedPath, request.method)
      ? await backendFetch(validatedPath, init, request.nextUrl.searchParams)
      : await authenticatedBackendFetch(
          validatedPath,
          init,
          request.nextUrl.searchParams,
        )

    return backendResponse(response)
  } catch (error) {
    return requestFailureResponse(error)
  }
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
export const HEAD = proxy

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
      "cache-control": "no-store",
    },
  })
}

function validatePath(segments: readonly string[]): string | null {
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\") ||
        segment.includes("\0"),
    )
  ) {
    return null
  }

  return segments.join("/")
}

function copyRequestHeaders(input: Headers): Headers {
  const headers = new Headers()
  for (const [name, value] of input.entries()) {
    if (REQUEST_HEADERS.has(name.toLowerCase())) {
      headers.set(name, value)
    }
  }

  headers.delete("authorization")
  headers.delete("cookie")
  headers.delete("x-tenant-id")
  headers.delete("x-user-id")
  return headers
}

function isLoyaltyAwarePublicPath(path: string): boolean {
  const normalized = path.toLowerCase()
  return (
    normalized.startsWith("loyalty/public/") ||
    (normalized.startsWith("qr/public/") && normalized.endsWith("/requests"))
  )
}

function loyaltyBusinessSlug(path: string): string | undefined {
  const segments = path.split("/")
  if (
    segments.length >= 3 &&
    ((segments[0] === "loyalty" && segments[1] === "public") ||
      (segments[0] === "qr" && segments[1] === "public"))
  ) {
    return segments[2]
  }
  return undefined
}

function getMaxBodyBytes(): number {
  const configured = Number.parseInt(process.env.BFF_MAX_BODY_BYTES ?? "", 10)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_BODY_BYTES
}
