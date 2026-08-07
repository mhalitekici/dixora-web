import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OrderBuilder } from "@/components/waiter/order-builder"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("OrderBuilder", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("opens an empty table when the API reports no active order", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/tables/table-1")) {
        return Promise.resolve(
          jsonResponse({ id: "table-1", name: "Masa 1", capacity: 4, state: "AVAILABLE" }),
        )
      }
      if (url.includes("/catalog/categories")) return Promise.resolve(jsonResponse([]))
      if (url.includes("/catalog/products")) return Promise.resolve(jsonResponse([]))
      if (url.endsWith("/tables/table-1/active-order")) {
        return Promise.resolve(
          jsonResponse(
            {
              error: {
                code: "active_order_not_found",
                message: "No active order for this table",
              },
            },
            404,
          ),
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    render(<OrderBuilder tableId="table-1" />, { wrapper })

    expect(await screen.findByText("Yeni masa oturumu")).toBeInTheDocument()
    expect(screen.queryByText("Sipariş ekranı yüklenemedi")).not.toBeInTheDocument()
  })
})
