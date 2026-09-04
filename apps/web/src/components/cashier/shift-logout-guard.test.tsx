import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ShiftLogoutGuard } from "@/components/cashier/shift-logout-guard"

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function setup(shift: unknown) {
  const onLogoutAnyway = vi.fn()
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(shift))))
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  render(
    <ShiftLogoutGuard
      open
      onOpenChange={() => {}}
      onLogoutAnyway={onLogoutAnyway}
    />,
    { wrapper },
  )
  return { onLogoutAnyway }
}

describe("ShiftLogoutGuard", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("sends the cashier to close an open till instead of logging straight out", async () => {
    const { onLogoutAnyway } = setup({
      id: "s-1",
      cashier_name: "Halit",
      opened_at: new Date().toISOString(),
    })

    expect(await screen.findByText("Vardiyanız hâlâ açık")).toBeVisible()
    const action = screen.getByRole("link", { name: /Vardiyayı kapat/ })
    expect(action).toHaveAttribute("href", "/cashier/shift")
    // The drawer must be counted; there is no "log out anyway" escape here.
    expect(screen.queryByRole("button", { name: "Çıkış yap" })).not.toBeInTheDocument()
    expect(onLogoutAnyway).not.toHaveBeenCalled()
  })

  it("logs out directly when no shift is open", async () => {
    const user = userEvent.setup({ delay: null })
    const { onLogoutAnyway } = setup(null)

    await user.click(await screen.findByRole("button", { name: "Çıkış yap" }))
    expect(onLogoutAnyway).toHaveBeenCalledTimes(1)
  })
})
