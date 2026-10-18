import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WaiterNotifications } from "./waiter-notifications"

function setup(fail = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.includes("/qr/requests")
        ? [
            {
              id: "request-1",
              table_id: "table-1",
              items_payload: [{ product_id: "coffee" }],
              status: "PENDING",
            },
          ]
        : url.includes("/tables")
          ? [{ id: "table-1", name: "Teras 4" }]
          : { items: [] }
      return Promise.resolve(
        new Response(
          JSON.stringify(
            fail
              ? {
                  error: {
                    code: "backend_unavailable",
                    message: "Sunucuya erişilemiyor",
                  },
                }
              : body,
          ),
          {
            status: fail ? 503 : 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
    }),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <WaiterNotifications />
    </QueryClientProvider>,
  )
}

describe("waiter notification context", () => {
  afterEach(() => vi.unstubAllGlobals())
  it("identifies QR requests by the actual table name", async () => {
    setup()
    expect(await screen.findByText(/Teras 4/)).toBeVisible()
    expect(
      screen.getByRole("button", {
        name: "Teras 4 QR sipariş talebini onayla",
      }),
    ).toBeVisible()
  })
  it("does not misrepresent failed requests as an empty inbox", async () => {
    setup(true)
    expect(await screen.findByText("Bildirimler alınamadı")).toBeVisible()
    expect(screen.queryByText("Bekleyen bildirim yok")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Yeniden dene" })).toBeVisible()
  })
})
