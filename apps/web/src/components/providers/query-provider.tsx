"use client"

import { QueryClient, QueryClientProvider, isServer } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import type { PropsWithChildren } from "react"

import { ApiError } from "@/lib/api/errors"

let browserQueryClient: QueryClient | undefined

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 30 * 60 * 1_000,
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
        retry: shouldRetry,
        staleTime: 30_000,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

export function getQueryClient(): QueryClient {
  if (isServer) {
    return createQueryClient()
  }

  browserQueryClient ??= createQueryClient()
  return browserQueryClient
}

export function QueryProvider({ children }: PropsWithChildren) {
  const queryClient = getQueryClient()

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" ? (
        <ReactQueryDevtools initialIsOpen={false} />
      ) : null}
    </QueryClientProvider>
  )
}

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) {
    return false
  }

  if (error instanceof ApiError) {
    if (error.status === 408 || error.status === 429) {
      return true
    }
    return error.status >= 500
  }

  return true
}
