"use client"

import {
  CheckCircle2,
  Minus,
  Plus,
  Send,
  ShoppingBag,
  Trash2,
} from "lucide-react"
import { useState } from "react"

import { translate, type QrLocale } from "@/components/qr/qr-i18n"
import {
  cartLineTotalMinor,
  cartTotalMinor,
  formatMinorMoney,
} from "@/components/qr/qr-utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
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
import { useCartStore } from "@/stores/cart-store"

interface CartDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currency: string
  tableName: string | null
  orderingEnabled: boolean
  customerNotesEnabled: boolean
  submitting: boolean
  onSubmit: (customerNote: string) => void
  locale: QrLocale
}

export function CartDrawer({
  open,
  onOpenChange,
  currency,
  tableName,
  orderingEnabled,
  customerNotesEnabled,
  submitting,
  onSubmit,
  locale,
}: CartDrawerProps) {
  const lines = useCartStore((state) => state.lines)
  const setQuantity = useCartStore((state) => state.setQuantity)
  const removeLine = useCartStore((state) => state.removeLine)
  const [customerNote, setCustomerNote] = useState("")
  const total = cartTotalMinor(lines)

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      showSwipeHandle
    >
      <DrawerContent className="mx-auto max-w-2xl">
        <DrawerHeader className="border-b px-5 pb-4 text-left">
          <DrawerTitle className="flex items-center gap-2 text-xl font-semibold">
            <ShoppingBag className="size-5" />
            {translate(locale, "cart_title")}
          </DrawerTitle>
          <DrawerDescription>
            {tableName
              ? translate(locale, "cart_desc_table", { table: tableName })
              : translate(locale, "cart_desc_no_table")}
          </DrawerDescription>
        </DrawerHeader>

        <div className="scrollbar-subtle flex-1 space-y-3 overflow-y-auto px-5 py-5">
          {lines.length === 0 ? (
            <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed bg-muted/30 p-6 text-center">
              <div>
                <ShoppingBag className="mx-auto size-8 text-muted-foreground/60" />
                <p className="mt-3 font-semibold">{translate(locale, "cart_empty")}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {translate(locale, "cart_empty_desc")}
                </p>
              </div>
            </div>
          ) : (
            lines.map((line) => (
              <article
                key={line.lineId}
                className="rounded-2xl border bg-card p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{line.productName}</h3>
                    {line.modifiers.length > 0 ? (
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {line.modifiers.map((item) => item.name).join(", ")}
                      </p>
                    ) : null}
                    {line.note ? (
                      <p className="mt-1 line-clamp-2 text-xs italic text-muted-foreground">
                        “{line.note}”
                      </p>
                    ) : null}
                  </div>
                  <p className="shrink-0 font-semibold">
                    {formatMinorMoney(cartLineTotalMinor(line), currency)}
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex h-9 items-center rounded-lg border">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() =>
                        setQuantity(line.lineId, line.quantity - 1)
                      }
                      aria-label={`${line.productName} adedini azalt`}
                    >
                      <Minus />
                    </Button>
                    <output className="w-8 text-center font-semibold">
                      {line.quantity}
                    </output>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() =>
                        setQuantity(line.lineId, line.quantity + 1)
                      }
                      aria-label={`${line.productName} adedini artır`}
                    >
                      <Plus />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => removeLine(line.lineId)}
                    aria-label={`${line.productName} ürününü sepetten çıkar`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </article>
            ))
          )}

          {customerNotesEnabled && lines.length > 0 ? (
            <div className="space-y-2 pt-2">
              <Label htmlFor="qr-customer-note">{translate(locale, "order_note_label")}</Label>
              <Textarea
                id="qr-customer-note"
                value={customerNote}
                onChange={(event) => setCustomerNote(event.target.value)}
                maxLength={1000}
                placeholder={translate(locale, "order_note_placeholder")}
                className="min-h-20 rounded-xl"
              />
            </div>
          ) : null}
        </div>

        <DrawerFooter className="border-t bg-card px-5 py-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{translate(locale, "estimated_total")}</span>
            <strong className="text-xl">
              {formatMinorMoney(total, currency)}
            </strong>
          </div>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  type="button"
                  className="h-12 w-full rounded-xl bg-[var(--qr-primary)] text-[var(--qr-on-primary)] hover:opacity-90"
                  disabled={
                    !orderingEnabled || lines.length === 0 || submitting
                  }
                />
              }
            >
              <Send />
              {submitting ? translate(locale, "sending") : translate(locale, "send_order_request")}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogMedia className="bg-emerald-500/10 text-emerald-700">
                  <CheckCircle2 />
                </AlertDialogMedia>
                <AlertDialogTitle>{translate(locale, "confirm_order_title")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {translate(locale, "confirm_order_desc", {
                    count: lines.length,
                    table: tableName || translate(locale, "selected_table_fallback"),
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{translate(locale, "back_to_cart")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onSubmit(customerNote)}
                  disabled={submitting}
                >
                  <Send />
                  {translate(locale, "confirm_and_send")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {!orderingEnabled ? (
            <p className="text-center text-xs leading-5 text-muted-foreground">
              {translate(locale, "order_disabled_note")}
            </p>
          ) : null}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
