import "server-only"

import {
  clearAuthCookies,
  type AuthTokens,
  readAuthCookies,
  setAuthCookies,
} from "@/lib/server/auth-cookies"
import { backendFetch } from "@/lib/server/backend"

interface RefreshSuccess {
  ok: true
  tokens: AuthTokens
  body: unknown
}

interface RefreshFailure {
  ok: false
  status: number
  body: unknown
  requestId?: string
  retryAfter?: string
}

export type RefreshOutcome = RefreshSuccess | RefreshFailure

interface RefreshFlight {
  promise: Promise<RefreshOutcome>
  cleanupTimer?: ReturnType<typeof setTimeout>
}

const refreshFlights = new Map<string, RefreshFlight>()
const REFRESH_DEDUPE_GRACE_MS = 2_000

export async function refreshSession(
  refreshToken: string,
): Promise<RefreshOutcome> {
  const existing = refreshFlights.get(refreshToken)
  if (existing) {
    return existing.promise
  }

  const flight: RefreshFlight = {
    promise: performRefresh(refreshToken),
  }
  refreshFlights.set(refreshToken, flight)

  const scheduleCleanup = () => {
    flight.cleanupTimer = setTimeout(() => {
      if (refreshFlights.get(refreshToken) === flight) {
        refreshFlights.delete(refreshToken)
      }
    }, REFRESH_DEDUPE_GRACE_MS)
  }
  void flight.promise.then(scheduleCleanup, scheduleCleanup)

  return flight.promise
}

export async function authenticatedBackendFetch(
  path: string,
  init: RequestInit = {},
  search?: URLSearchParams,
): Promise<Response> {
  const { accessToken, refreshToken } = await readAuthCookies()
  const firstResponse = await backendFetch(
    path,
    withBearerToken(init, accessToken),
    search,
  )

  if (firstResponse.status !== 401 || !refreshToken) {
    if (firstResponse.status === 401 && !refreshToken) {
      await clearAuthCookies()
    }
    return firstResponse
  }

  await firstResponse.body?.cancel()
  const refresh = await refreshSession(refreshToken)
  if (!refresh.ok) {
    if (refresh.status === 401 || refresh.status === 403) {
      await clearAuthCookies()
    }
    return refreshFailureResponse(refresh)
  }

  await setAuthCookies(refresh.tokens)
  const retryResponse = await backendFetch(
    path,
    withBearerToken(init, refresh.tokens.accessToken),
    search,
  )
  if (retryResponse.status === 401) {
    await clearAuthCookies()
  }
  return retryResponse
}

export function parseAuthTokens(body: unknown): AuthTokens | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null
  }

  const record = body as Record<string, unknown>
  const accessToken = readString(record, "access_token", "accessToken")
  const refreshToken = readString(record, "refresh_token", "refreshToken")
  const expiresIn = readNumber(record, "expires_in", "expiresIn")
  const refreshExpiresIn = readNumber(
    record,
    "refresh_expires_in",
    "refreshExpiresIn",
  )
  const rememberMe = readBoolean(record, "remember_me", "rememberMe") ?? false

  if (!accessToken || !refreshToken || !expiresIn || !refreshExpiresIn) {
    return null
  }

  return {
    accessToken,
    refreshToken,
    expiresIn,
    refreshExpiresIn,
    rememberMe,
  }
}

function withBearerToken(
  init: RequestInit,
  accessToken: string | null,
): RequestInit {
  const headers = new Headers(init.headers)
  headers.delete("cookie")
  headers.delete("x-tenant-id")
  headers.delete("x-user-id")

  if (accessToken) {
    headers.set("authorization", `Bearer ${accessToken}`)
  } else {
    headers.delete("authorization")
  }

  return { ...init, headers }
}

async function performRefresh(
  refreshToken: string,
): Promise<RefreshOutcome> {
  const response = await backendFetch("auth/refresh", {
    body: JSON.stringify({ refresh_token: refreshToken }),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "POST",
  })

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      body,
      requestId: response.headers.get("x-request-id") ?? undefined,
      retryAfter: response.headers.get("retry-after") ?? undefined,
    }
  }

  const tokens = parseAuthTokens(body)
  if (!tokens) {
    return {
      ok: false,
      status: 502,
      body: {
        error: {
          code: "invalid_auth_response",
          message: "Kimlik sunucusundan geçersiz yanıt alındı.",
        },
      },
    }
  }

  return { ok: true, tokens, body }
}

function refreshFailureResponse(failure: RefreshFailure): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  })
  if (failure.requestId) {
    headers.set("x-request-id", failure.requestId)
  }
  if (failure.retryAfter) {
    headers.set("retry-after", failure.retryAfter)
  }

  return new Response(JSON.stringify(failure.body ?? {}), {
    status: failure.status,
    headers,
  })
}

function readString(
  record: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) {
      return value
    }
  }
  return undefined
}

function readNumber(
  record: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value
    }
  }
  return undefined
}

function readBoolean(
  record: Record<string, unknown>,
  ...keys: string[]
): boolean | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "boolean") {
      return value
    }
  }
  return undefined
}
