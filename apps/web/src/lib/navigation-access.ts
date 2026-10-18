import type { AuthContext } from "@/lib/api/types"
import { hasPermission } from "@/lib/permissions"

const requirements: Array<[string, string]> = [
  ["/super-admin/system", "platform.system.read"],
  ["/super-admin/audit-logs", "platform.system.read"],
  ["/super-admin", "platform.businesses.manage"],
  ["/admin/branch-settings", "settings.manage"],
  ["/admin/settings", "settings.manage"],
  ["/admin/subscription", "settings.manage"],
  ["/admin/onboarding", "settings.manage"],
  ["/admin/audit-logs", "audit.read"],
  ["/admin/approvals", "orders.manage"],
  ["/admin/employees", "users.manage"],
  ["/admin/roles", "roles.read"],
  ["/admin/reports", "reports.read"],
  ["/admin/order-activity", "reports.read"],
  ["/admin/shifts", "reports.read"],
  ["/admin/inventory", "inventory.read"],
  ["/admin/qr-menu", "qr.read"],
  ["/admin/campaigns", "loyalty.manage"],
  ["/admin/notifications", "loyalty.manage"],
  ["/admin/loyalty", "loyalty.read"],
  ["/admin/hotel-rooms", "hotel_rooms.read"],
  ["/admin/printers", "printing.read"],
  ["/admin/products", "catalog.read"],
  ["/admin/categories", "catalog.read"],
  ["/admin/modifiers", "catalog.read"],
  ["/admin/tables", "tables.read"],
  ["/admin/orders", "orders.read"],
  ["/admin/live", "dashboard.read"],
  ["/admin", "dashboard.read"],
]

export function permissionForNavigation(href: string): string | null {
  return (
    requirements.find(
      ([prefix]) => href === prefix || href.startsWith(`${prefix}/`),
    )?.[1] ?? null
  )
}

export function canNavigate(
  context: AuthContext | null | undefined,
  href: string,
) {
  if (!context) return false
  const role = context.user.roleCode
  if (href.startsWith("/super-admin") && role !== "SUPER_ADMIN") return false
  if (href.startsWith("/cashier")) {
    return (
      [
        "BUSINESS_OWNER",
        "BUSINESS_ADMIN",
        "BUSINESS_MANAGER",
        "CASHIER",
      ].includes(role) && hasPermission(context, "payments.manage")
    )
  }
  if (href.startsWith("/waiter")) {
    return (
      [
        "BUSINESS_OWNER",
        "BUSINESS_ADMIN",
        "BUSINESS_MANAGER",
        "WAITER",
      ].includes(role) && hasPermission(context, "orders.create")
    )
  }
  if (href.startsWith("/admin")) {
    if (
      ![
        "BUSINESS_OWNER",
        "BUSINESS_ADMIN",
        "BUSINESS_MANAGER",
        "ACCOUNTANT",
      ].includes(role)
    )
      return false
    if (
      role === "ACCOUNTANT" &&
      href !== "/admin" &&
      ![
        "/admin/reports",
        "/admin/inventory",
        "/admin/shifts",
        "/admin/order-activity",
      ].some((path) => href === path || href.startsWith(`${path}/`))
    )
      return false
  }
  const requirement = permissionForNavigation(href)
  return requirement === null || hasPermission(context, requirement)
}
