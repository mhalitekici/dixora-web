"use client"

import {
  AlertCircle,
  ChevronRight,
  Search,
  ShoppingBag,
  UtensilsCrossed,
} from "lucide-react"
import type { CSSProperties } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { PublicLoyalty } from "@/components/loyalty/public-loyalty"
import { CartDrawer } from "@/components/qr/cart-drawer"
import { QrBrandIntro } from "@/components/qr/qr-brand-intro"
import {
  useCreatePublicQrRequest,
  usePublicQrMenu,
} from "@/components/qr/qr-hooks"
import { ProductDrawer } from "@/components/qr/product-drawer"
import { PublicMenuCatalog } from "@/components/qr/public-menu-catalog"
import { PublicMenuHeader } from "@/components/qr/public-menu-header"
import { QrRequestStatus } from "@/components/qr/request-status"
import type { PublicQrRequestDto, QrProductDto } from "@/components/qr/types"
import { readableForeground } from "@/components/qr/qr-utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  selectCartItemCount,
  useCartStore,
} from "@/stores/cart-store"

interface PublicMenuProps {
  businessSlug: string
  branchSlug: string
  tableToken?: string | null
}

export function PublicMenu({
  businessSlug,
  branchSlug,
  tableToken = null,
}: PublicMenuProps) {
  const menuQuery = usePublicQrMenu(businessSlug, branchSlug, tableToken)
  const createRequest = useCreatePublicQrRequest(businessSlug, branchSlug)
  const [search, setSearch] = useState("")
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] =
    useState<QrProductDto | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [submittedRequest, setSubmittedRequest] =
    useState<PublicQrRequestDto | null>(null)
  const idempotencyKeyRef = useRef<string | null>(null)
  const lines = useCartStore((state) => state.lines)
  const addLine = useCartStore((state) => state.addLine)
  const clearCart = useCartStore((state) => state.clear)
  const setCartContext = useCartStore((state) => state.setContext)
  const cartCount = useCartStore(selectCartItemCount)
  const menu = menuQuery.data

  useEffect(() => {
    if (menu) {
      setCartContext(menu.context_key, tableToken)
    }
  }, [menu, setCartContext, tableToken])

  const visibleProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("tr-TR")
    return (menu?.products ?? []).filter((product) => {
      const inCategory = !categoryId || product.category_id === categoryId
      const matchesSearch =
        !normalizedSearch ||
        `${product.name} ${product.description ?? ""}`
          .toLocaleLowerCase("tr-TR")
          .includes(normalizedSearch)
      return inCategory && matchesSearch
    })
  }, [categoryId, menu?.products, search])

  if (menuQuery.isLoading) {
    return <PublicMenuSkeleton />
  }

  if (menuQuery.isError || !menu) {
    const message =
      menuQuery.error instanceof ApiError
        ? menuQuery.error.message
        : "Menü şu anda görüntülenemiyor."
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-5">
        <section className="w-full max-w-md rounded-3xl border bg-card p-7 text-center">
          <AlertCircle className="mx-auto size-10 text-destructive" />
          <h1 className="mt-4 text-xl font-semibold">Menüye ulaşılamadı</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {message}
          </p>
          <Button
            type="button"
            className="mt-5 h-11 rounded-xl"
            onClick={() => void menuQuery.refetch()}
          >
            Tekrar dene
          </Button>
        </section>
      </main>
    )
  }

  if (submittedRequest) {
    return (
      <QrRequestStatus
        request={submittedRequest}
        business={menu.business}
        onBack={() => setSubmittedRequest(null)}
      />
    )
  }

  const modeAllowsOrder =
    menu.config.order_mode === "WAITER_APPROVAL" ||
    menu.config.order_mode === "AUTOMATIC_ACCEPTANCE"
  const orderingEnabled = Boolean(
    tableToken && menu.session_token && modeAllowsOrder,
  )
  const primary = menu.config.primary_color || "#ec5a20"
  const style = {
    "--qr-primary": primary,
    "--qr-on-primary": readableForeground(primary),
  } as CSSProperties

  async function submitRequest(customerNote: string) {
    if (!tableToken || !menu?.session_token || lines.length === 0) {
      return
    }

    idempotencyKeyRef.current ??= crypto.randomUUID()
    try {
      const result = await createRequest.mutateAsync({
        table_token: tableToken,
        session_token: menu.session_token,
        idempotency_key: idempotencyKeyRef.current,
        items: lines.map((line) => ({
          product_id: line.productId,
          quantity: line.quantity,
          ...(line.note ? { note: line.note } : {}),
          ...(line.modifiers.length > 0
            ? {
                modifiers: line.modifiers.map((modifier) => ({
                  modifier_id: modifier.modifierId,
                  quantity: 1,
                })),
              }
            : {}),
        })),
        customer_note: customerNote.trim() || null,
      })
      clearCart()
      setCartContext(menu.context_key, tableToken)
      idempotencyKeyRef.current = null
      setCartOpen(false)
      setSubmittedRequest(result)
      toast.success("Sipariş talebiniz gönderildi")
    } catch (error) {
      if (
        error instanceof ApiError &&
        ["qr_session_expired", "invalid_qr_session"].includes(error.code)
      ) {
        await menuQuery.refetch()
      }
      toast.error("Sipariş gönderilemedi", {
        description:
          error instanceof Error
            ? error.message
            : "Lütfen bağlantınızı kontrol edip tekrar deneyin.",
      })
    }
  }

  return (
    <div
      style={style}
      className="min-h-dvh bg-[#f3ede3] text-[#2b2522] [color-scheme:light]"
    >
      <QrBrandIntro
        businessSlug={businessSlug}
        branchSlug={branchSlug}
        logoUrl={menu.config.logo_url}
        primaryColor={primary}
      />
      <PublicMenuHeader menu={menu} />

      <main className="mx-auto max-w-4xl px-4 pb-32 pt-6 sm:px-8 sm:pt-8">
        <PublicLoyalty businessSlug={businessSlug} branchSlug={branchSlug} />
        {!orderingEnabled ? (
          <div className="mb-6 flex gap-3 border-y border-[#c8612f]/25 bg-[#fff7ed] px-4 py-3.5 text-sm text-[#713a22]">
            <UtensilsCrossed className="mt-0.5 size-5 shrink-0 text-[var(--qr-primary)]" />
            <div>
              <p className="font-semibold">Menü görüntüleme modu</p>
              <p className="mt-0.5 leading-5 opacity-80">
                {tableToken
                  ? "İşletme şu anda QR üzerinden sipariş almıyor."
                  : "Sipariş vermek için masanızdaki QR kodunu okutun."}
              </p>
            </div>
          </div>
        ) : null}

        <div className="sticky top-0 z-20 -mx-4 border-b border-[#2b2522]/10 bg-[#f3ede3]/95 px-4 pb-3 pt-2 backdrop-blur sm:-mx-8 sm:px-8">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#776d67]" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Menüde ara"
              aria-label="Menüde ara"
              className="h-12 rounded-xl border-[#2b2522]/15 bg-[#fffaf2] pl-10 text-[#2b2522] shadow-none placeholder:text-[#8f847e]"
            />
          </div>
          <nav
            aria-label="Menü kategorileri"
            className="scrollbar-subtle mt-3 flex gap-2 overflow-x-auto pb-1"
          >
            <button
              type="button"
              onClick={() => setCategoryId(null)}
              className={cn(
                "focus-operational min-h-9 shrink-0 rounded-lg border px-3.5 text-xs font-bold transition-colors",
                categoryId === null
                  ? "border-transparent bg-[var(--qr-primary)] text-[var(--qr-on-primary)]"
                  : "border-[#2b2522]/15 bg-[#fffaf2] text-[#665d58] hover:border-[#2b2522]/30",
              )}
            >
              Tümü
            </button>
            {menu.categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setCategoryId(category.id)}
                className={cn(
                  "focus-operational min-h-9 shrink-0 rounded-lg border px-3.5 text-xs font-bold transition-colors",
                  categoryId === category.id
                    ? "border-transparent bg-[var(--qr-primary)] text-[var(--qr-on-primary)]"
                    : "border-[#2b2522]/15 bg-[#fffaf2] text-[#665d58] hover:border-[#2b2522]/30",
                )}
              >
                {category.name}
              </button>
            ))}
          </nav>
          <p
            className="mt-2 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[#847a74]"
            aria-live="polite"
          >
            {visibleProducts.length} ürün gösteriliyor
          </p>
        </div>

        <PublicMenuCatalog
          categories={menu.categories}
          products={visibleProducts}
          currency={menu.config.currency}
          allergensVisible={menu.config.allergens_visible}
          onSelectProduct={setSelectedProduct}
        />
      </main>

      {cartCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 p-3 backdrop-blur sm:px-6">
          <Button
            type="button"
            onClick={() => setCartOpen(true)}
            className="mx-auto flex h-12 w-full max-w-lg rounded-xl bg-[var(--qr-primary)] px-4 text-[var(--qr-on-primary)] hover:opacity-90"
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-black/15 text-xs font-bold">
              {cartCount}
            </span>
            <ShoppingBag />
            Sepeti görüntüle
            <ChevronRight className="ml-auto" />
          </Button>
        </div>
      ) : null}

      {selectedProduct ? (
        <ProductDrawer
          key={selectedProduct.id}
          product={selectedProduct}
          currency={menu.config.currency}
          orderingEnabled={orderingEnabled}
          open
          onOpenChange={(open) => {
            if (!open) setSelectedProduct(null)
          }}
          onAdd={(line) => {
            addLine(line)
            toast.success("Ürün sepete eklendi")
          }}
        />
      ) : null}

      <CartDrawer
        open={cartOpen}
        onOpenChange={setCartOpen}
        currency={menu.config.currency}
        tableName={menu.table_name}
        orderingEnabled={orderingEnabled}
        customerNotesEnabled={menu.config.customer_notes_enabled !== false}
        submitting={createRequest.isPending}
        onSubmit={(note) => void submitRequest(note)}
      />
    </div>
  )
}

function PublicMenuSkeleton() {
  return (
    <div className="min-h-dvh bg-[#f3ede3]" aria-busy="true" aria-label="Menü yükleniyor">
      <Skeleton className="h-64 w-full rounded-none bg-[#393431]" />
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-8">
        <Skeleton className="h-12 w-full rounded-xl bg-[#e4dacd]" />
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-9 w-24 rounded-lg bg-[#e4dacd]" />
          ))}
        </div>
        <Skeleton className="mt-8 h-8 w-48 rounded-md bg-[#e4dacd]" />
        <div className="divide-y divide-[#d9cdbf] border-y border-[#d9cdbf]">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-32 rounded-none bg-[#eee5d9]" />
          ))}
        </div>
      </div>
    </div>
  )
}
