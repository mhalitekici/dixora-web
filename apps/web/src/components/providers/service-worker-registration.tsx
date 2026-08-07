"use client"

import { useEffect } from "react"

export interface ServiceWorkerRegistrationProps {
  scriptUrl?: string
  enabled?: boolean
  onRegistered?: (registration: ServiceWorkerRegistration) => void
  onError?: (error: unknown) => void
}

export function ServiceWorkerRegistration({
  scriptUrl = "/sw.js",
  enabled = process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_ENABLE_SERVICE_WORKER !== "false",
  onRegistered,
  onError,
}: ServiceWorkerRegistrationProps) {
  useEffect(() => {
    if (!enabled || !("serviceWorker" in navigator)) {
      return
    }

    let disposed = false

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register(scriptUrl, {
          scope: "/",
        })
        if (!disposed) {
          onRegistered?.(registration)
        }
      } catch (error) {
        if (!disposed) {
          onError?.(error)
        }
      }
    }

    const handleLoad = () => {
      void register()
    }

    if (document.readyState === "complete") {
      void register()
    } else {
      window.addEventListener("load", handleLoad, { once: true })
    }

    return () => {
      disposed = true
      window.removeEventListener("load", handleLoad)
    }
  }, [enabled, onError, onRegistered, scriptUrl])

  return null
}
