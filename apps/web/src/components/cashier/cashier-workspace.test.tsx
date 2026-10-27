import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CashierWorkspace } from "@/components/cashier/cashier-workspace"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const qrRequest = {
  id: "qr-request-1",
  tenant_id: "tenant-1",
  branch_id: "branch-1",
  table_id: "table-1",
  order_id: null,
  status: "PENDING",
  items_payload: [{ product_id: "product-1", quantity: 2 }],
  customer_note: null,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  created_at: new Date().toISOString(),
}

const cancellationApproval = {
  id: "approval-1",
  order_id: "order-1",
  order_item_id: "item-1",
  approval_type: "ITEM_CANCELLATION",
  status: "PENDING",
  payload: {},
  reason: "Yanlış ürün",
  created_at: new Date().toISOString(),
  resolved_at: null,
  requested_by_user_id: "user-1",
  requested_by_name: "Garson Ayşe",
  resolved_by_user_id: null,
  resolved_by_name: null,
  table_name: "Masa 1",
  order_item_name: "Cheeseburger",
  order_total: "120.00",
}

const tableWithOrder = {
  id: "table-1",
  area_id: "area-1",
  name: "B1",
  guest_label: "Ahmet",
  capacity: 4,
  state: "PREPARING",
  version: 1,
}

const availableTable = {
  id: "table-2",
  area_id: "area-1",
  name: "B2",
  guest_label: null,
  capacity: 2,
  state: "AVAILABLE",
  version: 1,
}

const billRequestedTable = {
  id: "table-3",
  area_id: "area-1",
  name: "B3",
  guest_label: null,
  capacity: 4,
  state: "BILL_REQUESTED",
  version: 1,
}

const cashierCategories = [
  { id: "category-hot", name: "Sıcak İçecekler", is_active: true },
  { id: "category-food", name: "Yemekler", is_active: true },
]

const cashierProducts = [
  {
    id: "product-latte",
    name: "Cafe Latte",
    category_id: "category-hot",
    selling_price: "95.00",
    is_available: true,
  },
  {
    id: "product-burger",
    name: "Cheeseburger",
    category_id: "category-food",
    selling_price: "220.00",
    is_available: true,
  },
]

const orderWithDetails = {
  id: "order-1",
  status: "ACCEPTED",
  table_id: "table-1",
  table_name: "B1",
  subtotal: "260.00",
  discount_total: "0.00",
  tax_total: "0.00",
  total: "260.00",
  version: 1,
  created_at: new Date().toISOString(),
  payments: [],
  items: [
    {
      id: "item-1",
      product_name_snapshot: "Hamburger",
      unit_price: "220.00",
      quantity: "1",
      line_total: "260.00",
      status: "ACCEPTED",
      note: "Soğansız olsun, ekstra kızarmış",
      modifiers: [
        {
          id: "mod-1",
          name_snapshot: "Ekstra peynir",
          price_delta_snapshot: "25.00",
          quantity: 1,
        },
        {
          id: "mod-2",
          name_snapshot: "Acı sos",
          price_delta_snapshot: "15.00",
          quantity: 1,
        },
      ],
    },
  ],
}

const authContext = {
  user: {
    id: "user-1",
    tenant_id: "tenant-1",
    branch_id: "branch-1",
    username: "owner@dixora.test",
    display_name: "Dixora Owner",
    role: "BUSINESS_OWNER",
    is_active: true,
    is_super_admin: false,
  },
  tenant: null,
  branch: null,
  permissions: ["orders.comp", "orders.manage"],
}

function routeFetchWithOrder(input: RequestInfo | URL) {
  const url = String(input)
  if (url.includes("/api/auth/me"))
    return Promise.resolve(jsonResponse(authContext))
  if (url.includes("/tables/areas")) {
    return Promise.resolve(jsonResponse([{ id: "area-1", name: "Salon" }]))
  }
  if (url.includes("/catalog/products"))
    return Promise.resolve(jsonResponse(cashierProducts))
  if (url.includes("/catalog/categories"))
    return Promise.resolve(jsonResponse(cashierCategories))
  if (url.includes("/shifts/current")) {
    return Promise.resolve(
      jsonResponse({ id: "shift-1", status: "OPEN", opening_cash: "1500.00" }),
    )
  }
  if (url.includes("/orders/approval-requests"))
    return Promise.resolve(jsonResponse([]))
  if (url.includes("/orders"))
    return Promise.resolve(jsonResponse([orderWithDetails]))
  if (url.includes("/qr/requests")) return Promise.resolve(jsonResponse([]))
  if (url.endsWith("/tables") || url.includes("/tables?")) {
    return Promise.resolve(
      jsonResponse([tableWithOrder, availableTable, billRequestedTable]),
    )
  }
  return Promise.resolve(jsonResponse([]))
}

