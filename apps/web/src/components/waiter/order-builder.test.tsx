import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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

  it("submits a whole product with a product note", async () => {
    const product = { id: "product-1", category_id: "category-1", name: "Köfte", selling_price: "200.00", is_available: true, waiter_visible: true, modifier_groups: [] }
    let submitted: Record<string, unknown> | null = null
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/orders") && init?.method === "POST") {
        submitted = JSON.parse(String(init.body))
        return Promise.resolve(jsonResponse({ id: "order-1", items: [], total: "200.00" }))
      }
      if (url.endsWith("/tables/table-1")) return Promise.resolve(jsonResponse({ id: "table-1", name: "B1", capacity: 4, state: "AVAILABLE" }))
      if (url.includes("/catalog/categories")) return Promise.resolve(jsonResponse([]))
      if (url.endsWith("/catalog/products/product-1")) return Promise.resolve(jsonResponse(product))
      if (url.includes("/catalog/products")) return Promise.resolve(jsonResponse([product]))
      if (url.endsWith("/active-order")) return Promise.resolve(jsonResponse({ error: { code: "active_order_not_found", message: "No order" } }, 404))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<OrderBuilder tableId="table-1" />, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> })
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: /Köfte/ }))
    await user.type(screen.getByLabelText("Ürün notu"), "Soğansız, sos ayrı")
    expect(screen.queryByRole("button", { name: "Yarım porsiyon" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /Siparişe ekle/ }))
    await user.click(screen.getByRole("button", { name: "1 yeni kalemi gönder" }))
    await waitFor(() => expect(submitted).toMatchObject({ items: [{ quantity: "1", note: "Soğansız, sos ayrı" }] }))
  })

  it("saves a note on a previously submitted item through the waiter note endpoint", async () => {
    let order = { id: "order-1", status: "ACCEPTED", total: "200.00", version: 1, items: [{ id: "item-1", product_name_snapshot: "Köfte", status: "ACCEPTED", quantity: "1", line_total: "200.00", note: null as string | null }] }
    let patch: Record<string, unknown> | null = null
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/items/item-1/note") && init?.method === "PATCH") {
        patch = JSON.parse(String(init.body))
        order = { ...order, version: 2, items: [{ ...order.items[0], note: "Sos ayrı" }] }
        return Promise.resolve(jsonResponse(order))
      }
      if (url.endsWith("/tables/table-1")) return Promise.resolve(jsonResponse({ id: "table-1", name: "B1", capacity: 4, state: "OCCUPIED" }))
      if (url.endsWith("/active-order")) return Promise.resolve(jsonResponse(order))
      if (url.includes("/catalog/")) return Promise.resolve(jsonResponse([]))
      throw new Error(`Unexpected request: ${url}`)
    }))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<OrderBuilder tableId="table-1" />, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> })
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: "Açıklama ekle" }))
    await user.type(screen.getByLabelText("Açıklama"), "Sos ayrı")
    await user.click(screen.getByRole("button", { name: "Açıklamayı kaydet" }))
    await waitFor(() => expect(patch).toMatchObject({ note: "Sos ayrı", expected_version: 1 }))
    expect(await screen.findByText("Sos ayrı")).toBeVisible()
  })
})
