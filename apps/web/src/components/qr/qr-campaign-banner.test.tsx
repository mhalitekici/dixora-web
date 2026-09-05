import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { QrCampaignBanner } from "@/components/qr/qr-campaign-banner"
import type { PublicCampaignDto } from "@/components/qr/types"

const MEMBERS_ONLY: PublicCampaignDto = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Latte Alana Tiramisu",
  description: null,
  summary: "Caffe Latte alana Tiramisu ikram",
  audience: "MEMBERS_ONLY",
  starts_at: null,
  ends_at: null,
}

const EVERYONE: PublicCampaignDto = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Tatlı Günü",
  description: "Hafta içi her gün.",
  summary: "2 tatlı alana çay ikram",
  audience: "EVERYONE",
  starts_at: null,
  ends_at: null,
}

function setup(respond: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(respond))
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(
    <QrCampaignBanner
      businessSlug="dixora-lab"
      branchSlug="merkez"
      locale="tr"
    />,
    { wrapper },
  )
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("QrCampaignBanner", () => {
  it("shows the live offer to the guest", async () => {
    setup(() => Promise.resolve(jsonResponse([EVERYONE])))

    expect(
      await screen.findByText(/2 tatlı alana çay ikram/),
    ).toBeInTheDocument()
    expect(screen.getByText("Hafta içi her gün.")).toBeInTheDocument()
  })

  it("says a members-only offer needs membership", async () => {
    // A guest must not read a members-only offer as something they already
    // qualify for — the code is what unlocks it.
    setup(() => Promise.resolve(jsonResponse([MEMBERS_ONLY])))

    expect(
      await screen.findByText(/Caffe Latte alana Tiramisu ikram/),
    ).toBeInTheDocument()
    expect(screen.getByText("Üyelere özel:")).toBeInTheDocument()
    expect(screen.queryByText("Kampanya:")).not.toBeInTheDocument()
  })

  it("labels an open offer without the membership wording", async () => {
    setup(() => Promise.resolve(jsonResponse([EVERYONE])))

    expect(await screen.findByText("Kampanya:")).toBeInTheDocument()
    expect(screen.queryByText("Üyelere özel:")).not.toBeInTheDocument()
  })

  it("lists every live offer", async () => {
    setup(() => Promise.resolve(jsonResponse([MEMBERS_ONLY, EVERYONE])))

    await screen.findByText(/Caffe Latte alana Tiramisu ikram/)
    expect(screen.getByText(/2 tatlı alana çay ikram/)).toBeInTheDocument()
  })

  it("renders no empty box when nothing is running", async () => {
    const { container } = setup(() => Promise.resolve(jsonResponse([])))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it("stays out of the way when the offers cannot be loaded", async () => {
    // The guest came here to read the menu; a failed offer lookup must not put
    // an error on the page, and must never take the menu down with it.
    const { container } = setup(() =>
      Promise.resolve(jsonResponse({ error: { code: "server_error" } }, 500)),
    )

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
