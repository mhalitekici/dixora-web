"use client"

import { Check, Minus, Plus, ShoppingBag } from "lucide-react"
import Image from "next/image"
import { useMemo, useState } from "react"

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
  onOpenChange: (open: boolean) => void
  onAdd: (line: NewCartLine) => void
}

export function ProductDrawer({
  product,
  currency,
  orderingEnabled,
  open,
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
          `${group.name} için en az ${group.minimum_selection} seçim yapın.`,
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
          <div className="relative mx-5 mt-4 aspect-[16/7] overflow-hidden rounded-xl bg-[#e8dfd2]">
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
                {product.description || "Ürün detaylarını seçerek sepetinize ekleyin."}
              </DrawerDescription>
            </div>
            <p className="shrink-0 text-base font-bold">
              {formatMinorMoney(
                decimalToMinor(product.selling_price),
                currency,
              )}
            </p>
          </div>
        </DrawerHeader>

        <div className="scrollbar-subtle flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {modifierGroups.map((group) => (
            <fieldset key={group.id} className="space-y-3">
              <legend className="flex w-full items-center justify-between gap-3 text-sm font-semibold">
                <span>{group.name}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {group.is_required ? "Zorunlu" : "İsteğe bağlı"}
                  {group.maximum_selection
                    ? ` · en fazla ${group.maximum_selection}`
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
            <Label htmlFor={`product-note-${product.id}`}>Ürün notu</Label>
            <Textarea
              id={`product-note-${product.id}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder="Örn. sos ayrı gelsin"
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
              aria-label="Ürün adedi"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                aria-label="Adedi azalt"
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
                aria-label="Adedi artır"
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
                ? `Sepete ekle · ${formatMinorMoney(unitTotal * BigInt(quantity), currency)}`
                : "Menü görüntüleme modu"}
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
