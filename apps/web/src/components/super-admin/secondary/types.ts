export type TenantState =
  | "TRIAL"
  | "ACTIVE"
  | "PAST_DUE"
  | "SUSPENDED"
  | "CANCELLED"
  | "ARCHIVED"

export interface PlatformBusiness {
  id: string
  name: string
  slug: string
  business_type: string
  state: TenantState
  is_active: boolean
  created_at: string
}

export interface PageResult<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface SubscriptionPlan {
  id: string
  code: string
  name: string
  monthly_price: string | number
  currency: string
  max_branches: number | null
  max_users: number | null
  is_active: boolean
}

export interface TenantSubscriptionRow {
  business: PlatformBusiness
  plan: SubscriptionPlan
  status: TenantState
  starts_at: string
  ends_at: string | null
  source: "subscription-api"
}

export interface SubscriptionPortfolio {
  businesses: TenantSubscriptionRow[]
  plans: SubscriptionPlan[]
  issues: string[]
  tenantSubscriptionSource: "subscription-api"
}

export interface AuditLogEntry {
  id: string
  branch_id: string | null
  actor_user_id: string | null
  actor_role: string | null
  action: string
  resource_type: string
  resource_id: string | null
  previous_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  reason: string | null
  timestamp: string
}

export interface AuditLogFeed {
  items: AuditLogEntry[]
  availability: "live" | "tenant-scope-required"
  scope: "current-identity"
  maxRecords: number
  limitation: string
}

export type ServiceHealthState =
  | "healthy"
  | "degraded"
  | "offline"
  | "unknown"

export interface SystemServiceHealth {
  id: "api" | "postgresql" | "redis" | "print-bridge"
  name: string
  state: ServiceHealthState
  summary: string
  detail: string
  latencyMs: number | null
  observedAt: string
  endpointLabel: string
  metadata?: Record<string, string | number | boolean | null>
}

export interface SystemHealthSnapshot {
  checkedAt: string
  services: SystemServiceHealth[]
  adapter: {
    source: "live-probes"
    limitations: string[]
  }
}

export interface SupportModeCapability {
  available: false
  contract: "platform-support-session-v1"
  explanation: string
}
