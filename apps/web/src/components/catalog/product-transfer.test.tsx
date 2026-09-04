import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ProductTransfer } from "@/components/catalog/product-transfer"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const preview = {
  status: "READY",
  dry_run: true,
  total_rows: 12,
  valid_rows: 11,
  imported_rows: 0,
  failed_rows: 1,
  errors: [{ row_number: 7, field: "Satış Fiyatı", message: "Sayı okunamadı." }],
}

function setup(result: unknown = preview) {
  const calls: Array<{ url: string; method: string }> = []
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, method: init?.method ?? "GET" })
      if (url.includes("csv-import")) return Promise.resolve(jsonResponse(result))
      return Promise.resolve(new Response(new Blob(["PK"])))
    }),
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(<ProductTransfer />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
  return { calls }
}

function xlsx(name = "urunler.xlsx") {
  return new File(["PK"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
}

describe("ProductTransfer", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("offers both halves of the journey", () => {
    setup()
    expect(screen.getByRole("button", { name: /Ürünleri indir/ })).toBeVisible()
    expect(screen.getByRole("button", { name: /Ürün yükle/ })).toBeVisible()
  })

  it("previews a file before applying it", async () => {
    const user = userEvent.setup({ delay: null })
    const { calls } = setup()

    await user.upload(screen.getByLabelText("Ürün dosyası seç"), xlsx())

    await waitFor(() => expect(screen.getByText("Yüklemeden önce kontrol")).toBeVisible())
    // The first call must be a dry run: nothing is written yet.
    const importCall = calls.find((call) => call.url.includes("csv-import"))
    expect(importCall?.url).toContain("dry_run=true")
  })

  it("shows which rows would fail and why", async () => {
    const user = userEvent.setup({ delay: null })
    setup()

    await user.upload(screen.getByLabelText("Ürün dosyası seç"), xlsx())

    expect(await screen.findByText("7. satır")).toBeVisible()
    expect(screen.getByText("Sayı okunamadı.")).toBeVisible()
    // Counts, so the owner knows the scale before committing.
    expect(screen.getByText("12")).toBeVisible()
    expect(screen.getByText("11")).toBeVisible()
  })

  it("says that missing products are not deleted", async () => {
    const user = userEvent.setup({ delay: null })
    setup()

    await user.upload(screen.getByLabelText("Ürün dosyası seç"), xlsx())
    expect(
      await screen.findByText(/Dosyada bulunmayan ürünler hiçbir durumda silinmez/),
    ).toBeVisible()
  })

  it("applies only after confirmation, and not as a dry run", async () => {
    const user = userEvent.setup({ delay: null })
    const { calls } = setup()

    await user.upload(screen.getByLabelText("Ürün dosyası seç"), xlsx())
    await user.click(await screen.findByRole("button", { name: /11 ürünü yükle/ }))

    await waitFor(() => {
      const applied = calls.filter((call) => call.url.includes("dry_run=false"))
      expect(applied).toHaveLength(1)
    })
  })

  it("will not apply a file where nothing is usable", async () => {
    const user = userEvent.setup({ delay: null })
    setup({ ...preview, valid_rows: 0, failed_rows: 12 })

    await user.upload(screen.getByLabelText("Ürün dosyası seç"), xlsx())
    expect(
      await screen.findByRole("button", { name: /0 ürünü yükle/ }),
    ).toBeDisabled()
  })

  it("adds rather than overwrites unless told otherwise", async () => {
    const user = userEvent.setup({ delay: null })
    const { calls } = setup()

    await user.upload(screen.getByLabelText("Ürün dosyası seç"), xlsx())
    await screen.findByText("Yüklemeden önce kontrol")

    // A live menu must not be rewritten by an unqualified "upload".
    const first = calls.find((call) => call.url.includes("csv-import"))
    expect(first?.url).toContain("update_existing=false")
    expect(
      screen.getByRole("checkbox", { name: /Mevcut ürünleri güncelle/ }),
    ).not.toBeChecked()
  })

  it("re-checks the file when update mode is switched on", async () => {
    const user = userEvent.setup({ delay: null })
    const { calls } = setup()

    await user.upload(screen.getByLabelText("Ürün dosyası seç"), xlsx())
    await screen.findByText("Yüklemeden önce kontrol")
    await user.click(
      screen.getByRole("checkbox", { name: /Mevcut ürünleri güncelle/ }),
    )

    // The same sheet reads differently under the switch, so the preview is
    // recomputed rather than left showing stale counts.
    await waitFor(() => {
      expect(
        calls.filter((call) => call.url.includes("update_existing=true")),
      ).not.toHaveLength(0)
    })
  })
})
