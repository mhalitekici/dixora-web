"use client"

import { Check, Minus, Plus, ShoppingBag } from "lucide-react"
import Image from "next/image"
import { useMemo, useState } from "react"

import { translate, type QrLocale } from "@/components/qr/qr-i18n"
import type { QrProductDto } from "@/components/qr/types"
import {
  decimalToMinor,
  formatMinorMoney,
} from "@/components/qr/qr-utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { NewCartLine } from "@/stores/cart-store"

interface ProductDrawerProps {
  product: QrProductDto
  currency: string
  orderingEnabled: boolean
  open: boolean
  locale: QrLocale
  onOpenChange: (open: boolean) => void
  onAdd: (line: NewCartLine) => void
}

export function ProductDrawer({
  product,
  currency,
  orderingEnabled,
  open,
  locale,
  onOpenChange,
  onAdd,
}: ProductDrawerProps) {
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState("")
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const modifierGroups = useMemo(
    () => product.modifier_groups ?? [],
    [product.modifier_groups],
  )

  const selectedModifiers = useMemo(
    () =>
      modifierGroups.flatMap((group) =>
        group.modifiers.filter((modifier) =>
          (selected[group.id] ?? []).includes(modifier.id),
        ),
      ),
    [modifierGroups, selected],
  )
  const unitTotal = selectedModifiers.reduce(
    (total, modifier) => total + decimalToMinor(modifier.price_delta),
    decimalToMinor(product.selling_price),
  )

  function toggleModifier(
    groupId: string,
    modifierId: string,
    maximum: number | null,
  ) {
    setSelectionError(null)
    setSelected((current) => {
      const values = current[groupId] ?? []
      if (values.includes(modifierId)) {
        return {
          ...current,
          [groupId]: values.filter((value) => value !== modifierId),
        }
      }
      if (maximum && values.length >= maximum) {
        return maximum === 1
          ? { ...current, [groupId]: [modifierId] }
          : current
      }
      return { ...current, [groupId]: [...values, modifierId] }
    })
  }

  function addToCart() {
    for (const group of modifierGroups) {
      const count = (selected[group.id] ?? []).length
      if (count < group.minimum_selection) {
        setSelectionError(
          translate(locale, "min_selection_error", {
            group: group.name,
            n: group.minimum_selection,
          }),
        )
        return
      }
    }

    onAdd({
      productId: product.id,
      productName: product.name,
      unitPrice: product.selling_price,
      quantity,
      note,
      modifiers: selectedModifiers.map((modifier) => ({
        modifierId: modifier.id,
        name: modifier.name,
        priceDelta: modifier.price_delta,
      })),
    })
    onOpenChange(false)
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      showSwipeHandle
    >
      <DrawerContent className="mx-auto max-w-2xl">
        {product.image_url ? (
          <div className="relative mx-5 mt-4 aspect-[16/7] overflow-hidden rounded-xl bg-muted">
            <Image
              src={product.image_url}
              alt={`${product.name} ürün görseli`}
              fill
              sizes="(max-width: 672px) calc(100vw - 40px), 632px"
              className="object-cover"
            />
          </div>
        ) : null}
        <DrawerHeader className="border-b px-5 pb-4 text-left">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div>
              <DrawerTitle className="text-xl font-semibold">
                {product.name}
              </DrawerTitle>
              <DrawerDescription className="mt-1 leading-6">
                {product.description || translate(locale, "default_product_desc")}
              </DrawerDescription>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-base font-bold">
                {formatMinorMoney(
                  decimalToMinor(product.selling_price),
                  currency,
                )}
              </p>
              {product.calories != null ? (
                <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                  {product.calories} kcal
                </p>
              ) : null}
            </div>
          </div>
        </DrawerHeader>

        <div className="scrollbar-subtle flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {modifierGroups.map((group) => (
            <fieldset key={group.id} className="space-y-3">
              <legend className="flex w-full items-center justify-between gap-3 text-sm font-semibold">
                <span>{group.name}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {translate(locale, group.is_required ? "required" : "optional")}
                  {group.maximum_selection
                    ? ` · ${translate(locale, "max_selection", { n: group.maximum_selection })}`
                    : ""}
                </span>
              </legend>
              <div className="grid gap-2">
                {group.modifiers
                  .filter((modifier) => modifier.is_active !== false)
                  .map((modifier) => {
                    const checked = (selected[group.id] ?? []).includes(
                      modifier.id,
                    )
                    return (
                      <label
                        key={modifier.id}
                        className="flex min-h-12 items-center gap-3 rounded-xl border bg-card px-3 py-2.5"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() =>
                            toggleModifier(
                              group.id,
                              modifier.id,
                              group.maximum_selection,
                            )
                          }
                          aria-label={modifier.name}
                        />
                        <span className="flex-1 text-sm font-medium">
                          {modifier.name}
                        </span>
                        {decimalToMinor(modifier.price_delta) !== BigInt(0) ? (
                          <span className="text-xs text-muted-foreground">
                            +{formatMinorMoney(
                              decimalToMinor(modifier.price_delta),
                              currency,
                            )}
                          </span>
                        ) : null}
                      </label>
                    )
                  })}
              </div>
            </fieldset>
          ))}

          <div className="space-y-2">
            <Label htmlFor={`product-note-${product.id}`}>{translate(locale, "product_note_label")}</Label>
            <Textarea
              id={`product-note-${product.id}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder={translate(locale, "product_note_placeholder")}
              className="min-h-20 rounded-xl"
            />
          </div>

          {selectionError ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {selectionError}
            </p>
          ) : null}
        </div>

        <DrawerFooter className="border-t bg-card px-5 py-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-12 items-center rounded-xl border bg-background"
              aria-label={translate(locale, "item_count_label")}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                aria-label={translate(locale, "decrease")}
              >
                <Minus />
              </Button>
              <output className="w-9 text-center text-base font-semibold">
                {quantity}
              </output>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                onClick={() => setQuantity((value) => Math.min(99, value + 1))}
                aria-label={translate(locale, "increase")}
              >
                <Plus />
              </Button>
            </div>
            <Button
              type="button"
              className="h-12 flex-1 rounded-xl bg-[var(--qr-primary)] px-4 text-[var(--qr-on-primary)] hover:opacity-90"
              disabled={!orderingEnabled}
              onClick={addToCart}
            >
              {orderingEnabled ? <ShoppingBag /> : <Check />}
              {orderingEnabled
                ? translate(locale, "add_to_cart", {
                    amount: formatMinorMoney(unitTotal * BigInt(quantity), currency),
                  })
                : translate(locale, "view_mode_title")}
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
