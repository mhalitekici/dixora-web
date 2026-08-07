"use client"

import {
  useMutation,
  useQueryClient,
  type MutationFunctionContext,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query"

import { api, type ApiRequestOptions } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import type { HttpMethod } from "@/lib/api/types"

type MutationInvalidation<TData, TVariables> =
  | readonly QueryKey[]
  | ((
      data: TData,
      variables: TVariables,
    ) => readonly QueryKey[] | Promise<readonly QueryKey[]>)

export type ApiMutationOptions<TData, TVariables, TContext = unknown> = Omit<
  UseMutationOptions<TData, ApiError, TVariables, TContext>,
  "mutationFn"
> & {
  path: string | ((variables: TVariables) => string)
  method?: Exclude<HttpMethod, "GET">
  body?: (variables: TVariables) => unknown
  request?: Omit<ApiRequestOptions, "body" | "method" | "signal">
  invalidates?: MutationInvalidation<TData, TVariables>
}

export function useApiMutation<
  TData,
  TVariables = void,
  TContext = unknown,
>({
  path,
  method = "POST",
  body,
  request,
  invalidates,
  onSuccess,
  ...options
}: ApiMutationOptions<
  TData,
  TVariables,
  TContext
>): UseMutationResult<TData, ApiError, TVariables, TContext> {
  const queryClient = useQueryClient()

  return useMutation({
    ...options,
    mutationFn: (variables) => {
      const resolvedPath =
        typeof path === "function" ? path(variables) : path
      const payload = body ? body(variables) : variables

      switch (method) {
        case "POST":
          return api.post<TData>(resolvedPath, payload, request)
        case "PUT":
          return api.put<TData>(resolvedPath, payload, request)
        case "PATCH":
          return api.patch<TData>(resolvedPath, payload, request)
        case "DELETE":
          return api.delete<TData>(resolvedPath, request)
      }
    },
    onSuccess: async (
      data: TData,
      variables: TVariables,
      onMutateResult: TContext,
      context: MutationFunctionContext,
    ) => {
      const keys =
        typeof invalidates === "function"
          ? await invalidates(data, variables)
          : invalidates

      if (keys) {
        await Promise.all(
          keys.map((queryKey) =>
            queryClient.invalidateQueries({ queryKey }),
          ),
        )
      }

      await onSuccess?.(data, variables, onMutateResult, context)
    },
  })
}
