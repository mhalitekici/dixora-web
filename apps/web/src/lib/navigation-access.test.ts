import { describe, expect, it } from "vitest"
import type { AuthContext } from "@/lib/api/types"
import { canNavigate } from "./navigation-access"

function context(
  roleCode: AuthContext["user"]["roleCode"],
  permissions: string[],
) {
  return {
    user: { roleCode, isSuperAdmin: roleCode === "SUPER_ADMIN" },
    permissions,
  } as AuthContext
}

describe("navigation role boundaries", () => {
  it("keeps cashier dashboard permissions inside the operational panel", () => {
    const cashier = context("CASHIER", ["dashboard.read", "payments.manage"])
    expect(canNavigate(cashier, "/cashier")).toBe(true)
    expect(canNavigate(cashier, "/admin")).toBe(false)
    expect(canNavigate(cashier, "/super-admin/businesses")).toBe(false)
  })
  it("keeps platform administrators in the platform workspace", () => {
    const platform = context("SUPER_ADMIN", ["*"])
    expect(canNavigate(platform, "/super-admin/businesses")).toBe(true)
    expect(canNavigate(platform, "/admin")).toBe(false)
    expect(canNavigate(platform, "/cashier")).toBe(false)
  })
  it("limits accountant links to permitted financial screens", () => {
    const accountant = context("ACCOUNTANT", [
      "dashboard.read",
      "reports.read",
      "inventory.read",
    ])
    expect(canNavigate(accountant, "/admin/shifts")).toBe(true)
    expect(canNavigate(accountant, "/admin/inventory")).toBe(true)
    expect(canNavigate(accountant, "/admin/printers")).toBe(false)
    expect(canNavigate(context("ACCOUNTANT", []), "/admin/reports")).toBe(false)
  })
})
