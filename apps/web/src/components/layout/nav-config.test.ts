import { describe, expect, it } from "vitest"

import {
  adminNavigation,
  operationalLinks,
  qrNavigation,
  superAdminNavigation,
  type NavGroup,
} from "@/components/layout/nav-config"

function hrefs(groups: NavGroup[]): string[] {
  return groups.flatMap((group) => group.items.map((item) => item.href))
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) repeated.add(value)
    seen.add(value)
  }
  return [...repeated]
}

describe("navigation config", () => {
  // A destination listed twice shipped once already: the same entry appeared
  // twice in the admin sidebar, and nothing failed.
  it.each([
    ["admin", () => hrefs(adminNavigation)],
    ["super admin", () => hrefs(superAdminNavigation)],
    ["qr", () => hrefs(qrNavigation)],
    ["cashier", () => operationalLinks.cashier.map((link) => link.href)],
    ["waiter", () => operationalLinks.waiter.map((link) => link.href)],
  ])("lists every %s destination exactly once", (_name, collect) => {
    expect(duplicates(collect())).toEqual([])
  })

  it("gives every destination a label", () => {
    const all = [
      ...adminNavigation,
      ...superAdminNavigation,
      ...qrNavigation,
    ].flatMap((group) => group.items)
    for (const item of all) {
      expect(item.label.trim().length).toBeGreaterThan(0)
    }
  })

  it("groups campaigns, loyalty and customer notifications together", () => {
    const group = adminNavigation.find(
      (item) => item.label === "Kampanyalar ve Sadakat",
    )
    expect(group?.items.map((item) => item.href)).toEqual([
      "/admin/campaigns",
      "/admin/loyalty",
      "/admin/notifications",
    ])
    expect(
      adminNavigation.find((item) => item.label === "Menü ve Stok")?.items,
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: "/admin/campaigns" }),
      ]),
    )
  })
})
