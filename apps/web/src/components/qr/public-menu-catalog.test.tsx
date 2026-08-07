import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { PublicMenuCatalog } from "@/components/qr/public-menu-catalog"
import type {
  QrCategoryDto,
  QrProductDto,
} from "@/components/qr/types"

const categories: QrCategoryDto[] = [
  {
    id: "c_breakfast",
    name: "Kahvaltı",
    description: null,
    color: "#ec5a20",
    sort_order: 1,
  },
]

const products: QrProductDto[] = [
  {
    id: "p_toast",
    category_id: "c_breakfast",
    name: "Dixora Tost",
    description: "Eski kaşar, domates ve ekşi maya ekmeği",
    selling_price: "185.00",
    image_url:
      "/api/v1/media/products/0123456789abcdef01234567/0123456789abcdef0123456789abcdef.webp",
    allergens: ["Gluten", "Süt"],
    modifier_groups: [],
  },
]

describe("PublicMenuCatalog", () => {
  it("renders uploaded product media and opens the product action", () => {
    const onSelectProduct = vi.fn()
    const { container } = render(
      <PublicMenuCatalog
        categories={categories}
        products={products}
        currency="TRY"
        allergensVisible
        onSelectProduct={onSelectProduct}
      />,
    )

    expect(screen.getByRole("heading", { name: "Kahvaltı" })).toBeVisible()
    expect(screen.getByText("Alerjen: Gluten, Süt")).toBeVisible()
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("0123456789abcdef0123456789abcdef.webp"),
    )

    fireEvent.click(screen.getByRole("button", { name: /Dixora Tost/i }))
    expect(onSelectProduct).toHaveBeenCalledWith(products[0])
  })

  it("provides a directed empty state", () => {
    render(
      <PublicMenuCatalog
        categories={categories}
        products={[]}
        currency="TRY"
        allergensVisible
        onSelectProduct={vi.fn()}
      />,
    )

    expect(screen.getByRole("heading", { name: "Ürün bulunamadı" })).toBeVisible()
    expect(
      screen.getByText("Aramanızı veya kategori filtrenizi değiştirin."),
    ).toBeVisible()
  })
})
