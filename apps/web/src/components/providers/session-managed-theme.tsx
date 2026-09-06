"use client"

import { ManagedThemeScope } from "@/components/providers/managed-theme-scope"
import { useCurrentUser } from "@/hooks/use-auth"
import { asManagedThemeMode } from "@/stores/managed-theme-store"

/**
 * Pins the staff screens to whatever the business chose, read off the session.
 *
 * The waiter and cashier panels are already authenticated, so the theme arrives
 * with `/auth/me` rather than needing a request of its own. Until it does, the
 * pre-paint script has usually applied the value the last load stored on this
 * device — so the only load that can flash is the very first one on a new phone.
 */
export function SessionManagedTheme() {
  const currentUser = useCurrentUser()
  return (
    <ManagedThemeScope
      mode={asManagedThemeMode(currentUser.data?.tenant?.themeMode)}
      persist
    />
  )
}
