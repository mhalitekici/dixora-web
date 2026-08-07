import "server-only"

import { cookies } from "next/headers"

export const ACCESS_TOKEN_COOKIE = "dixora_access"
export const REFRESH_TOKEN_COOKIE = "dixora_refresh"
export const TRUSTED_DEVICE_COOKIE = "dixora_trusted_device"

const DEFAULT_ACCESS_MAX_AGE_SECONDS = 15 * 60
const DEFAULT_REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

export interface StoredAuthTokens {
  accessToken: string | null
  refreshToken: string | null
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
  refreshExpiresIn: number
  rememberMe: boolean
}

export interface TrustedDeviceCredential {
  token: string
  expiresIn: number
}

export async function readAuthCookies(): Promise<StoredAuthTokens> {
  const cookieStore = await cookies()
  return {
    accessToken: cookieStore.get(ACCESS_TOKEN_COOKIE)?.value ?? null,
    refreshToken: cookieStore.get(REFRESH_TOKEN_COOKIE)?.value ?? null,
  }
}

export async function setAuthCookies(tokens: AuthTokens): Promise<void> {
  const cookieStore = await cookies()
  const secure = shouldUseSecureCookies()
  const domain = readCookieDomain()
  const shared = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    priority: "high" as const,
    ...(domain ? { domain } : {}),
  }

  cookieStore.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...shared,
    ...(tokens.rememberMe
      ? {
          maxAge: clampLifetime(
            tokens.expiresIn,
            DEFAULT_ACCESS_MAX_AGE_SECONDS,
          ),
        }
      : {}),
  })
  cookieStore.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...shared,
    ...(tokens.rememberMe
      ? {
          maxAge: persistentRefreshLifetime(tokens.refreshExpiresIn),
        }
      : {}),
  })
}

export async function clearAuthCookies(): Promise<void> {
  const cookieStore = await cookies()
  const secure = shouldUseSecureCookies()
  const domain = readCookieDomain()
  const shared = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  }

  // Always expire the host-only cookies. Older deployments did not set a
  // Domain attribute, so deleting only the currently configured domain would
  // leave those credentials active and the auth proxy would immediately send
  // the user back from /login to their workspace.
  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
    cookieStore.set(name, "", shared)

    // Also expire the domain-scoped variant used by production deployments.
    // A browser may hold both variants at once after a configuration change.
    if (domain) {
      cookieStore.set(name, "", { ...shared, domain })
    }
  }
}

export async function setTrustedDeviceCookie(
  credential: TrustedDeviceCredential,
): Promise<void> {
  const cookieStore = await cookies()

  // Remove the legacy root-scoped cookie before issuing the narrower credential.
  cookieStore.set(TRUSTED_DEVICE_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  })
  cookieStore.set(TRUSTED_DEVICE_COOKIE, credential.token, {
    httpOnly: true,
    sameSite: "strict",
    secure: shouldUseSecureCookies(),
    path: "/api/auth",
    maxAge: clampLifetime(credential.expiresIn, 180 * 24 * 60 * 60),
    priority: "high",
  })
}

export async function clearTrustedDeviceCookie(): Promise<void> {
  const cookieStore = await cookies()
  const options = {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: shouldUseSecureCookies(),
    maxAge: 0,
    expires: new Date(0),
  }

  cookieStore.set(TRUSTED_DEVICE_COOKIE, "", {
    ...options,
    path: "/api/auth",
  })
  cookieStore.set(TRUSTED_DEVICE_COOKIE, "", {
    ...options,
    path: "/",
  })
}

function persistentRefreshLifetime(refreshExpiresIn: number): number {
  const backendLifetime = clampLifetime(
    refreshExpiresIn,
    DEFAULT_REFRESH_MAX_AGE_SECONDS,
  )
  const configuredMaximum = readPositiveInteger(
    process.env.AUTH_REFRESH_COOKIE_MAX_AGE_SECONDS,
  )
  return configuredMaximum
    ? Math.min(backendLifetime, configuredMaximum)
    : backendLifetime
}

function clampLifetime(value: number | undefined, fallback: number): number {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return Math.max(1, Math.floor(value))
}

function readPositiveInteger(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function readCookieDomain(): string | undefined {
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim()
  if (!domain) return undefined

  if (
    domain.includes("://") ||
    domain.includes("/") ||
    domain.includes(":") ||
    /\s/.test(domain)
  ) {
    return undefined
  }

  return domain
}

function shouldUseSecureCookies(): boolean {
  const configured = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase()
  if (configured === "true") return true
  if (configured === "false") return false
  return process.env.NODE_ENV === "production"
}
