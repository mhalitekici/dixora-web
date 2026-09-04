import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
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

function routeFetchWithOrder(input: RequestInfo | URL) {
  const url = String(input)
  if (url.includes("/tables/areas")) {
    return Promise.resolve(jsonResponse([{ id: "area-1", name: "Salon" }]))
  }
  if (url.includes("/catalog/products")) return Promise.resolve(jsonResponse([]))
  if (url.includes("/shifts/current")) {
    return Promise.resolve(
      jsonResponse({ id: "shift-1", status: "OPEN", opening_cash: "1500.00" }),
    )
  }
  if (url.includes("/orders/approval-requests")) return Promise.resolve(jsonResponse([]))
  if (url.includes("/orders")) return Promise.resolve(jsonResponse([orderWithDetails]))
  if (url.includes("/qr/requests")) return Promise.resolve(jsonResponse([]))
  if (url.endsWith("/tables") || url.includes("/tables?")) {
    return Promise.resolve(jsonResponse([tableWithOrder]))
  }
  return Promise.resolve(jsonResponse([]))
}

function routeFetch(input: RequestInfo | URL) {
  const url = String(input)
  if (url.includes("/tables/areas")) return Promise.resolve(jsonResponse([]))
  if (url.includes("/catalog/products")) return Promise.resolve(jsonResponse([]))
  if (url.includes("/shifts/current")) {
    return Promise.resolve(
      jsonResponse({ id: "shift-1", status: "OPEN", opening_cash: "1500.00" }),
    )
  }
  if (url.includes("/orders/approval-requests")) {
    return Promise.resolve(jsonResponse([cancellationApproval]))
  }
  if (url.includes("/orders")) return Promise.resolve(jsonResponse([]))
  if (url.includes("/qr/requests")) return Promise.resolve(jsonResponse([qrRequest]))
  if (url.endsWith("/tables") || url.includes("/tables?")) {
    return Promise.resolve(jsonResponse([]))
  }
  throw new Error(`Unexpected request: ${url}`)
}

describe("CashierWorkspace", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
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

    const qrButton = await screen.findByRole("button", { name: /QR Siparişleri/ })
    expect(qrButton).toHaveTextContent("1")

    const approvalsButton = screen.getByRole("button", { name: /Onay Bekleyenler/ })
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
    expect(await screen.findByRole("button", { name: /B1/ })).toBeInTheDocument()
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

    await user.click(await screen.findByRole("button", { name: /Onay Bekleyenler/ }))

    expect(await screen.findByText("İptal talebi · Cheeseburger")).toBeInTheDocument()
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
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
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
    vi.stubGlobal("fetch", vi.fn(routeFetchWithOrder))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(<CashierWorkspace />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })

    // The order was opened just now, so the card reads a fresh duration
    // rather than showing nothing at all.
    expect(await screen.findByText("0dk")).toBeVisible()
  })
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
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
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
