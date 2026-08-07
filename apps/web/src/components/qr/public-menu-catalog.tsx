import { ChevronRight, ImageIcon, Search } from "lucide-react"
import Image from "next/image"
import { useMemo } from "react"

import type {
  QrCategoryDto,
  QrProductDto,
} from "@/components/qr/types"
import {
  decimalToMinor,
  formatMinorMoney,
} from "@/components/qr/qr-utils"

interface PublicMenuCatalogProps {
  categories: QrCategoryDto[]
  products: QrProductDto[]
  currency: string
  allergensVisible: boolean
  onSelectProduct: (product: QrProductDto) => void
}

export function PublicMenuCatalog({
  categories,
  products,
  currency,
  allergensVisible,
  onSelectProduct,
}: PublicMenuCatalogProps) {
  const sections = useMemo(() => {
    const byCategory = new Map<string, QrProductDto[]>()
    for (const product of products) {
      const current = byCategory.get(product.category_id)
      if (current) current.push(product)
      else byCategory.set(product.category_id, [product])
    }

    return categories.flatMap((category) => {
      const categoryProducts = byCategory.get(category.id) ?? []
      return categoryProducts.length > 0
        ? [{ category, products: categoryProducts }]
        : []
    })
  }, [categories, products])

  if (products.length === 0) {
    return (
      <div className="mt-8 border-y border-dashed border-[#2b2522]/25 bg-[#fffaf2] px-6 py-12 text-center">
        <Search className="mx-auto size-8 text-[#847a74]" />
        <h2 className="mt-3 font-serif text-xl font-semibold text-[#2b2522]">
          Ürün bulunamadı
        </h2>
        <p className="mt-1 text-sm text-[#756b65]">
          Aramanızı veya kategori filtrenizi değiştirin.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-7 space-y-10" aria-label="Ürünler">
      {sections.map(({ category, products: categoryProducts }, sectionIndex) => (
        <section key={category.id} aria-labelledby={`menu-category-${category.id}`}>
          <div className="mb-3 flex items-end gap-3">
            <span className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.16em] text-[var(--qr-primary)]">
              Menü {String(sectionIndex + 1).padStart(2, "0")}
            </span>
            <span className="mb-1 h-px flex-1 bg-[#2b2522]/15" aria-hidden="true" />
          </div>
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2
              id={`menu-category-${category.id}`}
              className="font-serif text-2xl font-semibold tracking-[-0.025em] text-[#2b2522] sm:text-3xl"
            >
              {category.name}
            </h2>
            <span className="shrink-0 font-mono text-[0.65rem] text-[#847a74]">
              {categoryProducts.length} seçenek
            </span>
          </div>

          <div className="divide-y divide-dashed divide-[#2b2522]/20 border-y border-[#2b2522]/15 bg-[#fffaf2]">
            {categoryProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => onSelectProduct(product)}
                className="focus-operational group flex min-h-32 w-full items-stretch text-left transition-colors hover:bg-[color-mix(in_srgb,var(--qr-primary)_7%,#fffaf2)] sm:min-h-36"
              >
                <div className="flex min-w-0 flex-1 flex-col px-4 py-4 sm:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-serif text-lg font-semibold leading-5 text-[#2b2522] sm:text-xl">
                      {product.name}
                    </h3>
                    {!product.image_url ? (
                      <ChevronRight className="mt-0.5 size-4 shrink-0 text-[#938983] transition-transform group-hover:translate-x-0.5" />
                    ) : null}
                  </div>
                  <p className="mt-2 line-clamp-2 max-w-xl text-xs leading-5 text-[#756b65] sm:text-sm">
                    {product.description || "İçeriğini ve seçim seçeneklerini görüntüleyin."}
                  </p>
                  {allergensVisible && product.allergens.length > 0 ? (
                    <p className="mt-2 line-clamp-1 text-[0.68rem] font-medium text-[#9b4e28]">
                      Alerjen: {product.allergens.join(", ")}
                    </p>
                  ) : null}
                  <p className="mt-auto pt-3 font-mono text-sm font-bold tabular-nums text-[#2b2522] sm:text-base">
                    {formatMinorMoney(
                      decimalToMinor(product.selling_price),
                      currency,
                    )}
                  </p>
                </div>

                {product.image_url ? (
                  <div className="relative w-28 shrink-0 overflow-hidden border-l border-[#2b2522]/10 bg-[#e8dfd2] sm:w-40">
                    <Image
                      src={product.image_url}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 112px, 160px"
                      className="object-cover transition-transform duration-300 motion-reduce:transition-none group-hover:scale-[1.03]"
                    />
                    <span className="absolute bottom-2 right-2 bg-[#fffaf2]/95 px-2 py-1 font-mono text-[0.58rem] font-bold uppercase tracking-[0.12em] text-[#2b2522]">
                      İncele
                    </span>
                  </div>
                ) : (
                  <div className="hidden w-24 shrink-0 items-center justify-center border-l border-[#2b2522]/10 bg-[#f5eee4] text-[#9a8f88] sm:flex">
                    <ImageIcon className="size-5" aria-hidden="true" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
