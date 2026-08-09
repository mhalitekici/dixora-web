import { Plus, Search, UtensilsCrossed } from "lucide-react"
import Image from "next/image"
import { useMemo } from "react"

import { translate, type QrLocale } from "@/components/qr/qr-i18n"
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
  locale: QrLocale
}

export function PublicMenuCatalog({
  categories,
  products,
  currency,
  allergensVisible,
  onSelectProduct,
  locale,
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
      <div className="mt-8 rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
        <Search className="mx-auto size-8 text-muted-foreground/60" />
        <h2 className="mt-3 text-lg font-semibold">{translate(locale, "product_not_found")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {translate(locale, "product_not_found_desc")}
        </p>
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-9" aria-label="Ürünler">
      {sections.map(({ category, products: categoryProducts }, sectionIndex) => (
        <section
          key={category.id}
          aria-labelledby={`menu-category-${category.id}`}
          className="animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-both duration-500"
          style={{ animationDelay: `${Math.min(sectionIndex, 4) * 70}ms` }}
        >
          <div className="mb-3.5 flex items-center justify-between gap-3">
            <h2
              id={`menu-category-${category.id}`}
              className="flex items-center gap-2 text-xl font-bold tracking-[-0.02em] sm:text-[1.4rem]"
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: category.color || "var(--qr-primary)" }}
                aria-hidden="true"
              />
              {category.name}
            </h2>
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {translate(locale, "options_count", { n: categoryProducts.length })}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {categoryProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => onSelectProduct(product)}
                className="focus-operational group flex flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-[transform,box-shadow,border-color] active:scale-[0.98] sm:hover:-translate-y-0.5 sm:hover:border-[var(--qr-primary)]/30 sm:hover:shadow-lg sm:hover:shadow-black/5"
              >
                <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-muted">
                  {product.image_url ? (
                    <Image
                      src={product.image_url}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 45vw, 280px"
                      className="object-cover transition-transform duration-300 motion-reduce:transition-none sm:group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground/40">
                      <UtensilsCrossed className="size-7" aria-hidden="true" />
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-1 p-3">
                  <h3 className="line-clamp-1 text-sm font-semibold leading-5 sm:text-base">
                    {product.name}
                  </h3>
                  <p className="line-clamp-2 flex-1 text-xs leading-5 text-muted-foreground">
                    {product.description || translate(locale, "tap_for_details")}
                  </p>
                  {product.calories != null ? (
                    <p className="text-[0.68rem] font-medium tabular-nums text-muted-foreground">
                      {product.calories} kcal
                    </p>
                  ) : null}
                  {allergensVisible && product.allergens.length > 0 ? (
                    <p className="line-clamp-1 text-[0.68rem] font-medium text-amber-700 dark:text-amber-400">
                      {translate(locale, "allergen_label")}: {product.allergens.join(", ")}
                    </p>
                  ) : null}
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="text-sm font-bold tabular-nums text-[var(--qr-primary)] sm:text-base">
                      {formatMinorMoney(decimalToMinor(product.selling_price), currency)}
                    </span>
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--qr-primary)] text-[var(--qr-on-primary)] transition-transform sm:group-hover:scale-110">
                      <Plus className="size-4" />
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