function routeFetch(input: RequestInfo | URL) {
  const url = String(input)
  if (url.includes("/api/auth/me"))
    return Promise.resolve(jsonResponse(authContext))
  if (url.includes("/tables/areas")) return Promise.resolve(jsonResponse([]))
  if (url.includes("/catalog/products"))
    return Promise.resolve(jsonResponse([]))
  if (url.includes("/shifts/current")) {
    return Promise.resolve(
      jsonResponse({ id: "shift-1", status: "OPEN", opening_cash: "1500.00" }),
    )
  }
  if (url.includes("/orders/approval-requests")) {
    return Promise.resolve(jsonResponse([cancellationApproval]))
  }
  if (url.includes("/orders")) return Promise.resolve(jsonResponse([]))
  if (url.includes("/qr/requests"))
    return Promise.resolve(jsonResponse([qrRequest]))
  if (url.endsWith("/tables") || url.includes("/tables?")) {
    return Promise.resolve(jsonResponse([]))
  }
  throw new Error(`Unexpected request: ${url}`)
}

describe("CashierWorkspace", () => {
  it("opens payment with F4 and rejects negative or excess amounts before sending", async () => {
    vi.stubGlobal("fetch", vi.fn(routeFetchWithOrder))
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <CashierWorkspace />
      </QueryClientProvider>,
    )
    const { default: userEvent } = await import("@testing-library/user-event")
    const user = userEvent.setup({ delay: null })
    await user.click(await screen.findByRole("button", { name: /B1/ }))
    await user.keyboard("{F4}")
    const input = await screen.findByLabelText("Tutar")
    await user.clear(input)
    await user.type(input, "-1")
    expect(
      screen.getByRole("button", { name: /Ödemeyi kaydet/ }),
    ).toBeDisabled()
    expect(screen.getByText(/sıfırdan büyük bir tutar/)).toBeVisible()
    await user.clear(input)
    await user.type(input, "999999")
    expect(
      screen.getByRole("button", { name: /Ödemeyi kaydet/ }),
    ).toBeDisabled()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("adds whole products and enables manual printing again for each new batch", async () => {
    let currentOrder = orderWithDetails
    let lastAddition: Record<string, unknown> | null = null
    let batchCount = 0
    let addedCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith("/catalog/products/product-latte"))
          return Promise.resolve(
            jsonResponse({ ...cashierProducts[0], modifier_groups: [] }),
          )
        if (url.endsWith("/orders/order-1/items") && init?.method === "POST") {
          lastAddition = JSON.parse(String(init.body))
          const quantity = String(
            (lastAddition as { items: Array<{ quantity: string }> }).items[0]
              .quantity,
          )
          currentOrder = {
            ...currentOrder,
            version: currentOrder.version + 1,
            items: [
              ...currentOrder.items,
              {
                ...orderWithDetails.items[0],
                id: `added-${++addedCount}`,
                status: "SUBMITTED",
                product_name_snapshot: "Cafe Latte",
                quantity,
                unit_price: "95.00",
                line_total: String(95 * Number(quantity)),
                modifiers: [],
              },
            ],
          }
          return Promise.resolve(jsonResponse(currentOrder))
        }
        if (url.endsWith("/orders/order-1/accept") && init?.method === "POST") {
          batchCount++
          currentOrder = {
            ...currentOrder,
            version: currentOrder.version + 1,
            items: currentOrder.items.map((item) => ({
              ...item,
              status: "ACCEPTED",
            })),
          }
          return Promise.resolve(jsonResponse(currentOrder))
        }
        if (url.includes("/orders?"))
          return Promise.resolve(jsonResponse([currentOrder]))
        return routeFetchWithOrder(input)
      }),
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { default: userEvent } = await import("@testing-library/user-event")
    const user = userEvent.setup()
    render(<CashierWorkspace />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    })
    await user.click(await screen.findByRole("button", { name: /B1/ }))
    expect(
      screen.getByRole("button", { name: /Siparişi yazdır/ }),
    ).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Ürün ekle" }))
    expect(
      screen.queryByRole("button", { name: "Yarım porsiyon" }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /Cafe Latte/ }))
    await waitFor(() =>
      expect(lastAddition).toMatchObject({
        items: [{ quantity: "1" }],
        auto_accept: false,
      }),
    )
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Siparişi yazdır/ }),
      ).toBeEnabled(),
    )
    expect(batchCount).toBe(0)
    await user.click(screen.getByRole("button", { name: /Siparişi yazdır/ }))
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Siparişi yazdır/ }),
      ).toBeDisabled(),
    )
    expect(batchCount).toBe(1)
    await user.click(screen.getByRole("button", { name: "Ürün ekle" }))
    await user.click(screen.getByRole("button", { name: /Cafe Latte/ }))
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Siparişi yazdır/ }),
      ).toBeEnabled(),
    )
    expect(batchCount).toBe(1)
  })

  it("opens on the table grid and returns there from a selected table", async () => {
    vi.stubGlobal("fetch", vi.fn(routeFetchWithOrder))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { default: userEvent } = await import("@testing-library/user-event")
    const user = userEvent.setup()
    render(<CashierWorkspace />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    })

    expect(
      await screen.findByRole("heading", { name: "Masalar" }),
    ).toBeVisible()
    expect(screen.queryByText("Hamburger")).toBeNull()
    expect(screen.getByRole("button", { name: /B1/ })).toHaveClass("bg-red-50")
    expect(screen.getByRole("button", { name: /B2/ })).toHaveClass(
      "bg-emerald-50",
    )
    expect(screen.getByRole("button", { name: /B3/ })).toHaveClass(
      "bg-amber-100",
    )
    await user.click(screen.getByRole("button", { name: /B1/ }))
    expect(await screen.findByText("Hamburger")).toBeVisible()
    expect(screen.queryByRole("button", { name: /B2/ })).toBeNull()
    expect(screen.getByTitle("Sağ tık: misafir adı ekle")).toHaveTextContent(
      "B1",
    )
    await user.click(screen.getByRole("button", { name: "Masalar" }))
    expect(screen.queryByText("Hamburger")).toBeNull()
    expect(screen.getByRole("button", { name: /B2/ })).toBeVisible()
    expect(screen.getByRole("heading", { name: "Masalar" })).toHaveFocus()
  })

  it("shows live Hesap/QR/Onay counters sourced from the backend", async () => {
    vi.stubGlobal("fetch", vi.fn(routeFetch))

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    render(<CashierWorkspace />, { wrapper })

    const qrButton = await screen.findByRole("button", {
      name: /QR Siparişleri/,
    })
    expect(qrButton).toHaveTextContent("1")

    const approvalsButton = screen.getByRole("button", {
      name: /Onay Bekleyenler/,
    })
    expect(approvalsButton).toHaveTextContent("1")

    const billButton = screen.getByRole("button", { name: /Hesap İstekleri/ })
    expect(billButton).toHaveTextContent("0")

    expect(screen.getByText("Vardiya Açık")).toBeInTheDocument()
  })

  it("shows what the customer actually asked for: modifiers and their note", async () => {
    vi.stubGlobal("fetch", vi.fn(routeFetchWithOrder))

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { default: userEvent } = await import("@testing-library/user-event")
    const user = userEvent.setup()
    render(<CashierWorkspace />, { wrapper })

    await user.click(await screen.findByRole("button", { name: /B1/ }))

    expect(await screen.findByText("Hamburger")).toBeInTheDocument()
    // Modifiers were previously not rendered at all.
    expect(screen.getByText("Ekstra peynir")).toBeInTheDocument()
    expect(screen.getByText("Acı sos")).toBeInTheDocument()
    // The note must appear in full, not truncated to invisibility.
    expect(
      screen.getByText("Soğansız olsun, ekstra kızarmış"),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Siparişi yazdır/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Ürün taşı/ }),
    ).toBeInTheDocument()
    expect(screen.queryByText("Hesabı böl")).not.toBeInTheDocument()
    expect(screen.queryByText("Parçalı ödeme")).not.toBeInTheDocument()
  })

  it("lets the cashier update a product note and shows the saved text", async () => {
    let currentOrder = orderWithDetails
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (
        url.includes("/orders/order-1/items/item-1") &&
        init?.method === "PATCH"
      ) {
        const body = JSON.parse(String(init.body)) as {
          action: string
          note: string
        }
        expect(body.action).toBe("UPDATE_NOTE")
        expect(body.note).toBe("Sos ayrı, ekmek iyi kızarsın")
        currentOrder = {
          ...orderWithDetails,
          version: 2,
          items: [
            {
              ...orderWithDetails.items[0],
              note: body.note,
            },
          ],
        }
        return Promise.resolve(jsonResponse(currentOrder))
      }
      if (url.includes("/orders?limit=200")) {
        return Promise.resolve(jsonResponse([currentOrder]))
      }
      return routeFetchWithOrder(input)
    })
    vi.stubGlobal("fetch", fetchMock)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const { default: userEvent } = await import("@testing-library/user-event")
    const user = userEvent.setup({ delay: null })
    render(<CashierWorkspace />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    })

    await user.click(await screen.findByRole("button", { name: /B1/ }))
    await user.click(screen.getByRole("button", { name: "Açıklamayı düzenle" }))
    const note = screen.getByLabelText("Açıklama")
    expect(note).toHaveValue("Soğansız olsun, ekstra kızarmış")
    await user.clear(note)
    await user.type(note, "Sos ayrı, ekmek iyi kızarsın")
    await user.click(screen.getByRole("button", { name: "Açıklamayı kaydet" }))

    expect(
      await screen.findByText("Sos ayrı, ekmek iyi kızarsın"),
    ).toBeVisible()
  })

  it("filters cashier products by category before adding an item", async () => {
    vi.stubGlobal("fetch", vi.fn(routeFetchWithOrder))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { default: userEvent } = await import("@testing-library/user-event")
    const user = userEvent.setup()
    render(<CashierWorkspace />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    })

    await user.click(await screen.findByRole("button", { name: /B1/ }))
    await user.click(screen.getByRole("button", { name: /Ürün ekle/ }))
    expect(
      await screen.findByRole("button", { name: /Cafe Latte/ }),
    ).toBeVisible()
    expect(screen.getByRole("button", { name: /Cheeseburger/ })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Sıcak İçecekler" }))
    expect(screen.getByRole("button", { name: /Cafe Latte/ })).toBeVisible()
    expect(screen.queryByRole("button", { name: /Cheeseburger/ })).toBeNull()
  })

  it("exposes one-touch quantity controls and updates the row from the API result", async () => {
    let currentOrder = orderWithDetails
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (
        url.includes("/orders/order-1/items/item-1") &&
        init?.method === "PATCH"
      ) {
        currentOrder = {
          ...orderWithDetails,
          subtotal: "520.00",
          total: "520.00",
          version: 2,
          items: [
            {
              ...orderWithDetails.items[0],
              quantity: "2",
              line_total: "520.00",
            },
          ],
        }
        return Promise.resolve(jsonResponse(currentOrder))
      }
      if (url.includes("/orders?limit=200")) {
        return Promise.resolve(jsonResponse([currentOrder]))
      }
      return routeFetchWithOrder(input)
    })
    vi.stubGlobal("fetch", fetchMock)

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { default: userEvent } = await import("@testing-library/user-event")
    const user = userEvent.setup()
    render(<CashierWorkspace />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    })

    await user.click(await screen.findByRole("button", { name: /B1/ }))
    await user.click(
      await screen.findByRole("button", { name: "Hamburger adedini artır" }),
    )

    expect(await screen.findByText("2", { selector: "output" })).toBeVisible()
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/backend/orders/order-1/items/item-1",
      expect.objectContaining({ method: "PATCH" }),
    )
    expect(screen.getByRole("button", { name: "İkram" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Sil" })).toBeEnabled()
  })

  it("marks an item complimentary and immediately renders its zero price", async () => {
    let isComplimentary = false
    const currentOrder = () => ({
      ...orderWithDetails,
      subtotal: isComplimentary ? "0.00" : orderWithDetails.subtotal,
      total: isComplimentary ? "0.00" : orderWithDetails.total,
      version: isComplimentary ? 2 : 1,
      items: [
        {
          ...orderWithDetails.items[0],
          line_total: isComplimentary ? "0.00" : "260.00",
          is_complimentary: isComplimentary,
          complimentary_reason: isComplimentary ? "Müşteri memnuniyeti" : null,
        },
      ],
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (
        url.includes("/orders/order-1/items/item-1") &&
        init?.method === "PATCH"
      ) {
        const body = JSON.parse(String(init.body)) as { action: string }
        expect(body.action).toBe("SET_COMPLIMENTARY")
        isComplimentary = true
        return Promise.resolve(jsonResponse(currentOrder()))
      }
      if (url.includes("/orders?limit=200")) {
        return Promise.resolve(jsonResponse([currentOrder()]))
      }
      return routeFetchWithOrder(input)
    })
    vi.stubGlobal("fetch", fetchMock)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const { default: userEvent } = await import("@testing-library/user-event")
    const user = userEvent.setup()
    render(<CashierWorkspace />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    })

    await user.click(await screen.findByRole("button", { name: /B1/ }))
    await user.click(await screen.findByRole("button", { name: "İkram" }))
    await user.type(
      screen.getByLabelText("İkram nedeni"),
      "Müşteri memnuniyeti",
    )
    await user.click(
      screen.getByRole("button", { name: /İkram olarak kaydet/ }),
    )

    expect((await screen.findAllByText("₺0,00")).length).toBeGreaterThan(0)
    expect(screen.getByText("İkram nedeni: Müşteri memnuniyeti")).toBeVisible()
    expect(screen.getByRole("button", { name: "İkramı kaldır" })).toBeEnabled()
  })

  it("finds a table by the guest name staff attached to it", async () => {
    vi.stubGlobal("fetch", vi.fn(routeFetchWithOrder))

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { default: userEvent } = await import("@testing-library/user-event")
    const user = userEvent.setup()
    render(<CashierWorkspace />, { wrapper })

    await user.type(await screen.findByPlaceholderText(/Masa ara/), "Ahmet")
    expect(
      await screen.findByRole("button", { name: /B1/ }),
    ).toBeInTheDocument()
  })

  it("lists the pending cancellation request with cafe-friendly labels in the approvals queue", async () => {
    vi.stubGlobal("fetch", vi.fn(routeFetch))

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { default: userEvent } = await import("@testing-library/user-event")
    const user = userEvent.setup()
    render(<CashierWorkspace />, { wrapper })

    await user.click(
      await screen.findByRole("button", { name: /Onay Bekleyenler/ }),
    )

    expect(
      await screen.findByText("İptal talebi · Cheeseburger"),
    ).toBeInTheDocument()
    expect(screen.getByText("Masa 1")).toBeInTheDocument()
    expect(screen.getByText("Onayla")).toBeInTheDocument()
    expect(screen.getByText("Reddet")).toBeInTheDocument()
  })
})

