import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ProductCsvActions } from "./product-csv-actions"

const mocks = vi.hoisted(() => ({
  apiDownload: vi.fn(),
  apiPost: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  api: { post: mocks.apiPost },
  apiDownload: mocks.apiDownload,
}))

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}))

function renderActions() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductCsvActions />
    </QueryClientProvider>,
  )
}

describe("ProductCsvActions", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:excel-template"),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("downloads the native Excel template and accepts Excel or legacy CSV", async () => {
    mocks.apiDownload.mockResolvedValue(new Blob(["xlsx"]))
    const user = userEvent.setup()
    renderActions()

    const input = screen.getByLabelText("Excel veya CSV ürün dosyası seç")
    expect(input).toHaveAttribute(
      "accept",
      ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv",
    )

    await user.click(screen.getByRole("button", { name: "İçe / dışa aktar" }))
    await user.click(
      await screen.findByText("Excel ürün tablosunu indir (.xlsx)"),
    )

    await waitFor(() =>
      expect(mocks.apiDownload).toHaveBeenCalledWith(
        "catalog/products/import-template",
      ),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Düzenlenebilir Excel ürün tablosu indirildi.",
    )
  })

  it("previews a completed xlsx file before importing it", async () => {
    mocks.apiPost.mockResolvedValue({
      status: "READY",
      dry_run: true,
      total_rows: 1,
      valid_rows: 1,
      imported_rows: 0,
      failed_rows: 0,
      rows: [
        {
          row_number: 2,
          category: "Ana Yemekler",
          name: "Izgara Köfte",
          selling_price: "325.00",
          sku: "YEM-001",
        },
      ],
      errors: [],
    })
    const user = userEvent.setup()
    renderActions()

    const file = new File(["xlsx"], "ürünler.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    await user.upload(
      screen.getByLabelText("Excel veya CSV ürün dosyası seç"),
      file,
    )

    expect(await screen.findByText("Izgara Köfte")).toBeVisible()
    expect(screen.getByText("Ürün tablosu önizleme ve doğrulama")).toBeVisible()
    expect(mocks.apiPost).toHaveBeenCalledWith(
      "catalog/products/csv-import",
      expect.any(FormData),
      expect.objectContaining({ search: { dry_run: true } }),
    )
  })
})
