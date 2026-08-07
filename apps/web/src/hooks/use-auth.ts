"use client"

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query"

import { authApi } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import { queryKeys } from "@/lib/api/query-keys"
import { BRANCH_SWITCHED_EVENT } from "@/lib/auth-events"
import type {
  AccessibleBranches,
  AuthContext,
  LoginInput,
  LoginResult,
  RefreshResult,
  SwitchBranchInput,
} from "@/lib/api/types"
import { useCartStore } from "@/stores/cart-store"
import { useUiStore } from "@/stores/ui-store"

export function useCurrentUser(
  options: Omit<
    UseQueryOptions<AuthContext, ApiError>,
    "queryFn" | "queryKey"
  > = {},
) {
  return useQuery({
    staleTime: 60_000,
    retry: (failureCount, error) =>
      error.status >= 500 && failureCount < 2,
    ...options,
    queryKey: queryKeys.auth.me,
    queryFn: ({ signal }) => authApi.me(signal),
  })
}

export function useLogin(
  options: Omit<
    UseMutationOptions<LoginResult, ApiError, LoginInput>,
    "mutationFn"
  > = {},
) {
  const queryClient = useQueryClient()
  const { onSuccess, ...rest } = options

  return useMutation({
    ...rest,
    mutationFn: (input) => authApi.login(input),
    onSuccess: async (...args) => {
      await queryClient.cancelQueries()
      queryClient.clear()
      useCartStore.getState().clear()
      useUiStore.getState().reset()
      await onSuccess?.(...args)
    },
  })
}

export function useRefreshSession(
  options: Omit<
    UseMutationOptions<RefreshResult, ApiError, void>,
    "mutationFn"
  > = {},
) {
  const queryClient = useQueryClient()
  const { onSuccess, ...rest } = options

  return useMutation({
    ...rest,
    mutationFn: () => authApi.refresh(),
    onSuccess: async (...args) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
      await onSuccess?.(...args)
    },
  })
}

export function useAccessibleBranches(
  options: Omit<
    UseQueryOptions<AccessibleBranches, ApiError>,
    "queryFn" | "queryKey"
  > = {},
) {
  return useQuery({
    staleTime: 30_000,
    retry: (failureCount, error) => error.status >= 500 && failureCount < 2,
    ...options,
    queryKey: queryKeys.auth.branches,
    queryFn: ({ signal }) => authApi.branches(signal),
  })
}

export function useSwitchBranch(
  options: Omit<
    UseMutationOptions<AuthContext, ApiError, SwitchBranchInput>,
    "mutationFn"
  > = {},
) {
  const queryClient = useQueryClient()
  const { onSuccess, ...rest } = options

  return useMutation({
    ...rest,
    mutationFn: (input) => authApi.switchBranch(input),
    onSuccess: async (...args) => {
      const context = args[0]
      await queryClient.cancelQueries()
      queryClient.clear()
      useCartStore.getState().clear()
      useUiStore.getState().reset()
      queryClient.setQueryData(queryKeys.auth.me, context)
      window.dispatchEvent(new Event(BRANCH_SWITCHED_EVENT))
      await onSuccess?.(...args)
    },
  })
}

export function useLogout(
  options: Omit<
    UseMutationOptions<void, ApiError, void>,
    "mutationFn"
  > = {},
) {
  const queryClient = useQueryClient()
  const { onSettled, ...rest } = options

  return useMutation({
    ...rest,
    mutationFn: () => authApi.logout(),
    onSettled: async (...args) => {
      // Shells perform a hard navigation after logout. Run that navigation
      // before touching the active query cache: clearing it while a protected
      // page is still mounted can make that page render without required data
      // and trip the route error boundary before the redirect takes effect.
      if (onSettled) {
        await onSettled(...args)
        return
      }

      await queryClient.cancelQueries()
      queryClient.clear()
      useCartStore.getState().clear()
      useUiStore.getState().reset()
    },
  })
}
