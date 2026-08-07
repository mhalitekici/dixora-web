import type { ApiSearchParams, UUID } from "@/lib/api/types"

export const queryKeys = {
  auth: {
    all: ["auth"] as const,
    me: ["auth", "me"] as const,
    branches: ["auth", "branches"] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
    summary: (branchId?: UUID) =>
      ["dashboard", "summary", { branchId: branchId ?? null }] as const,
  },
  tenants: {
    all: ["tenants"] as const,
    lists: () => ["tenants", "list"] as const,
    list: (filters: ApiSearchParams = {}) =>
      ["tenants", "list", filters] as const,
    detail: (tenantId: UUID) => ["tenants", "detail", tenantId] as const,
  },
  branches: {
    all: ["branches"] as const,
    list: (filters: ApiSearchParams = {}) =>
      ["branches", "list", filters] as const,
    detail: (branchId: UUID) => ["branches", "detail", branchId] as const,
  },
  users: {
    all: ["users"] as const,
    list: (filters: ApiSearchParams = {}) =>
      ["users", "list", filters] as const,
    detail: (userId: UUID) => ["users", "detail", userId] as const,
  },
  catalog: {
    all: ["catalog"] as const,
    categories: (filters: ApiSearchParams = {}) =>
      ["catalog", "categories", filters] as const,
    products: (filters: ApiSearchParams = {}) =>
      ["catalog", "products", filters] as const,
    product: (productId: UUID) =>
      ["catalog", "product", productId] as const,
  },
  inventory: {
    all: ["inventory"] as const,
    balances: (filters: ApiSearchParams = {}) =>
      ["inventory", "balances", filters] as const,
    movements: (filters: ApiSearchParams = {}) =>
      ["inventory", "movements", filters] as const,
  },
  tables: {
    all: ["tables"] as const,
    live: (branchId?: UUID) =>
      ["tables", "live", { branchId: branchId ?? null }] as const,
    detail: (tableId: UUID) => ["tables", "detail", tableId] as const,
  },
  orders: {
    all: ["orders"] as const,
    list: (filters: ApiSearchParams = {}) =>
      ["orders", "list", filters] as const,
    detail: (orderId: UUID) => ["orders", "detail", orderId] as const,
  },
  kitchen: {
    all: ["kitchen"] as const,
    tickets: (filters: ApiSearchParams = {}) =>
      ["kitchen", "tickets", filters] as const,
  },
  qrMenu: {
    all: ["qr-menu"] as const,
    publicMenu: (businessSlug: string, branchSlug?: string) =>
      ["qr-menu", "public", businessSlug, branchSlug ?? null] as const,
    requests: (filters: ApiSearchParams = {}) =>
      ["qr-menu", "requests", filters] as const,
  },
  reports: {
    all: ["reports"] as const,
    report: (name: string, filters: ApiSearchParams = {}) =>
      ["reports", name, filters] as const,
  },
  audit: {
    all: ["audit"] as const,
    list: (filters: ApiSearchParams = {}) =>
      ["audit", "list", filters] as const,
  },
} as const
