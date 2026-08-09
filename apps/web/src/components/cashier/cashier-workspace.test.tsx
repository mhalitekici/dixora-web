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
