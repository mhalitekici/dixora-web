import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { StaffLoyaltyPanel } from "@/components/loyalty/staff-loyalty-panel"

const ORDER_ID = "11111111-1111-1111-1111-111111111111"
const DESSERT_ITEM = "22222222-2222-2222-2222-222222222222"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const emptyContext = {
  order_id: ORDER_ID,
  membership_code: null,
  program_name: null,
  available_rewards: [],
}

function setup(applyResponse: unknown, status = 201) {
  const posted: Array<{ url: string; body: unknown }> = []
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === "POST") {
        posted.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(applyResponse, status))
      }
      return Promise.resolve(jsonResponse(emptyContext))
    }),
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  render(
    <StaffLoyaltyPanel
      orderId={ORDER_ID}
      items={[
        { id: DESSERT_ITEM, product_name_snapshot: "Tiramisu", status: "ACCEPTED" },
      ]}
    />,
    { wrapper },
  )
  return { posted }
}

describe("StaffLoyaltyPanel campaign codes", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("applies the code in one action, without asking which line it covers", async () => {
    const user = userEvent.setup({ delay: null })
    const { posted } = setup({
      order_id: ORDER_ID,
      membership_code: "DXR1923",
      program_name: "Kahve Alana Tatlı",
      applied: [
        {
          redemption_code: "RW-1",
          order_item_id: DESSERT_ITEM,
          product_name: "Tiramisu",
          amount: "120.00",
        },
      ],
      total_discount: "120.00",
      order_total: "180.00",
      unapplied_reason: null,
    })

    await user.type(
      await screen.findByLabelText("Üyelik / kampanya kodu"),
      "DXR1923",
    )
    await user.click(screen.getByRole("button", { name: /Uygula/ }))

    await waitFor(() => expect(posted).toHaveLength(1))
    // One request does the whole job, and it never names an order line: the
    // browser must not be able to choose what becomes free.
    expect(posted[0].url).toContain("apply-code")
    const body = posted[0].body as Record<string, unknown>
    expect(body.member_code).toBe("DXR1923")
    expect(body).not.toHaveProperty("order_item_id")
  })

  it("sends a stable idempotency key so a double-tap cannot discount twice", async () => {
    const user = userEvent.setup({ delay: null })
    const { posted } = setup({
      order_id: ORDER_ID,
      membership_code: "DXR1923",
      program_name: "Kahve Alana Tatlı",
      applied: [],
      total_discount: "0.00",
      order_total: "300.00",
      unapplied_reason: "Bu üyeliğin kullanılabilir kampanyası yok.",
    })

    await user.type(
      await screen.findByLabelText("Üyelik / kampanya kodu"),
      "DXR1923",
    )
    await user.click(screen.getByRole("button", { name: /Uygula/ }))

    await waitFor(() => expect(posted).toHaveLength(1))
    const key = (posted[0].body as Record<string, string>).idempotency_key
    expect(key).toContain(ORDER_ID)
    expect(key).toContain("DXR1923")
  })

  it("will not send a code that is too short to be real", async () => {
    const user = userEvent.setup({ delay: null })
    const { posted } = setup({})

    await user.type(await screen.findByLabelText("Üyelik / kampanya kodu"), "DXR")
    expect(screen.getByRole("button", { name: /Uygula/ })).toBeDisabled()
    expect(posted).toHaveLength(0)
  })
})
