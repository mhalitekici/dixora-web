"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { loyaltyApi } from "./loyalty-api"
import type { LoyaltyProgramInput } from "./types"

export const loyaltyKeys = {
  root: ["loyalty"] as const,
  program: ["loyalty", "program"] as const,
  customers: ["loyalty", "customers"] as const,
  rewards: ["loyalty", "rewards"] as const,
  order: (orderId: string) => ["loyalty", "order", orderId] as const,
  setup: ["loyalty", "setup-options"] as const,
  offer: (business: string, branch: string) =>
    ["loyalty", "public", "offer", business, branch] as const,
  status: (business: string, branch: string) =>
    ["loyalty", "public", "status", business, branch] as const,
}

export function useLoyaltyProgram() {
  return useQuery({
    queryKey: loyaltyKeys.program,
    queryFn: ({ signal }) => loyaltyApi.program(signal),
  })
}

export function useLoyaltySetupOptions() {
  return useQuery({
    queryKey: loyaltyKeys.setup,
    queryFn: ({ signal }) => loyaltyApi.setupOptions(signal),
    staleTime: 60_000,
  })
}

export function useUpdateLoyaltyProgram() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: LoyaltyProgramInput) => loyaltyApi.updateProgram(input),
    onSuccess: async (program) => {
      queryClient.setQueryData(loyaltyKeys.program, program)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: loyaltyKeys.customers }),
        queryClient.invalidateQueries({ queryKey: loyaltyKeys.rewards }),
        queryClient.invalidateQueries({ queryKey: ["loyalty", "public"] }),
      ])
    },
  })
}

export function useLoyaltyCustomers() {
  return useQuery({
    queryKey: loyaltyKeys.customers,
    queryFn: ({ signal }) => loyaltyApi.customers(signal),
  })
}

export function useLoyaltyRewards() {
  return useQuery({
    queryKey: loyaltyKeys.rewards,
    queryFn: ({ signal }) => loyaltyApi.rewards(signal),
  })
}

export function useOrderLoyaltyContext(orderId: string | null) {
  return useQuery({
    queryKey: loyaltyKeys.order(orderId ?? "none"),
    queryFn: ({ signal }) => loyaltyApi.orderContext(orderId as string, signal),
    enabled: Boolean(orderId),
    retry: false,
  })
}

export function usePublicLoyaltyOffer(business: string, branch: string) {
  return useQuery({
    queryKey: loyaltyKeys.offer(business, branch),
    queryFn: ({ signal }) => loyaltyApi.offer(business, branch, signal),
    staleTime: 30_000,
    retry: false,
  })
}

export function usePublicLoyaltyStatus(
  business: string,
  branch: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: loyaltyKeys.status(business, branch),
    queryFn: ({ signal }) => loyaltyApi.status(business, branch, signal),
    enabled,
    retry: false,
    staleTime: 15_000,
    refetchInterval: enabled ? 30_000 : false,
    refetchIntervalInBackground: false,
  })
}
