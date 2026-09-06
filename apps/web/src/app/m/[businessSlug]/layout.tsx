import type { ReactNode } from "react"

import { ManagedThemeBootstrap } from "@/components/providers/managed-theme"
import { ManagedThemeScope } from "@/components/providers/managed-theme-scope"
import { readPublicThemeMode } from "@/lib/server/public-appearance"

/**
 * The QR menu shell, which settles the colour scheme before anything paints.
 *
 * The theme is read here rather than in the page because a guest on a dark-mode
 * phone must never watch a pinned-light menu load dark and then correct itself.
 * One small uncached request buys that, and it changes nothing for a business
 * that left the setting on "device".
 */
export default async function PublicMenuLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ businessSlug: string }>
}) {
  const { businessSlug } = await params
  const mode = await readPublicThemeMode(businessSlug)

  return (
    <>
      <ManagedThemeBootstrap mode={mode} />
      <ManagedThemeScope mode={mode} />
      {children}
    </>
  )
}
