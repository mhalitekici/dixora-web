export type UUID = string
export type ISODateTime = string
export type DecimalString = string

export type RoleCode =
  | "SUPER_ADMIN"
  | "BUSINESS_OWNER"
  | "BUSINESS_MANAGER"
  | "CASHIER"
  | "WAITER"
  | "KITCHEN"
  | "ACCOUNTANT"
  | (string & {})

export interface ApiErrorDetail {
  code: string
  message: string
  details?: unknown
}

export interface ApiErrorPayload {
  error: ApiErrorDetail
  requestId?: string
}

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  pageCount: number
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export type ApiSearchValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[]

export type ApiSearchParams = Readonly<Record<string, ApiSearchValue>>

export interface TenantSummary {
  id: UUID
  name: string
  slug: string
  state?: string
  isActive: boolean
  defaultCurrency?: string
}

export interface BranchSummary {
  id: UUID
  tenantId?: UUID
  name: string
  slug: string
  timezone?: string
  isActive: boolean
}

export interface AuthUser {
  id: UUID
  tenantId: UUID | null
  branchId: UUID | null
  username: string
  email: string | null
  displayName: string
  roleCode: RoleCode
  isActive: boolean
  isSuperAdmin: boolean
}

export interface AuthContext {
  user: AuthUser
  tenant: TenantSummary | null
  branch: BranchSummary | null
  permissions: string[]
}

export interface AccessibleBranches {
  branches: BranchSummary[]
  currentBranchId: UUID | null
  canSwitch: boolean
}

export interface LoginInput {
  businessSlug: string | null
  identifier: string
  password: string
  branchId?: UUID | null
  rememberMe: boolean
}

export interface LoginResult {
  user: AuthUser
  expiresIn: number
}

export interface RefreshResult {
  refreshed: true
  expiresIn: number
}

export interface SwitchBranchInput {
  branchId: UUID
}

export interface RealtimeEvent<TPayload = unknown> {
  id?: string
  type: string
  occurredAt?: ISODateTime
  tenantId?: UUID
  branchId?: UUID
  payload: TPayload
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
