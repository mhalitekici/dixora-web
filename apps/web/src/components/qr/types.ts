import type { ManagedThemeMode } from "@/stores/managed-theme-store"

export type QrOrderMode =
  | "MENU_ONLY"
  | "WAITER_APPROVAL"
  | "AUTOMATIC_ACCEPTANCE"
  | "DISABLED"

export type QrRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"

export interface QrConfigDto {
  id: string
  tenant_id: string
  branch_id: string
  menu_name: string
  is_enabled: boolean
  order_mode: QrOrderMode
  logo_url: string | null
  cover_image_url: string | null
  primary_color: string
  language: string
  currency: string
  customer_notes_enabled?: boolean
  allergens_visible?: boolean
}

export interface PublicQrConfigDto {
  menu_name: string
  order_mode: QrOrderMode
  logo_url: string | null
  cover_image_url: string | null
  primary_color: string
  language: string
  currency: string
  customer_notes_enabled: boolean
  allergens_visible: boolean
  /**
   * Business-wide, not per branch. The menu shell has already applied this from
   * its own uncached request by the time this payload lands — it is carried here
   * so the theme in the data and the theme on screen can never disagree.
   */
  theme_mode: ManagedThemeMode
}

export interface PublicActiveOrderDto {
  status: string
  total: string
  paid_total: string
  remaining: string
}

export interface QrCategoryDto {
  id: string
  name: string
  description: string | null
  color: string
  sort_order: number
}

export interface QrModifierDto {
  id: string
  name: string
  price_delta: string
  is_active?: boolean
}

export interface QrModifierGroupDto {
  id: string
  name: string
  is_required: boolean
  minimum_selection: number
  maximum_selection: number | null
  modifiers: QrModifierDto[]
}

export interface QrProductDto {
  id: string
  category_id: string
  name: string
  description: string | null
  selling_price: string
  image_url: string | null
  allergens: string[]
  calories?: number | null
  modifier_groups?: QrModifierGroupDto[]
}

export interface PublicCampaignDto {
  id: string
  name: string
  description: string | null
  summary: string
  audience: "EVERYONE" | "MEMBERS_ONLY"
  starts_at: string | null
  ends_at: string | null
}

export interface PublicQrMenuDto {
  business: string
  branch: string
  context_key: string
  table_name: string | null
  active_order: PublicActiveOrderDto | null
  config: PublicQrConfigDto
  categories: QrCategoryDto[]
  products: QrProductDto[]
  session_token: string | null
}

export interface QrOrderModifierInput {
  modifier_id: string
  quantity: number
}

export interface QrOrderItemInput {
  product_id: string
  quantity: number
  note?: string
  modifiers?: QrOrderModifierInput[]
}

export interface QrRequestCreate {
  table_token: string
  session_token: string
  idempotency_key: string
  items: QrOrderItemInput[]
  customer_note: string | null
}

export interface QrRequestDto {
  id: string
  tenant_id: string
  branch_id: string
  table_id: string
  order_id: string | null
  status: QrRequestStatus
  items_payload: Array<Record<string, unknown>>
  customer_note: string | null
  expires_at: string
  created_at: string
}

export interface PublicQrRequestDto {
  reference: string
  status: QrRequestStatus
  expires_at: string
  created_at: string
}

export interface PublicBillRequestCreate {
  table_token: string
  session_token: string
  payment_preference?: "CASH" | "CARD" | "ROOM_CHARGE" | null
  room_reference?: string | null
  membership_code?: string | null
}

export interface PublicBillRequestDto {
  status: "REQUESTED"
  order: PublicActiveOrderDto
  requested_at: string
}

export interface DiningTableDto {
  id: string
  tenant_id: string
  branch_id: string
  area_id: string
  name: string
  capacity: number
  sort_order: number
  is_active: boolean
  qr_token: string
  state: string
  version: number
}

export interface QrProductAdminDto {
  id: string
  name: string
  selling_price: string
}

export interface PageDto<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface QrConfigInput {
  menu_name: string
  is_enabled: boolean
  order_mode: QrOrderMode
  primary_color: string
  language: string
  customer_notes_enabled: boolean
  allergens_visible: boolean
}
