"use client"

import {
  useQuery,
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query"

import { api, type ApiRequestOptions } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"

export type ApiQueryOptions<TQueryData, TData = TQueryData> = Omit<
  UseQueryOptions<TQueryData, ApiError, TData, QueryKey>,
  "queryFn" | "queryKey"
> & {
  path: string
  queryKey: QueryKey
  request?: Omit<ApiRequestOptions, "body" | "method" | "signal">
}

export function useApiQuery<TQueryData, TData = TQueryData>({
  path,
  queryKey,
  request,
  ...options
}: ApiQueryOptions<TQueryData, TData>): UseQueryResult<TData, ApiError> {
  return useQuery({
    ...options,
    queryKey,
    queryFn: ({ signal }) =>
      api.get<TQueryData>(path, {
        ...request,
        signal,
      }),
  })
}
