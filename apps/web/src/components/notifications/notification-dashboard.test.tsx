import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NotificationDashboard } from "./notification-dashboard"

function setup(response: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  render(<NotificationDashboard />, { wrapper })
}

describe("customer notifications", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("shows reward reminders and pending retries with masked recipients", async () => {
    setup({
      delivery_mode: "RESEND",
      counts: { PENDING: 0, SENT: 0, FAILED: 1, CANCELLED: 0 },
      items: [
        {
          id: "notification-1",
          notification_type: "LOYALTY_REWARD_AVAILABLE",
          recipient: "a***@example.com",
          title: "1 ücretsiz Kahve",
          status: "FAILED",
          attempts: 1,
          retry_scheduled: true,
          created_at: "2026-10-14T10:00:00Z",
          sent_at: null,
          next_attempt_at: "2026-10-14T10:02:00Z",
        },
      ],
    })
    expect(await screen.findByText("1 ücretsiz Kahve")).toBeVisible()
    expect(screen.getByText("Yeniden denenecek")).toBeVisible()
    expect(screen.getByText(/a\*\*\*@example.com/)).toBeVisible()
    expect(screen.getByText(/Sonraki deneme:/)).toBeVisible()
    expect(screen.queryByText(/Geliştirme modu açık/)).not.toBeInTheDocument()
  })

  it("explains development delivery without implying a real email was sent", async () => {
    setup({
      delivery_mode: "DEVELOPMENT",
      counts: { PENDING: 0, SENT: 0, FAILED: 0, CANCELLED: 0 },
      items: [],
    })
    expect(await screen.findByText(/gerçek e-posta gönderilmez/)).toBeVisible()
    expect(screen.getByText("Henüz bildirim yok")).toBeVisible()
  })

  it("shows a retry action when notifications cannot be loaded", async () => {
    setup({ error: { message: "Bildirimler okunamadı" } }, 500)
    expect(
      await screen.findByRole("button", { name: /Yeniden dene/i }),
    ).toBeVisible()
    expect(screen.queryByText("Henüz bildirim yok")).not.toBeInTheDocument()
  })
})
