import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { OrderStatusView } from "./order-status-view"

const access = vi.hoisted(() => ({ permissions: [] as string[] }))
vi.mock("@/hooks/use-auth", () => ({
  useCurrentUser: () => ({
    data: {
      user: { roleCode: "WAITER", isSuperAdmin: false },
      permissions: access.permissions,
    },
  }),
}))
vi.mock("@/components/loyalty/staff-loyalty-panel", () => ({
  StaffLoyaltyPanel: () => null,
}))

function setup(permissions: string[], status: string) {
  access.permissions = permissions
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            String(input).endsWith("/tables")
              ? [{ id: "table-1", name: "Teras 4", state: "BILL_REQUESTED" }]
              : {
                  id: "order-1",
                  table_id: "table-1",
                  status,
                  source: "WAITER",
                  total: "95",
                  created_at: "2026-10-14T12:00:00Z",
                  items: [],
                },
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    ),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <OrderStatusView orderId="order-1" />
    </QueryClientProvider>,
  )
}

describe("order detail transfer access", () => {
  afterEach(() => vi.unstubAllGlobals())
  it("identifies the table and hides transfer from a waiter without permission", async () => {
    setup(["orders.read", "tables.read"], "BILL_REQUESTED")
    expect(
      await screen.findByRole("heading", { name: "Teras 4 adisyonu" }),
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Kalem taşı" }),
    ).not.toBeInTheDocument()
  })
  it("offers labeled transfer controls to authorized staff on an open order", async () => {
    setup(["orders.read", "tables.read", "tables.transfer"], "BILL_REQUESTED")
    expect(
      await screen.findByRole("heading", { name: "Kalem taşı" }),
    ).toBeVisible()
    expect(
      screen.getByRole("combobox", { name: "Taşınacak ürün" }),
    ).toBeVisible()
    expect(screen.getByRole("combobox", { name: "Hedef masa" })).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Taşı" }),
    ).toBeDisabled()
  })
  it("hides transfer on a paid order even for authorized staff", async () => {
    setup(["orders.read", "tables.read", "tables.transfer"], "PAID")
    expect(
      await screen.findByRole("heading", { name: "Teras 4 adisyonu" }),
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Kalem taşı" }),
    ).not.toBeInTheDocument()
  })
})
