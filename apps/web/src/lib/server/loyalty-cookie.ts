import "server-only"

import { createHash } from "node:crypto"
import { cookies } from "next/headers"

export const LOYALTY_TOKEN_COOKIE = "dixora_loyalty"
const LOYALTY_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60

export function loyaltyTokenCookieName(businessSlug?: string): string {
  if (!businessSlug) return LOYALTY_TOKEN_COOKIE
  const scope = createHash("sha256")
    .update(businessSlug.trim().toLowerCase())
    .digest("hex")
    .slice(0, 20)
  return `${LOYALTY_TOKEN_COOKIE}_${scope}`
}

export async function readLoyaltyToken(businessSlug?: string): Promise<string | null> {
  return (await cookies()).get(loyaltyTokenCookieName(businessSlug))?.value ?? null
}

export async function setLoyaltyToken(
  value: string,
  businessSlug?: string,
): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(loyaltyTokenCookieName(businessSlug), value, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: LOYALTY_COOKIE_MAX_AGE_SECONDS,
    priority: "high",
    ...(cookieDomain() ? { domain: cookieDomain() } : {}),
  })
}

export async function clearLoyaltyToken(businessSlug?: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(loyaltyTokenCookieName(businessSlug), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: 0,
    ...(cookieDomain() ? { domain: cookieDomain() } : {}),
  })
}

function cookieDomain(): string | undefined {
  return process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined
}

function shouldUseSecureCookies(): boolean {
  const configured = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase()
  if (configured === "true") return true
  if (configured === "false") return false
  return process.env.NODE_ENV === "production"
}
