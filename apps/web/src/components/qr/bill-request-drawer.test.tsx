import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BillRequestDrawer } from "@/components/qr/bill-request-drawer"

describe("BillRequestDrawer", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("keeps the bill preview readable and marks complimentary lines", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ enabled: false }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    render(
      <BillRequestDrawer
        open
        onOpenChange={vi.fn()}
        businessSlug="dodo"
        branchSlug="merkez"
        total="₺550,00"
        submitting={false}
        onSubmit={vi.fn(async () => undefined)}
        order={{
          status: "SERVED",
          currency: "TRY",
          table_name: "Salon 3",
          items: [
            {
              id: "item-1",
              product_name_snapshot: "Kahve",
              quantity: "1",
              unit_price: "100.00",
              line_total: "0.00",
              is_complimentary: true,
              complimentary_reason: "Müşteri memnuniyeti",
              status: "ACCEPTED",
              note: null,
            },
          ],
          subtotal: "500.00",
          discount_total: "0.00",
          tax_total: "0.00",
          service_charge_type: "PERCENTAGE",
          service_charge_value: "10.00",
          service_charge_amount: "50.00",
          total: "550.00",
          paid_total: "0.00",
          remaining: "550.00",
        }}
      />,
      { wrapper },
    )

    expect(await screen.findByText("Kahve")).toBeVisible()
    expect(screen.getByText("İKRAM")).toBeVisible()
    expect(screen.getByText("Ara toplam")).toBeVisible()
    expect(screen.getByText("Servis")).toBeVisible()
    expect(screen.getByText("Toplam")).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Hesap talebini garsona gönder" }),
    ).toBeEnabled()
  })

  it("captures optional campaign consent separately from membership consent", async () => {
    const user = userEvent.setup({ delay: null })
    const posted: unknown[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const body =
          init?.method === "POST"
            ? { verification_id: "v-1", development_code: null }
            : { enabled: true }
        if (init?.method === "POST") posted.push(JSON.parse(String(init.body)))
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      }),
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <BillRequestDrawer
          open
          onOpenChange={vi.fn()}
          businessSlug="dodo"
          branchSlug="merkez"
          total="₺100,00"
          submitting={false}
          onSubmit={vi.fn(async () => undefined)}
          order={null}
        />
      </QueryClientProvider>,
    )
    await user.click(await screen.findByRole("button", { name: /Yeni üye/ }))
    await user.type(screen.getByLabelText("Ad"), "Ayşe")
    await user.type(screen.getByLabelText("Soyad"), "Yılmaz")
    await user.type(screen.getByLabelText("E-posta"), "ayse@example.com")
    const campaignConsent = screen.getByRole("checkbox", {
      name: /Kampanya duyurularını/,
    })
    expect(campaignConsent).not.toBeChecked()
    await user.click(
      screen.getByRole("checkbox", { name: /Sadakat programı kapsamında/ }),
    )
    const send = screen.getByRole("button", { name: "Kodu gönder" })
    expect(send).toBeEnabled()
    await user.click(campaignConsent)
    await user.click(send)
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({
      consent_accepted: true,
      marketing_email_consent: true,
    })
  })
})
