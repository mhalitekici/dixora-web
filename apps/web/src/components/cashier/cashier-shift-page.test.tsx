import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CashierShiftPage } from "@/components/cashier/cashier-shift-page"

const openShift = {
  id: "shift-1",
  cashier_name: "Halit",
  user_display_name: "Halit",
  opening_cash: "100.00",
  cash_sales: "50.00",
  card_sales: "80.00",
  cash_refunds: "0.00",
  expected_cash: "150.00",
  reported_card_total: null,
  card_variance: null,
  opened_at: "2026-09-10T08:00:00Z",
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<CashierShiftPage />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

describe("CashierShiftPage", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("sends the manually entered POS/Z total when a manager closes a shift", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/shifts/current")) return Promise.resolve(response(openShift))
      if (url.includes("/shifts/shift-1/close")) return Promise.resolve(response({ ...openShift, status: "CLOSED" }))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    renderPage()

    expect(await screen.findByText("Vardiya kapanış ve devir")).toBeVisible()
    fireEvent.change(screen.getByLabelText("Kullanıcı adı"), { target: { value: "manager" } })
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "8642" } })
    fireEvent.change(screen.getByLabelText("Sayılmış kapanış nakdi"), { target: { value: "150,00" } })
    fireEvent.change(screen.getByLabelText("POS / Z kart toplamı"), { target: { value: "81,25" } })
    expect(screen.getByText("Kart farkı")).toBeVisible()
    expect(screen.getByText("FAZLA · +₺1,25")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: /Özeti Onayla ve Kapat/ }))

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/shifts/shift-1/close"))).toBe(true),
    )
    const closeCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/shifts/shift-1/close"))
    const request = closeCall?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({
      username: "manager",
      pin: "8642",
      closing_cash: "150.00",
      reported_card_total: "81.25",
    })
  })
})
