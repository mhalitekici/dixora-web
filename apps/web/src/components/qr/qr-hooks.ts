"use client"

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { qrApi } from "@/components/qr/qr-api"
import type {
  PublicBillRequestCreate,
  QrConfigInput,
  QrRequestCreate,
  QrRequestStatus,
} from "@/components/qr/types"
import { queryKeys } from "@/lib/api"

export const qrQueryKeys = {
  config: ["qr-menu", "config"] as const,
  requests: (status: QrRequestStatus | "ALL" = "ALL") =>
    ["qr-menu", "requests", status] as const,
  tables: ["tables", "qr-codes"] as const,
  products: ["catalog", "products", "qr-request-lookup"] as const,
}

export function usePublicQrMenu(
  businessSlug: string,
  branchSlug: string,
  tableToken?: string | null,
  lang?: string,
) {
  return useQuery({
    queryKey: [
      ...queryKeys.qrMenu.publicMenu(businessSlug, branchSlug),
      { tableToken: tableToken ?? null, lang: lang ?? "tr" },
    ],
    queryFn: ({ signal }) =>
      qrApi.publicMenu(businessSlug, branchSlug, tableToken, signal, lang),
    retry: (failureCount, error) =>
      "status" in error &&
      typeof error.status === "number" &&
      error.status >= 500 &&
      failureCount < 2,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  })
}

export function useCreatePublicQrRequest(
  businessSlug: string,
  branchSlug: string,
) {
  return useMutation({
    mutationFn: (payload: QrRequestCreate) =>
      qrApi.createPublicRequest(businessSlug, branchSlug, payload),
  })
}

export function useCreatePublicBillRequest(
  businessSlug: string,
  branchSlug: string,
) {
  return useMutation({
    mutationFn: (payload: PublicBillRequestCreate) =>
      qrApi.createPublicBillRequest(businessSlug, branchSlug, payload),
  })
}

export function useQrConfig() {
  return useQuery({
    queryKey: qrQueryKeys.config,
    queryFn: ({ signal }) => qrApi.config(signal),
    retry: (failureCount, error) =>
      "status" in error &&
      typeof error.status === "number" &&
      error.status >= 500 &&
      failureCount < 2,
    staleTime: 30_000,
  })
}

export function useUpdateQrConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: QrConfigInput) => qrApi.updateConfig(payload),
    onSuccess: async (config, variables) => {
      queryClient.setQueryData(qrQueryKeys.config, {
        ...config,
        ...variables,
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.qrMenu.all })
    },
  })
}

export function useUploadQrAsset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      assetKind,
      file,
    }: {
      assetKind: "logo" | "cover"
      file: File
    }) => qrApi.uploadAsset(assetKind, file),
    onSuccess: async (config) => {
      queryClient.setQueryData(qrQueryKeys.config, config)
      await queryClient.invalidateQueries({ queryKey: queryKeys.qrMenu.all })
    },
  })
}

export function useDeleteQrAsset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (assetKind: "logo" | "cover") =>
      qrApi.deleteAsset(assetKind),
    onSuccess: async (_, assetKind) => {
      queryClient.setQueryData(qrQueryKeys.config, (current: unknown) => {
        if (!current || typeof current !== "object") return current
        return {
          ...current,
          [assetKind === "logo" ? "logo_url" : "cover_image_url"]: null,
        }
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.qrMenu.all })
    },
  })
}

export function useQrRequests(
  status: QrRequestStatus | "ALL" = "ALL",
) {
  return useQuery({
    queryKey: qrQueryKeys.requests(status),
    queryFn: ({ signal }) => qrApi.requests(status, signal),
    refetchInterval: status === "PENDING" || status === "ALL" ? 15_000 : false,
    staleTime: 5_000,
  })
}

export function useApproveQrRequest() {
  return useQrRequestAction(qrApi.approve)
}

export function useRejectQrRequest() {
  return useQrRequestAction(qrApi.reject)
}

export function useQrTables() {
  return useQuery({
    queryKey: qrQueryKeys.tables,
    queryFn: ({ signal }) => qrApi.tables(signal),
    staleTime: 30_000,
  })
}

export function useRegenerateTableToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tableId: string) => qrApi.regenerateTableToken(tableId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qrQueryKeys.tables })
    },
  })
}

export function useQrAdminProducts() {
  return useQuery({
    queryKey: qrQueryKeys.products,
    queryFn: ({ signal }) => qrApi.products(signal),
    staleTime: 60_000,
  })
}

function useQrRequestAction(
  action: (requestId: string) => ReturnType<typeof qrApi.approve>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: action,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["qr-menu", "requests"],
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.orders.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tables.all }),
      ])
    },
  })
}
