import type { AuthContext } from "@/lib/api/types"

export const PERMISSIONS = {
  platform: {
    businessesManage: "platform.businesses.manage",
    systemRead: "platform.system.read",
    supportMode: "platform.support",
  },
  dashboard: {
    read: "dashboard.read",
  },
  settings: {
    manage: "settings.manage",
  },
  user: {
    manage: "users.manage",
    manageRoles: "roles.manage",
  },
  catalog: {
    read: "catalog.read",
    manage: "catalog.manage",
  },
  inventory: {
    read: "inventory.read",
    manage: "inventory.manage",
    override: "inventory.override",
  },
  table: {
    read: "tables.read",
    manage: "tables.manage",
    operate: "tables.operate",
    transfer: "tables.transfer",
  },
  order: {
    read: "orders.read",
    create: "orders.create",
    manage: "orders.manage",
  },
  kitchen: {
    read: "kitchen.read",
    operate: "kitchen.manage",
  },
  payment: {
    manage: "payments.manage",
  },
  discount: {
    request: "discounts.request",
    approve: "discounts.approve",
  },
  report: {
    read: "reports.read",
  },
  qrMenu: {
    read: "qr.read",
    manage: "qr.manage",
    approveOrders: "qr.approve",
  },
  printing: {
    read: "printing.read",
    manage: "printing.manage",
    reprint: "printing.manage",
  },
  audit: {
    read: "audit.read",
  },
} as const

export type PermissionCode = LeafValues<typeof PERMISSIONS>
export type PermissionRequirement =
  | PermissionCode
  | string
  | readonly (PermissionCode | string)[]

export function hasPermission(
  context: Pick<AuthContext, "permissions" | "user"> | null | undefined,
  requirement: PermissionRequirement,
  mode: "all" | "any" = "all",
): boolean {
  if (!context) {
    return false
  }

  if (context.user.isSuperAdmin) {
    return true
  }

  const granted = new Set(context.permissions)
  if (granted.has("*")) {
    return true
  }

  const required = typeof requirement === "string" ? [requirement] : requirement
  if (required.length === 0) {
    return true
  }

  return mode === "all"
    ? required.every((permission) => granted.has(permission))
    : required.some((permission) => granted.has(permission))
}

export function hasAnyPermission(
  context: Pick<AuthContext, "permissions" | "user"> | null | undefined,
  permissions: readonly (PermissionCode | string)[],
): boolean {
  return hasPermission(context, permissions, "any")
}

export function hasAllPermissions(
  context: Pick<AuthContext, "permissions" | "user"> | null | undefined,
  permissions: readonly (PermissionCode | string)[],
): boolean {
  return hasPermission(context, permissions, "all")
}

export function normalizePermissions(
  permissions: readonly string[] | null | undefined,
): string[] {
  return [...new Set((permissions ?? []).filter(Boolean))].sort()
}

type LeafValues<T> = T extends string
  ? T
  : T extends Readonly<Record<string, unknown>>
    ? LeafValues<T[keyof T]>
    : never
