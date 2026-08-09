import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CashierShiftGate } from "@/components/cashier/cashier-shift-gate"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function renderGate() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(<CashierShiftGate />, { wrapper })
}

describe("CashierShiftGate", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("shows the minimal shift-open screen when there is no active shift", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes("/shifts/current")) return Promise.resolve(jsonResponse(null))
        throw new Error(`Unexpected request: ${url}`)
      }),
    )

    renderGate()

    expect(await screen.findByText("Dixora Kasa")).toBeInTheDocument()
    expect(screen.getByText("Vardiya kapalı")).toBeInTheDocument()
    expect(screen.getByLabelText("Açılış nakdi")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Vardiyayı Aç/ })).toBeInTheDocument()
    expect(screen.queryByText("Kasa çalışma alanı yükleniyor")).not.toBeInTheDocument()
  })

  it("shows an error state when the shift status cannot be fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes("/shifts/current")) {
          return Promise.resolve(jsonResponse({ error: { message: "Sunucu hatası" } }, 500))
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )

    renderGate()

    expect(await screen.findByText("Vardiya bilgisi alınamadı")).toBeInTheDocument()
  })
})
