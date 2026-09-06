import "server-only"

import { backendFetch } from "@/lib/server/backend"
import {
  asManagedThemeMode,
  type ManagedThemeMode,
} from "@/stores/managed-theme-store"

/**
 * The theme a business pins for its public menu, fetched before the page paints.
 *
 * Deliberately its own tiny request rather than a slice of the menu payload:
 * the menu is loaded by the client after hydration, which is far too late to
 * decide a colour scheme without the guest watching it change.
 *
 * `backendFetch` already pins `cache: "no-store"`, so switching the theme takes
 * effect on the guest's next load rather than whenever a cache entry expires.
 *
 * Never throws. A slow or unreachable API must still render a menu shell, and
 * the device's own preference is the right thing to fall back to.
 */
export async function readPublicThemeMode(
  businessSlug: string,
): Promise<ManagedThemeMode | null> {
  try {
    const response = await backendFetch(
      `qr/public/${businessSlug}/appearance`,
      { headers: { accept: "application/json" } },
    )
    if (!response.ok) {
      return null
    }
    const body: unknown = await response.json()
    if (!body || typeof body !== "object") {
      return null
    }
    return asManagedThemeMode((body as { theme_mode?: unknown }).theme_mode)
  } catch {
    return null
  }
}