describe("CashierWorkspace floor summary", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("shows what is still to be collected across open tables", async () => {
    vi.stubGlobal("fetch", vi.fn(routeFetchWithOrder))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(<CashierWorkspace />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    })

    const label = await screen.findByText("Tahsil edilecek")
    // Scoped to the strip: the same amount also appears on the card and in the
    // payment panel, so a bare text query would be ambiguous.
    // 260.00 on the floor, nothing paid yet.
    expect(label.parentElement).toHaveTextContent("₺260,00")
    expect(screen.getByText("Açık hesap")).toBeVisible()
  })

  it("puts a dwell timer on an occupied table", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) =>
      String(input).includes("/orders?")
        ? Promise.resolve(jsonResponse([{ ...orderWithDetails, created_at: new Date().toISOString() }]))
        : routeFetchWithOrder(input),
    ))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(<CashierWorkspace />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    })

    // The order was opened just now, so the card reads a fresh duration
    // rather than showing nothing at all.
    expect(await screen.findByText("0dk")).toBeVisible()
  })
})

describe("CashierWorkspace refunds", () => {
  const payment = { id: "payment-1", method: "CARD", amount: "260.00", status: "COMPLETED" }

  function setup({ permission = true, shift = true, fail = false } = {}) {
    let currentOrder = { ...orderWithDetails, status: "PAID", payments: [payment] }
    const refundCalls: RequestInit[] = []
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/auth/me")) return Promise.resolve(jsonResponse({
        ...authContext, user: { ...authContext.user, roleCode: "CASHIER" },
        permissions: permission ? ["payments.manage"] : [],
      }))
      if (url.includes("/shifts/current")) return Promise.resolve(jsonResponse(shift ? { id: "shift-1", status: "OPEN" } : null))
      if (url.endsWith("/refund")) {
        refundCalls.push(init ?? {})
        if (fail) return Promise.resolve(jsonResponse({ detail: "İade yetkisi kaldırıldı" }, 403))
        currentOrder = { ...currentOrder, payments: [{ ...payment, status: "REFUNDED" }] }
        return Promise.resolve(jsonResponse(currentOrder.payments[0]))
      }
      if (url.includes("/orders?")) return Promise.resolve(jsonResponse([currentOrder]))
      return routeFetchWithOrder(input)
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(<QueryClientProvider client={client}><CashierWorkspace /></QueryClientProvider>)
    return refundCalls
  }

  it("requires a reason, records the full payment refund and permits corrected collection", async () => {
    const calls = setup()
    const { default: userEvent } = await import("@testing-library/user-event")
    const user = userEvent.setup({ delay: null })
    await user.click(await screen.findByRole("button", { name: /B1/ }))
    await user.click(screen.getByRole("button", { name: /ödemesini iade et/ }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByRole("button", { name: "İadeyi kaydet" })).toBeDisabled()
    await user.type(within(dialog).getByLabelText("İade gerekçesi"), "  Hatalı POS çekimi  ")
    await user.click(within(dialog).getByRole("button", { name: "İadeyi kaydet" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(calls).toHaveLength(1)
    expect(JSON.parse(String(calls[0].body))).toEqual({ reason: "Hatalı POS çekimi" })
    expect(await screen.findByText("İade edildi")).toBeVisible()
    expect(screen.queryByRole("button", { name: /ödemesini iade et/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Ödeme al/ })).toBeEnabled()
  })

  it("preserves the dialog and payment when the server rejects a refund", async () => {
    setup({ fail: true })
    const { default: userEvent } = await import("@testing-library/user-event")
    const user = userEvent.setup({ delay: null })
    await user.click(await screen.findByRole("button", { name: /B1/ }))
    await user.click(screen.getByRole("button", { name: /ödemesini iade et/ }))
    await user.type(screen.getByLabelText("İade gerekçesi"), "Yanlış tahsilat")
    await user.click(screen.getByRole("button", { name: "İadeyi kaydet" }))
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(screen.getByLabelText("İade gerekçesi")).toHaveValue("Yanlış tahsilat")
    expect(screen.queryByText("İade edildi")).not.toBeInTheDocument()
  })

  it.each([{ permission: false, shift: true }, { permission: true, shift: false }])(
    "prevents a refund without permission or an active cashier shift: %o", async (options) => {
      setup(options)
      const { default: userEvent } = await import("@testing-library/user-event")
      await userEvent.setup({ delay: null }).click(await screen.findByRole("button", { name: /B1/ }))
      const button = screen.queryByRole("button", { name: /ödemesini iade et/ })
      if (options.permission) expect(button).toBeDisabled()
      else expect(button).not.toBeInTheDocument()
    },
  )
})

describe("CashierWorkspace table states", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("tells a ready table apart from one that is merely occupied", async () => {
    // The fixture table is PREPARING; it must not read as a generic "Dolu",
    // or the cashier cannot see which table actually needs them.
    vi.stubGlobal("fetch", vi.fn(routeFetchWithOrder))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(<CashierWorkspace />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    })

    // Scoped to the card: "Dolu" also exists as a filter chip, so a bare
    // negative query would be testing the wrong element.
    const label = await screen.findByText("Hazırlanıyor")
    const card = label.closest("button")
    expect(card).toHaveTextContent("B1")
    expect(card).not.toHaveTextContent("Dolu")
  })
})
