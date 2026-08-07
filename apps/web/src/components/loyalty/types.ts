export type LoyaltyCampaignType = "VISIT_COUNT" | "PRODUCT_QUANTITY"
export type LoyaltyRewardStatus = "AVAILABLE" | "REDEEMED" | "REVERSED"

export type LoyaltyProgram = {
  id: string
  name: string
  is_active: boolean
  show_on_qr: boolean
  starts_at: string | null
  ends_at: string | null
  version: number
  branch_ids: string[]
  rule: {
    campaign_type: LoyaltyCampaignType
    threshold: number
    qualifying_product_id: string | null
    qualifying_category_id: string | null
    reward_product_id: string | null
    reward_category_id: string | null
    minimum_order_amount: string
    allow_multiple_same_day: boolean
    reward_same_order: boolean
  }
  stats: {
    active_customers: number
    available_rewards: number
    redeemed_rewards: number
  }
}

export type LoyaltyProgramInput = {
  name: string
  is_active: boolean
  show_on_qr: boolean
  campaign_type: LoyaltyCampaignType
  threshold: number
  branch_ids: string[]
  qualifying_product_id: string | null
  qualifying_category_id: string | null
  reward_product_id: string | null
  reward_category_id: string | null
  minimum_order_amount: string
  allow_multiple_same_day: boolean
  reward_same_order: boolean
  starts_at: string | null
  ends_at: string | null
  expected_version: number | null
}

export type LoyaltyCustomer = {
  membership_code: string
  phone_masked: string
  branch_id: string
  program_name: string
  progress: string
  available_rewards: number
  joined_at: string
  is_active: boolean
}

export type LoyaltyAdminReward = {
  redemption_code: string
  membership_code: string
  program_name: string
  status: LoyaltyRewardStatus
  issued_at: string
  redeemed_at: string | null
}

export type LoyaltyPublicOffer = {
  enabled: boolean
  program_name: string | null
  campaign_type: LoyaltyCampaignType | null
  threshold: number | null
  minimum_order_amount: string | null
  allow_multiple_same_day: boolean | null
  qualifying_description: string | null
  reward_description: string | null
  reward_same_order: boolean | null
  ends_at: string | null
}

export type LoyaltyVerification = {
  verification_token: string
  expires_in: number
  mode: "DEVELOPMENT" | "PROVIDER"
  development_code: string | null
  message: string
}

export type LoyaltyPublicStatus = {
  program_name: string
  campaign_type: LoyaltyCampaignType
  progress: string
  target: number
  membership_code: string
  referral_code: string
  rewards: Array<{
    redemption_code: string
    description: string
    status: LoyaltyRewardStatus
    issued_at: string
    expires_at: string | null
  }>
}

export type LoyaltyEnrollment = {
  membership_code: string
  referral_code: string
  program_name: string
  verification_mode: "DEVELOPMENT" | "PROVIDER"
}

export type LoyaltyOrderContext = {
  order_id: string
  membership_code: string | null
  program_name: string | null
  available_rewards: Array<{
    redemption_code: string
    description: string
    eligible_order_item_ids: string[]
    expires_at: string | null
  }>
}

export type LoyaltyRedemption = {
  id: string
  redemption_code: string
  order_id: string
  order_item_id: string
  discount_id: string | null
  status: "APPLIED" | "REVERSED"
  amount: string
  created_at: string
}

export type LoyaltySetupOptions = {
  branches: Array<{ id: string; name: string; is_active: boolean }>
  products: Array<{ id: string; name: string }>
  categories: Array<{ id: string; name: string }>
}
