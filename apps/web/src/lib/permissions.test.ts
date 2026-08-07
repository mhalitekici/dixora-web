import { describe, expect, it } from "vitest"

import type { AuthContext } from "@/lib/api/types"
import {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  normalizePermissions,
  PERMISSIONS,
} from "@/lib/permissions"

function authContext({
  permissions = [],
  superAdmin = false,
}: {
  permissions?: string[]
  superAdmin?: boolean
} = {}): Pick<AuthContext, "permissions" | "user"> {
  return {
    permissions,
    user: {
      id: "user-1",
      tenantId: "tenant-1",
      branchId: "branch-1",
      username: "waiter",
      email: "waiter@dixora.test",
      displayName: "Test Kullanıcısı",
      roleCode: "WAITER",
      isActive: true,
      isSuperAdmin: superAdmin,
    },
  }
}

describe("permission helpers", () => {
  it("enforces all/any semantics for regular users", () => {
    const context = authContext({
      permissions: [PERMISSIONS.order.read, PERMISSIONS.order.create],
    })

    expect(
      hasAllPermissions(context, [
        PERMISSIONS.order.read,
        PERMISSIONS.order.create,
      ]),
    ).toBe(true)
    expect(
      hasAllPermissions(context, [
        PERMISSIONS.order.read,
        PERMISSIONS.order.manage,
      ]),
    ).toBe(false)
    expect(
      hasAnyPermission(context, [
        PERMISSIONS.order.manage,
        PERMISSIONS.order.create,
      ]),
    ).toBe(true)
    expect(hasPermission(null, PERMISSIONS.order.read)).toBe(false)
  })

  it("allows super administrators and wildcard grants to bypass checks", () => {
    expect(
      hasPermission(authContext({ superAdmin: true }), "unknown.permission"),
    ).toBe(true)
    expect(
      hasPermission(
        authContext({ permissions: ["*"] }),
        "unknown.permission",
      ),
    ).toBe(true)
  })

  it("deduplicates, removes empty entries, and sorts permission lists", () => {
    expect(
      normalizePermissions([
        PERMISSIONS.table.read,
        "",
        PERMISSIONS.order.read,
        PERMISSIONS.table.read,
      ]),
    ).toEqual([PERMISSIONS.order.read, PERMISSIONS.table.read])
    expect(normalizePermissions(undefined)).toEqual([])
  })
})
