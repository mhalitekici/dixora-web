import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PlatformInvoices } from "@/components/super-admin/platform-invoices"

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "i-1",
    tenant_id: "t-1",
    business_name: "Dozz Cafe",
    business_slug: "dozz",
    number: "DX-202608-DOZZ",
    amount: "2050.00",
    currency: "TRY",
    status: "ISSUED",
    period_start: "2026-08-01",
    branch_count: 2,
    due_at: null,
    paid_at: null,
    attempt_count: 0,
    failure_reason: null,
    has_card: true,
    ...overrides,
  }
}

function setup(invoices: unknown[]) {
  const urls: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      urls.push(String(input))
      return Promise.resolve(jsonResponse(invoices))
    }),
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(<PlatformInvoices />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
  return { urls }
}

describe("PlatformInvoices", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("names the business, not just an id", async () => {
    setup([invoice()])
    expect(await screen.findByText("Dozz Cafe")).toBeVisible()
    expect(screen.getByText("DX-202608-DOZZ")).toBeVisible()
  })

  it("separates a business with no card from one that was declined", async () => {
    // Chasing someone for a failed payment they never set up wastes time.
    setup([
      invoice({ has_card: false }),
      invoice({
        id: "i-2",
        business_name: "Elixir",
        status: "FAILED",
        failure_reason: "Yetersiz bakiye",
        attempt_count: 2,
        has_card: true,
      }),
    ])

    expect(await screen.findByText("Kart yok")).toBeVisible()
    expect(screen.getByText(/Yetersiz bakiye \(2 deneme\)/)).toBeVisible()
  })

  it("totals only what is actually still owed", async () => {
    setup([
      invoice({ number: "DX-1", amount: "1000.00", status: "ISSUED" }),
      invoice({ id: "i-2", number: "DX-2", amount: "500.00", status: "PAID" }),
      invoice({ id: "i-3", number: "DX-3", amount: "250.00", status: "VOID" }),
    ])
    // The strip renders before the data does, so wait for a row first.
    await screen.findByText("DX-1")
    // Paid and voided invoices are not debts. Scoped to the strip: the same
    // amount also appears on the row itself.
    const label = screen.getByText("Tahsil edilecek")
    await waitFor(() =>
      expect(label.parentElement).toHaveTextContent("₺1.000,00"),
    )
  })

  it("counts businesses that can never be charged", async () => {
    setup([
      invoice({ has_card: false }),
      invoice({ id: "i-2", has_card: false }),
      invoice({ id: "i-3", has_card: true }),
    ])
    // Scoped likewise: "2" is also a branch count in the table.
    const label = await screen.findByText("Kartsız")
    await waitFor(() => expect(label.parentElement).toHaveTextContent("2"))
    expect(label.parentElement).toHaveTextContent("2")
  })

  it("filters server-side so the totals match the list", async () => {
    const user = userEvent.setup({ delay: null })
    const { urls } = setup([invoice()])

    await screen.findByText("Dozz Cafe")
    await user.click(screen.getByRole("button", { name: "Ödenemedi" }))

    await waitFor(() => {
      expect(urls.some((url) => url.includes("status=FAILED"))).toBe(true)
    })
  })
})
