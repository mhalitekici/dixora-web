import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BillingPanel } from "@/components/billing/billing-panel"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const invoice = {
  id: "i-1",
  number: "DX-202608-DIXORA",
  amount: "2050.00",
  currency: "TRY",
  status: "ISSUED",
  period_start: "2026-08-01",
  period_end: "2026-08-31",
  branch_count: 2,
  base_amount: "1200.00",
  extra_branch_amount: "850.00",
  due_at: null,
  paid_at: null,
  failure_reason: null,
}

function setup({
  cards = [],
  invoices = [invoice],
}: { cards?: unknown[]; invoices?: unknown[] } = {}) {
  const posted: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === "POST") {
        posted.push(url)
        return Promise.resolve(
          jsonResponse({ form_url: "https://sandbox-cpp.iyzipay.com?token=x" }),
        )
      }
      if (url.includes("billing/cards")) return Promise.resolve(jsonResponse(cards))
      if (url.includes("billing/invoices")) {
        return Promise.resolve(jsonResponse(invoices))
      }
      throw new Error(`Unexpected request: ${url}`)
    }),
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(<BillingPanel />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
  return { posted }
}

describe("BillingPanel", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("explains that the card never reaches Dixora", async () => {
    setup()
    // The whole reason for the hosted form; the owner should be told.
    expect(
      await screen.findByText(/Dixora sunucularına hiç gelmez/),
    ).toBeVisible()
  })

  it("says plainly that no card means no collection", async () => {
    setup({ cards: [] })
    expect(
      await screen.findByText(/Kart eklemeden aylık tahsilat yapılamaz/),
    ).toBeVisible()
  })

  it("breaks the amount down so an increase is explainable", async () => {
    setup()
    expect(await screen.findByText("₺2.050,00")).toBeVisible()
    expect(
      screen.getByText(/2 şube · temel ₺1\.200,00 \+ ek ₺850,00/),
    ).toBeVisible()
  })

  it("warns about an unpaid invoice and why it failed", async () => {
    setup({
      invoices: [
        { ...invoice, status: "FAILED", failure_reason: "Yetersiz bakiye" },
      ],
    })
    expect(await screen.findByText("1 ödenmemiş fatura")).toBeVisible()
    expect(screen.getByText(/Yetersiz bakiye/)).toBeVisible()
  })

  it("asks the server for the hosted form rather than collecting a card itself", async () => {
    const user = userEvent.setup({ delay: null })
    // jsdom refuses a real navigation; the assignment is what matters.
    const { posted } = setup()

    await user.click(await screen.findByRole("button", { name: /Kart ekle/ }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toContain("billing/cards/checkout")
    // No card field exists anywhere in this panel.
    expect(screen.queryByLabelText(/kart numarası/i)).not.toBeInTheDocument()
  })
})
