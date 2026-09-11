import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CashierShiftGate } from "@/components/cashier/cashier-shift-gate"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function renderGate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return render(<CashierShiftGate />, { wrapper })
}

describe("CashierShiftGate", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("requires staff PIN before showing the opening cash step", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/shifts/current")) return Promise.resolve(jsonResponse(null))
      if (url.includes("/shifts/verify")) return Promise.resolve(jsonResponse({ user_id: "user-1", username: "cashier", display_name: "Ahmet Yılmaz" }))
      throw new Error(`Unexpected request: ${url}`)
    }))
    renderGate()
    expect(await screen.findByText("Dixora Kasa")).toBeInTheDocument()
    expect(screen.getByText("Çalışan kimliğinizi doğrulayın")).toBeInTheDocument()
    expect(screen.queryByLabelText("Açılış nakdi")).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Kullanıcı adı"), { target: { value: "cashier" } })
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1357" } })
    fireEvent.click(screen.getByRole("button", { name: "Devam" }))
    expect(await screen.findByText("Ahmet Yılmaz")).toBeInTheDocument()
    expect(screen.getByLabelText("Açılış nakdi")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Vardiyayı Aç/ })).toBeInTheDocument()
  })

  it("shows an error state when the shift status cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("/shifts/current")) return Promise.resolve(jsonResponse({ error: { message: "Sunucu hatası" } }, 500))
      throw new Error(`Unexpected request: ${String(input)}`)
    }))
    renderGate()
    expect(await screen.findByText("Vardiya bilgisi alınamadı")).toBeInTheDocument()
  })
})
