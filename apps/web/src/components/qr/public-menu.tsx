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

import { CartDrawer } from "@/components/qr/cart-drawer"
import { BillRequestDrawer } from "@/components/qr/bill-request-drawer"
import { QrBrandIntro } from "@/components/qr/qr-brand-intro"
import {
  useCreatePublicBillRequest,
  useCreatePublicQrRequest,
  usePublicQrMenu,
} from "@/components/qr/qr-hooks"
import { ProductDrawer } from "@/components/qr/product-drawer"
import { PublicMenuCatalog } from "@/components/qr/public-menu-catalog"
import { PublicMenuHeader } from "@/components/qr/public-menu-header"
import { QrRequestStatus } from "@/components/qr/request-status"
import type { PublicQrRequestDto, QrProductDto } from "@/components/qr/types"
import { readableForeground } from "@/components/qr/qr-utils"
import { translate, useQrLocale } from "@/components/qr/qr-i18n"
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
  const [locale, setLocale] = useQrLocale()
  const menuQuery = usePublicQrMenu(businessSlug, branchSlug, tableToken, locale)
  const createRequest = useCreatePublicQrRequest(businessSlug, branchSlug)
  const createBillRequest = useCreatePublicBillRequest(businessSlug, branchSlug)
  const [search, setSearch] = useState("")
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] =
    useState<QrProductDto | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [billRequestOpen, setBillRequestOpen] = useState(false)
  const [submittedRequest, setSubmittedRequest] =
    useState<PublicQrRequestDto | null>(null)
  const idempotencyKeyRef = useRef<string | null>(null)
  const lines = useCartStore((state) => state.lines)
  const addLine = useCartStore((state) => state.addLine)
  const clearCart = useCartStore((state) => state.clear)
  const setCartContext = useCartStore((state) => state.setContext)
  const cartCount = useCartStore(selectCartItemCount)
  const menu = menuQuery.data
  const activeOrder = menu?.active_order ?? null
  const isTableMenu = Boolean(tableToken && menu?.session_token)
  const billAlreadyRequested =
    activeOrder?.status === "BILL_REQUESTED" ||
    activeOrder?.status === "PAYMENT_PENDING"
  const canRequestBill = Boolean(activeOrder && !billAlreadyRequested)

  useEffect(() => {
    if (menu) {
      setCartContext(menu.context_key, tableToken)
    }
  }, [menu, setCartContext, tableToken])

  const visibleProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase(locale)
    return (menu?.products ?? []).filter((product) => {
      const inCategory = !categoryId || product.category_id === categoryId
      const matchesSearch =
        !normalizedSearch ||
        `${product.name} ${product.description ?? ""}`
          .toLocaleLowerCase(locale)
          .includes(normalizedSearch)
      return inCategory && matchesSearch
    })
  }, [categoryId, menu?.products, search, locale])

  if (menuQuery.isLoading) {
    return <PublicMenuSkeleton />
  }

  if (menuQuery.isError || !menu) {
    const message =
      menuQuery.error instanceof ApiError
        ? menuQuery.error.message
        : translate(locale, "menu_generic_error")
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-5">
        <section className="w-full max-w-md rounded-3xl border bg-card p-7 text-center">
          <AlertCircle className="mx-auto size-10 text-destructive" />
          <h1 className="mt-4 text-xl font-semibold">{translate(locale, "menu_unreachable_title")}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {message}
          </p>
          <Button
            type="button"
            className="mt-5 h-11 rounded-xl"
            onClick={() => void menuQuery.refetch()}
          >
            {translate(locale, "retry")}
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
        locale={locale}
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
      toast.success(translate(locale, "order_request_sent"))
    } catch (error) {
      if (
        error instanceof ApiError &&
        ["qr_session_expired", "invalid_qr_session"].includes(error.code)
      ) {
        await menuQuery.refetch()
      }
      toast.error(translate(locale, "order_request_failed"), {
        description:
          error instanceof Error
            ? error.message
            : translate(locale, "order_request_failed_desc"),
      })
    }
  }

  async function requestBill(input: {
    payment_preference: "CASH" | "CARD" | "ROOM_CHARGE"
    room_reference: string | null
    membership_code: string | null
  }) {
    if (!tableToken || !menu?.session_token || !activeOrder) {
      return
    }

    try {
      await createBillRequest.mutateAsync({
        table_token: tableToken,
        session_token: menu.session_token,
        ...input,
      })
      await menuQuery.refetch()
      toast.success(translate(locale, "request_bill_success"))
    } catch (error) {
      if (
        error instanceof ApiError &&
        ["qr_session_expired", "invalid_qr_session"].includes(error.code)
      ) {
        await menuQuery.refetch()
      }
      toast.error(translate(locale, "request_bill_failed"), {
        description:
          error instanceof Error
            ? error.message
            : translate(locale, "request_bill_failed_desc"),
      })
    }
  }

  return (
    <div style={style} className="min-h-dvh bg-background text-foreground">
      <QrBrandIntro
        businessSlug={businessSlug}
        branchSlug={branchSlug}
        logoUrl={menu.config.logo_url}
        primaryColor={primary}
      />
      <PublicMenuHeader menu={menu} locale={locale} onLocaleChange={setLocale} />

      <main className="mx-auto max-w-4xl px-4 pb-32 pt-6 sm:px-8 sm:pt-8">
        {!orderingEnabled ? (
          <div className="mb-6 flex gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3.5 text-sm text-amber-900 dark:text-amber-200">
            <UtensilsCrossed className="mt-0.5 size-5 shrink-0 text-[var(--qr-primary)]" />
            <div>
              <p className="font-semibold">{translate(locale, "view_mode_title")}</p>
              <p className="mt-0.5 leading-5 opacity-80">
                {tableToken
                  ? translate(locale, "view_mode_no_table")
                  : translate(locale, "view_mode_scan_qr")}
              </p>
            </div>
          </div>
        ) : null}

        <div className="sticky top-0 z-20 -mx-4 border-b bg-background/95 px-4 pb-3 pt-2 backdrop-blur-xl sm:-mx-8 sm:px-8">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={translate(locale, "search_placeholder")}
              aria-label={translate(locale, "search_placeholder")}
              className="h-12 rounded-xl bg-card pl-10 shadow-none"
            />
          </div>
          <nav
            aria-label={translate(locale, "all_categories")}
            className="scrollbar-subtle mt-3 flex gap-2 overflow-x-auto pb-1"
          >
            <button
              type="button"
              onClick={() => setCategoryId(null)}
              className={cn(
                "focus-operational min-h-9 shrink-0 rounded-xl border px-3.5 text-xs font-bold transition-[color,background-color,border-color,transform] duration-200",
                categoryId === null
                  ? "scale-105 border-transparent bg-[var(--qr-primary)] text-[var(--qr-on-primary)]"
                  : "bg-card text-muted-foreground hover:border-[var(--qr-primary)]/30",
              )}
            >
              {translate(locale, "all_categories")}
            </button>
            {(menu.categories ?? []).map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setCategoryId(category.id)}
                className={cn(
                  "focus-operational min-h-9 shrink-0 rounded-xl border px-3.5 text-xs font-bold transition-[color,background-color,border-color,transform] duration-200",
                  categoryId === category.id
                    ? "scale-105 border-transparent bg-[var(--qr-primary)] text-[var(--qr-on-primary)]"
                    : "bg-card text-muted-foreground hover:border-[var(--qr-primary)]/30",
                )}
              >
                {category.name}
              </button>
            ))}
          </nav>
          <p
            className="mt-2 text-[0.68rem] font-medium uppercase tracking-[0.1em] text-muted-foreground"
            aria-live="polite"
          >
            {translate(locale, "products_showing", { n: visibleProducts.length })}
          </p>
        </div>

        <PublicMenuCatalog
          categories={menu.categories}
          products={visibleProducts}
          currency={menu.config.currency}
          allergensVisible={menu.config.allergens_visible}
          onSelectProduct={setSelectedProduct}
          locale={locale}
        />
      </main>

      {cartCount > 0 ? (
        <div className="animate-in slide-in-from-bottom-4 fade-in-0 fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 p-3 backdrop-blur duration-300 sm:px-6">
          <Button
            type="button"
            onClick={() => setCartOpen(true)}
            className="mx-auto flex h-12 w-full max-w-lg rounded-xl bg-[var(--qr-primary)] px-4 text-[var(--qr-on-primary)] hover:opacity-90"
          >
            <span
              key={cartCount}
              className="animate-in zoom-in-50 flex size-7 items-center justify-center rounded-full bg-black/15 text-xs font-bold duration-200"
            >
              {cartCount}
            </span>
            <ShoppingBag />
            {translate(locale, "view_cart")}
            <ChevronRight className="ml-auto" />
          </Button>
        </div>
      ) : null}

      {isTableMenu ? (
        <div className={cn(
          "fixed inset-x-3 z-40 mx-auto max-w-lg",
          cartCount > 0 ? "bottom-20" : "bottom-4",
        )}>
          <Button
            type="button"
            className="h-14 w-full rounded-xl bg-[var(--qr-primary)] px-5 text-base font-bold text-[var(--qr-on-primary)] shadow-lg shadow-black/15 hover:opacity-90"
            disabled={!canRequestBill}
            onClick={() => setBillRequestOpen(true)}
          >
            {billAlreadyRequested
              ? "Hesap talebi alındı"
              : activeOrder
                ? "Hesabı iste"
                : "Önce sipariş verin"}
          </Button>
        </div>
      ) : null}

      <BillRequestDrawer
        open={billRequestOpen}
        onOpenChange={setBillRequestOpen}
        businessSlug={businessSlug}
        branchSlug={branchSlug}
        total={activeOrder ? new Intl.NumberFormat(locale === "tr" ? "tr-TR" : locale === "ru" ? "ru-RU" : "en-US", {
          style: "currency",
          currency: menu.config.currency,
        }).format(Number(activeOrder.remaining)) : "-"}
        submitting={createBillRequest.isPending}
        onSubmit={requestBill}
      />

      {selectedProduct ? (
        <ProductDrawer
          key={selectedProduct.id}
          product={selectedProduct}
          currency={menu.config.currency}
          orderingEnabled={orderingEnabled}
          open
          locale={locale}
          onOpenChange={(open) => {
            if (!open) setSelectedProduct(null)
          }}
          onAdd={(line) => {
            addLine(line)
            toast.success(translate(locale, "product_added"))
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
        locale={locale}
      />
    </div>
  )
}

function PublicMenuSkeleton() {
  return (
    <div className="min-h-dvh bg-background" aria-busy="true" aria-label="Menü yükleniyor">
      <Skeleton className="h-56 w-full rounded-none sm:h-64" />
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-8">
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-9 w-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="mt-4 h-7 w-40 rounded-md" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <Skeleton key={item} className="aspect-[4/3] rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  )
}
