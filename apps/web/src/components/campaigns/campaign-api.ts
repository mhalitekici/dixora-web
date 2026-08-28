import { api } from "@/lib/api"

export type CampaignRewardKind = "FREE_ITEM" | "PERCENT" | "AMOUNT"
export type CampaignAudience = "MEMBERS_ONLY"

export type Campaign = {
  id: string
  name: string
  description: string | null
  is_active: boolean
  branch_ids: string[]
  buy_product_id: string | null
  buy_category_id: string | null
  buy_quantity: number
  minimum_order_amount: string
  reward_kind: CampaignRewardKind
  reward_product_id: string | null
  reward_category_id: string | null
  reward_quantity: number
  reward_value: string
  audience: CampaignAudience
  max_uses_per_order: number
  starts_at: string | null
  ends_at: string | null
  version: number
  /** Server-worded one-liner, so every screen phrases the offer identically. */
  summary: string
}

export type CampaignInput = {
  name: string
  description: string | null
  is_active: boolean
  branch_ids: string[]
  buy_product_id: string | null
  buy_category_id: string | null
  buy_quantity: number
  minimum_order_amount: string
  reward_kind: CampaignRewardKind
  reward_product_id: string | null
  reward_category_id: string | null
  reward_quantity: number
  reward_value: string
  audience: CampaignAudience
  max_uses_per_order: number
  starts_at: string | null
  ends_at: string | null
  expected_version?: number
}

export type CampaignGrant = {
  campaign_id: string
  campaign_name: string
  order_item_id: string
  product_name: string
  amount: string
}

export type CampaignApplyResult = {
  order_id: string
  granted: CampaignGrant[]
  total_discount: string
  order_total: string
  /** A members-only offer matched but no member code was attached. */
  skipped_members_only: boolean
}

export const campaignKeys = {
  root: ["campaigns"] as const,
  list: () => ["campaigns", "list"] as const,
}

export const campaignApi = {
  list: (signal?: AbortSignal) => api.get<Campaign[]>("campaigns", { signal }),
  create: (input: CampaignInput) => api.post<Campaign>("campaigns", input),
  update: (id: string, input: CampaignInput) =>
    api.put<Campaign>(`campaigns/${id}`, input),
  deactivate: (id: string) => api.delete<void>(`campaigns/${id}`),
  applyToOrder: (orderId: string) =>
    api.post<CampaignApplyResult>(`campaigns/orders/${orderId}/apply`, {}),
}

export const REWARD_KIND_LABELS: Record<CampaignRewardKind, string> = {
  FREE_ITEM: "Ürün ikram",
  PERCENT: "Yüzde indirim",
  AMOUNT: "Tutar indirimi",
}

export const AUDIENCE_LABELS: Record<CampaignAudience, string> = {
  MEMBERS_ONLY: "Sadakat üyelerine",
}
