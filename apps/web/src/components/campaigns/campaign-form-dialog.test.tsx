import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CampaignFormDialog } from "@/components/campaigns/campaign-form-dialog"

const COFFEE = "aaaaaaaa-0000-0000-0000-000000000001"
const DESSERT = "aaaaaaaa-0000-0000-0000-000000000002"
const BRANCH = "bbbbbbbb-0000-0000-0000-000000000001"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function setup(editing: Parameters<typeof CampaignFormDialog>[0]["editing"] = null) {
  const posted: Array<{ url: string; method: string; body: unknown }> = []
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      if (method !== "GET") {
        posted.push({ url, method, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(jsonResponse({ id: "new", summary: "özet" }, 201))
      }
      if (url.includes("catalog/products")) {
        return Promise.resolve(
          jsonResponse({
            items: [
              { id: COFFEE, name: "Filtre Kahve" },
              { id: DESSERT, name: "Tiramisu" },
            ],
          }),
        )
      }
      if (url.includes("catalog/categories")) {
        return Promise.resolve(jsonResponse([{ id: "cat-1", name: "Tatlılar" }]))
      }
      if (url.includes("branches")) {
        return Promise.resolve(
          jsonResponse([{ id: BRANCH, name: "Merkez", is_active: true }]),
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    }),
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  render(
    <CampaignFormDialog open onOpenChange={() => {}} editing={editing} />,
    { wrapper },
  )
  return { posted }
}

describe("CampaignFormDialog", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("cannot save an offer that is missing a side of the sentence", async () => {
    const user = userEvent.setup({ delay: null })
    setup()

    const save = await screen.findByRole("button", { name: /Kampanyayı oluştur/ })
    expect(save).toBeDisabled()

    await user.type(screen.getByLabelText("Kampanya adı"), "Kahve alana tatlı")
    // Name alone is not an offer: the buy and give sides are still empty.
    expect(save).toBeDisabled()
  })

  it("asks for a value when the reward is a discount rather than a free item", async () => {
    const user = userEvent.setup({ delay: null })
    setup()

    await screen.findByLabelText("Kampanya adı")
    // FREE_ITEM needs no number, so the field is absent until the kind changes.
    expect(screen.queryByLabelText("Yüzde (%)")).not.toBeInTheDocument()

    await user.click(screen.getByLabelText("İkram türü"))
    await user.click(await screen.findByRole("option", { name: "Yüzde indirim" }))

    expect(await screen.findByLabelText("Yüzde (%)")).toBeVisible()
  })

  it("sends the offer the owner described", async () => {
    const user = userEvent.setup({ delay: null })
    const { posted } = setup()

    await user.type(
      await screen.findByLabelText("Kampanya adı"),
      "Kahve alana tatlı",
    )
    await user.click(screen.getByLabelText("Koşul"))
    await user.click(await screen.findByRole("option", { name: "Filtre Kahve" }))
    await user.click(screen.getByLabelText("İkram"))
    await user.click(await screen.findByRole("option", { name: "Tiramisu" }))
    await user.click(screen.getByRole("checkbox", { name: "Merkez" }))

    const save = screen.getByRole("button", { name: /Kampanyayı oluştur/ })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    await waitFor(() => expect(posted).toHaveLength(1))
    const body = posted[0].body as Record<string, unknown>
    expect(body.name).toBe("Kahve alana tatlı")
    expect(body.buy_product_id).toBe(COFFEE)
    expect(body.reward_product_id).toBe(DESSERT)
    expect(body.reward_kind).toBe("FREE_ITEM")
    expect(body.branch_ids).toEqual([BRANCH])
  })

  it("carries the version when editing so concurrent edits are caught", async () => {
    const user = userEvent.setup({ delay: null })
    const { posted } = setup({
      id: "c-1",
      name: "Mevcut",
      description: null,
      is_active: true,
      branch_ids: [BRANCH],
      buy_product_id: COFFEE,
      buy_category_id: null,
      buy_quantity: 1,
      minimum_order_amount: "0",
      reward_kind: "FREE_ITEM",
      reward_product_id: DESSERT,
      reward_category_id: null,
      reward_quantity: 1,
      reward_value: "0",
      audience: "MEMBERS_ONLY",
      max_uses_per_order: 1,
      starts_at: null,
      ends_at: null,
      version: 7,
      summary: "Filtre Kahve alana Tiramisu ikram",
    })

    await user.click(await screen.findByRole("button", { name: /Kaydet/ }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].method).toBe("PUT")
    expect((posted[0].body as Record<string, unknown>).expected_version).toBe(7)
  })
})
