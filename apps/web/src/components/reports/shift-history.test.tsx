import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ShiftHistory } from "@/components/reports/shift-history"

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function shift(overrides: Record<string, unknown> = {}) {
  return {
    id: "s-1",
    user_display_name: "Dixora Lab Cashier",
    cashier_name: "Halit",
    status: "CLOSED",
    opening_cash: "1500.00",
    closing_cash: "3200.00",
    cash_sales: "1700.00",
    card_sales: "900.00",
    total_sales: "2600.00",
    cash_variance: "0.00",
    opened_at: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
    closed_at: new Date().toISOString(),
    closing_note: null,
    ...overrides,
  }
}

function renderHistory(shifts: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(shifts))))
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(<ShiftHistory />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

describe("ShiftHistory", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("names who held the till and what it took", async () => {
    renderHistory([shift()])

    expect(await screen.findByText("Halit")).toBeVisible()
    expect(screen.getByText("₺1.700,00")).toBeVisible()
    expect(screen.getByText("₺900,00")).toBeVisible()
    expect(screen.getByText("₺2.600,00")).toBeVisible()
    // A three-hour shift reads as duration, not two timestamps to subtract.
    expect(screen.getByText(/3s 0dk/)).toBeVisible()
  })

  it("calls out a drawer that did not balance", async () => {
    renderHistory([shift({ id: "s-2", cash_variance: "-120.00" })])
    expect(await screen.findByText(/Kasa farkı: -₺120,00/)).toBeVisible()
  })

  it("does not raise an alarm when the count was exact", async () => {
    renderHistory([shift()])
    // Zero is the good case, so it must not be dressed as a problem.
    expect(await screen.findByText(/tuttu/)).toBeVisible()
  })

  it("marks a till that is still open", async () => {
    renderHistory([shift({ id: "s-3", status: "OPEN", closed_at: null })])
    expect(await screen.findByText("Açık")).toBeVisible()
  })

  it("offers a useful empty state", async () => {
    renderHistory([])
    expect(await screen.findByText("Vardiya kaydı yok")).toBeVisible()
  })
})
