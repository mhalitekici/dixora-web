import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ShiftHistory } from "@/components/reports/shift-history"

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }) }
function shift(overrides: Record<string, unknown> = {}) { return { id: "s-1", user_display_name: "Dixora Cashier", cashier_name: "Halit", closed_by_display_name: "Müdür", business_date: "2026-09-10", status: "CLOSED", opening_cash: "1500.00", closing_cash: "3079.99", cash_sales: "1700.00", card_sales: "900.00", reported_card_total: "901.25", card_variance: "1.25", cash_refunds: "0.00", card_refunds: "0.00", expected_cash: "3200.00", total_sales: "2600.00", cash_variance: "-120.01", opened_at: "2026-09-10T06:00:00Z", closed_at: "2026-09-10T14:00:00Z", opening_note: null, closing_note: "Sayım tamam", ...overrides } }

function renderHistory(shifts: unknown[]) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/shifts/history")) return Promise.resolve(response(shifts))
    if (url.includes("/shifts/day/history")) return Promise.resolve(response([]))
    if (url.includes("/shifts/day/preview")) return Promise.resolve(response({ error: { message: "not allowed" } }, 403))
    throw new Error(`Unexpected request: ${url}`)
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<ShiftHistory />, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
}

describe("ShiftHistory", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("shows the cashier, expected/count values and a shortage label", async () => {
    renderHistory([shift()])
    expect(await screen.findByText("Halit")).toBeVisible()
    expect(screen.getByText("EKSİK · -₺120,01")).toBeVisible()
    expect(screen.getByText("₺3.200,00")).toBeVisible()
    expect(screen.getByText("₺3.079,99")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: /Detayı göster/ }))
    expect(screen.getByText("POS / Z kart")).toBeVisible()
    expect(screen.getByText("₺901,25")).toBeVisible()
    expect(screen.getByText("Kart farkı")).toBeVisible()
    expect(screen.getByText("₺1,25")).toBeVisible()
  })

  it("marks an exact and an open shift without relying on color", async () => {
    renderHistory([shift({ id: "exact", cash_variance: "0.00", closing_cash: "3200.00" }), shift({ id: "open", status: "OPEN", closed_at: null })])
    expect(await screen.findByText("TAM · ₺0,00")).toBeVisible()
    expect(screen.getByText("AÇIK")).toBeVisible()
  })

  it("offers a useful empty state", async () => {
    renderHistory([])
    expect(await screen.findByText("Vardiya kaydı yok")).toBeVisible()
  })

  it("lets a manager close an open shift before completing day close", async () => {
    let isOpen = true
    const openShift = shift({ id: "open-shift", status: "OPEN", closed_at: null, closing_cash: null, expected_cash: "250.00", card_sales: "250.00" })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/shifts/open-shift/close")) {
        isOpen = false
        return Promise.resolve(response({ ...openShift, status: "CLOSED" }))
      }
      if (url.includes("/shifts/day/history")) return Promise.resolve(response([]))
      if (url.includes("/shifts/day/preview")) return Promise.resolve(response({ business_date: "2026-09-11", system_cash_total: "0.00", system_card_total: "0.00", expected_cash: "0.00", receipt_count: 0, open_shift_count: isOpen ? 1 : 0 }))
      if (url.includes("/shifts/history")) return Promise.resolve(response(isOpen ? [openShift] : []))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<ShiftHistory />, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })

    expect(await screen.findByRole("button", { name: /Halit Vardiyasını Kapat/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Yetkili kullanıcı adı"), { target: { value: "aley" } })
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "8642" } })
    fireEvent.change(screen.getByLabelText("Vardiya sayılan nakdi"), { target: { value: "250" } })
    fireEvent.change(screen.getByLabelText("Vardiya POS / Z kart toplamı"), { target: { value: "250" } })
    expect(screen.getByRole("button", { name: /Halit Vardiyasını Kapat/ })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: /Halit Vardiyasını Kapat/ }))

    await waitFor(() => expect(isOpen).toBe(false))
    const closeCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/shifts/open-shift/close"))
    expect(JSON.parse(String((closeCall?.[1] as RequestInit).body))).toMatchObject({
      username: "aley",
      pin: "8642",
      closing_cash: "250",
      reported_card_total: "250",
    })
    expect(await screen.findByRole("button", { name: /Karşılaştırmayı Onayla ve Kapat/ })).toBeDisabled()
  })
})
