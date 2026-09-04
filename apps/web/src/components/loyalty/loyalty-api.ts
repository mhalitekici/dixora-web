import { api } from "@/lib/api"

import type {
  CampaignApplyResult,
  LoyaltyAdminReward,
  LoyaltyCustomer,
  LoyaltyOrderContext,
  LoyaltyProgram,
  LoyaltyProgramInput,
  LoyaltyPublicOffer,
  LoyaltyRedemption,
  LoyaltySetupOptions,
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
  startEnrollment: (input: {
    first_name: string
    last_name: string
    email: string
    birth_date: string | null
  }) =>
    api.post<{
      verification_id: string
      email: string
      expires_in_seconds: number
      development_code: string | null
    }>("loyalty/enrollments/start", input),
  confirmEnrollment: (input: { verification_id: string; code: string }) =>
    api.post<{
      member_code: string
      display_name: string
      email: string
      program_name: string
      progress: string
      progress_target: number
      card_email_sent: boolean
    }>("loyalty/enrollments/confirm", input),
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
  /** One cashier action: attach the member and apply every earned campaign. */
  applyMemberCode: (
    orderId: string,
    input: { member_code: string; idempotency_key: string },
  ) =>
    api.post<CampaignApplyResult>(
      `loyalty/orders/${segment(orderId)}/apply-code`,
      input,
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
  publicEmailEnrollmentStart: (
    businessSlug: string,
    branchSlug: string,
    input: {
      first_name: string
      last_name: string
      email: string
      birth_date: string | null
      consent_accepted: true
    },
  ) =>
    api.post<{
      verification_id: string
      email: string
      expires_in_seconds: number
      development_code: string | null
    }>(
      `loyalty/public/${segment(businessSlug)}/${segment(branchSlug)}/email-enrollments/start`,
      input,
    ),
  publicEmailEnrollmentConfirm: (
    businessSlug: string,
    branchSlug: string,
    input: {
      verification_id: string
      code: string
    },
  ) =>
    api.post<{
      member_code: string
      display_name: string
      email: string
      program_name: string
      progress: string
      progress_target: number
      card_email_sent: boolean
    }>(
      `loyalty/public/${segment(businessSlug)}/${segment(branchSlug)}/email-enrollments/confirm`,
      input,
    ),
}

function segment(value: string): string {
  return encodeURIComponent(value)
}
