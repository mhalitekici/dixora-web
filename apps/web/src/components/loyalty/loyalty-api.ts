import { api } from "@/lib/api"

import type {
  LoyaltyAdminReward,
  LoyaltyCustomer,
  LoyaltyEnrollment,
  LoyaltyOrderContext,
  LoyaltyProgram,
  LoyaltyProgramInput,
  LoyaltyPublicOffer,
  LoyaltyPublicStatus,
  LoyaltyRedemption,
  LoyaltySetupOptions,
  LoyaltyVerification,
} from "./types"

export const loyaltyApi = {
  async setupOptions(signal?: AbortSignal): Promise<LoyaltySetupOptions> {
    const [branches, products, categories] = await Promise.all([
      api.get<Array<{ id: string; name: string; is_active: boolean }>>("branches", {
        signal,
      }),
      api.get<{ items: Array<{ id: string; name: string }> }>("catalog/products", {
        search: { include_inactive: false, limit: 250 },
        signal,
      }),
      api.get<{ items: Array<{ id: string; name: string }> }>("catalog/categories", {
        search: { include_inactive: false, limit: 250 },
        signal,
      }),
    ])
    return {
      branches: branches.filter((branch) => branch.is_active),
      products: products.items,
      categories: categories.items,
    }
  },
  program: (signal?: AbortSignal) =>
    api.get<LoyaltyProgram | null>("loyalty/program", { signal }),
  updateProgram: (input: LoyaltyProgramInput) =>
    api.put<LoyaltyProgram>("loyalty/program", input),
  customers: (signal?: AbortSignal) =>
    api.get<LoyaltyCustomer[]>("loyalty/customers", { signal }),
  rewards: (signal?: AbortSignal) =>
    api.get<LoyaltyAdminReward[]>("loyalty/rewards", { signal }),
  orderContext: (orderId: string, signal?: AbortSignal) =>
    api.get<LoyaltyOrderContext>(`loyalty/orders/${segment(orderId)}/context`, {
      signal,
    }),
  attachMembership: (orderId: string, membershipCode: string) =>
    api.post<{ order_id: string; membership_code: string; program_name: string }>(
      `loyalty/orders/${segment(orderId)}/membership`,
      { membership_code: membershipCode },
    ),
  redeemReward: (
    redemptionCode: string,
    input: { order_id: string; order_item_id: string; idempotency_key: string },
  ) =>
    api.post<LoyaltyRedemption>(
      `loyalty/rewards/${segment(redemptionCode)}/redeem`,
      input,
    ),
  offer: (businessSlug: string, branchSlug: string, signal?: AbortSignal) =>
    api.get<LoyaltyPublicOffer>(
      `loyalty/public/${segment(businessSlug)}/${segment(branchSlug)}/offer`,
      { signal },
    ),
  verificationStart: (
    businessSlug: string,
    branchSlug: string,
    input: { phone: string; consent_accepted: true },
  ) =>
    api.post<LoyaltyVerification>(
      `loyalty/public/${segment(businessSlug)}/${segment(branchSlug)}/verification/start`,
      input,
    ),
  async status(
    businessSlug: string,
    branchSlug: string,
    signal?: AbortSignal,
  ): Promise<LoyaltyPublicStatus | null> {
    const response = await fetch(
      `/api/public-loyalty/${segment(businessSlug)}/${segment(branchSlug)}/status`,
      {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
      },
    )
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null
      throw new Error(body?.error?.message ?? "Sadakat durumu alÄ±namadÄ±.")
    }
    return (await response.json()) as LoyaltyPublicStatus | null
  },
  async enroll(
    businessSlug: string,
    branchSlug: string,
    input: {
      phone: string
      verification_token: string
      verification_code: string
      consent_accepted: true
      consent_text_version: string
      referral_code: string | null
    },
  ): Promise<LoyaltyEnrollment> {
    const response = await fetch(
      `/api/public-loyalty/${segment(businessSlug)}/${segment(branchSlug)}/enroll`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    )
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null
      throw new Error(body?.error?.message ?? "Sadakat kaydı tamamlanamadı.")
    }
    return (await response.json()) as LoyaltyEnrollment
  },
  async forget(businessSlug: string): Promise<void> {
    const response = await fetch(`/api/public-loyalty/${encodeURIComponent(businessSlug)}/forget`, {
      method: "POST",
      credentials: "same-origin",
    })
    if (!response.ok) throw new Error("Sadakat oturumu kapatılamadı.")
  },
}

function segment(value: string): string {
  return encodeURIComponent(value)
}
