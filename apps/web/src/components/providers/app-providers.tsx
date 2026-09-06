"use client"

import type { PropsWithChildren } from "react"

import { QueryProvider } from "@/components/providers/query-provider"
import { RealtimeSync } from "@/components/providers/realtime-sync"
import { ServiceWorkerRegistration } from "@/components/providers/service-worker-registration"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  forcedThemeFor,
  useManagedThemeStore,
} from "@/stores/managed-theme-store"

export function AppProviders({ children }: PropsWithChildren) {
  // next-themes ignores a nested provider, so a business-pinned theme has to be
  // forced from here. The store reports what the pre-paint script already
  // applied, so the very first client render agrees with the painted page and
  // nothing flickers back to the device preference.
  const managedMode = useManagedThemeStore((state) => state.mode)

  return (
    <ThemeProvider forcedTheme={forcedThemeFor(managedMode)}>
      <QueryProvider>
        <TooltipProvider>
          {children}
          <Toaster
            closeButton
            position="top-right"
            richColors
            visibleToasts={4}
          />
          <RealtimeSync />
          <ServiceWorkerRegistration />
        </TooltipProvider>
      </QueryProvider>
    </ThemeProvider>
  )
}
