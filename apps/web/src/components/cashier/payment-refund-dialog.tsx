"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api/client"
import { formatMoney } from "@/lib/formatters"

export type RefundPayment = {
  id: string
  method: string
  amount: string | number
  status: string
  reference?: string | null
  refund_reason?: string | null
}
export type RefundTarget = { orderId: string; payment: RefundPayment; currency?: string }

export function PaymentRefundDialog({
  target,
  allowed,
  onClose,
  onRefunded,
}: {
  target: RefundTarget | null
  allowed: boolean
  onClose: () => void
  onRefunded?: (payment: RefundPayment) => void
}) {
  const [reason, setReason] = useState("")
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => {
      if (!target || !allowed)
        throw new Error("İade için yetki ve açık vardiya gereklidir.")
      return api.post<RefundPayment>(
        `/orders/${target.orderId}/payments/${target.payment.id}/refund`,
        { reason: reason.trim() },
      )
    },
    onSuccess: (payment) => {
      onRefunded?.(payment)
      toast.success("İade kaydedildi")
      onClose()
      for (const key of [
        "cashier",
        "orders",
        "shifts",
        "reports",
        "dashboard",
        "admin-operations",
      ]) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
  })
  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ödeme iadesi</DialogTitle>
          <DialogDescription>
            Bu ödemenin tamamı iade olarak kaydedilecek. Nakit ödemeyi müşteriye
            verin; kart iadesini POS cihazından tamamlayın. Sipariş ürünleri
            iptal edilmez.
          </DialogDescription>
        </DialogHeader>
        <p className="text-lg font-semibold tabular-nums">
          {formatMoney(target?.payment.amount ?? 0, target?.currency)}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {(
              {
                CASH: "Nakit",
                CARD: "Kart",
                ROOM_CHARGE: "Oda hesabı",
              } as Record<string, string>
            )[target?.payment.method ?? ""] ?? target?.payment.method}
          </span>
        </p>
        <div className="space-y-2">
          <Label htmlFor="payment-refund-reason">İade gerekçesi</Label>
          <Textarea
            id="payment-refund-reason"
            value={reason}
            maxLength={255}
            disabled={mutation.isPending}
            onChange={(event) => setReason(event.target.value)}
            placeholder="En az 3 karakterle açıklayın"
          />
        </div>
        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {mutation.error.message}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            Vazgeç
          </Button>
          <Button
            disabled={
              !target ||
              !allowed ||
              reason.trim().length < 3 ||
              mutation.isPending
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
            İadeyi kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
