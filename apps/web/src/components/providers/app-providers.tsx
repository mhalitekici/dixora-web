"use client"

import type { PropsWithChildren } from "react"

import { QueryProvider } from "@/components/providers/query-provider"
import { RealtimeSync } from "@/components/providers/realtime-sync"
import { ServiceWorkerRegistration } from "@/components/providers/service-worker-registration"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ThemeProvider>
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
