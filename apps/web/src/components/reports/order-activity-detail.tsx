"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { ExternalLink, Loader2, Receipt } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"

import { ReceiptPreviewDialog } from "@/components/printing/receipt-preview-dialog"
import type { ReceiptDocument } from "@/components/printing/receipt-types"
import {
  CANCELLED_ITEM_STATUSES,
  CHANNEL_LABELS,
  ITEM_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/components/reports/order-activity-labels"
import { Badge } from "@/components/ui/badge"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCurrentUser } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { formatDateTime, formatMoney, formatNumber } from "@/lib/formatters"
import { hasPermission, PERMISSIONS } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type PrinterDevice = {
  id: string
  name: string
  code: string
  preparation_station_id: string | null
  is_active: boolean
}

type Station = {
  id: string
  name: string
}

type OrderActivityItem = {
  name: string
  quantity: string
  unit_price: string
  discount: string
  line_total: string
  status: string
  note: string | null
  modifiers: string[]
}

type OrderActivityPayment = {
  method: string
  amount: string
  status: string
  reference: string | null
  recorded_at: string
  recorded_by: string | null
}

export type OrderActivityDetail = {
  order_id: string
  reference: string
  created_at: string
  branch_id: string
  status: string
  source: string
  table_name: string | null
  staff_name: string | null
  member_code: string | null
  delivery_channel: string | null
  customer_name: string | null
  currency: string
  business_name: string
  branch_name: string
  branch_address: string | null
  branch_phone: string | null
  submitted_at: string | null
  accepted_at: string | null
  paid_at: string | null
  subtotal: string
  discount_total: string
  tax_total: string
  total: string
  paid_total: string
  remaining: string
  items: OrderActivityItem[]
  payments: OrderActivityPayment[]
}

/** Let the API pick the branch's bill printer, as the cashier flow does. */
const AUTO_PRINTER = "AUTO"

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Nakit",
  CARD: "Kart",
  ROOM_CHARGE: "Oda hesabı",
  MEAL_CARD: "Yemek kartı",
  ONLINE: "Online",
  OTHER: "Diğer",
}

/**
 * Everything behind one row of the order activity feed.
 *
 * The feed answers "who put this through"; this answers "what for, and what
 * was collected" — item by item, then the money — and hands the same figures
 * to a reprintable receipt so the manager never retypes them.
 */
export function OrderActivityDetailDialog({
  orderId,
  onClose,
}: {
  orderId: string | null
  onClose: () => void
}) {
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [printerId, setPrinterId] = useState(AUTO_PRINTER)
  const session = useCurrentUser()
  const canQueuePrint = hasPermission(session.data, PERMISSIONS.printing.reprint)

  const detailQuery = useQuery({
    queryKey: ["reports", "order-activity", "detail", orderId],
    queryFn: ({ signal }) =>
      api.get<OrderActivityDetail>(`reports/order-activity/${orderId}`, {
        signal,
      }),
    enabled: Boolean(orderId),
  })

  // Both lists are scoped to the active branch by the API, which is the same
  // branch the report itself covers.
  const devicesQuery = useQuery({
    queryKey: ["printing", "devices", "receipt-picker"],
    queryFn: ({ signal }) =>
      api.get<PrinterDevice[]>("printing/devices", { signal }),
    enabled: receiptOpen && canQueuePrint,
  })
  const stationsQuery = useQuery({
    queryKey: ["catalog", "stations", "receipt-picker"],
    queryFn: ({ signal }) => api.get<Station[]>("catalog/stations", { signal }),
    enabled: receiptOpen && canQueuePrint,
    // Naming the station is a nicety; a reader without catalog access still
    // gets the printer list.
    retry: false,
  })

  const printers = (devicesQuery.data ?? []).filter((device) => device.is_active)
  const stationNames = new Map(
    (stationsQuery.data ?? []).map((station) => [station.id, station.name]),
  )

  const detail = detailQuery.data ?? null

  // A receipt pulled from the report is by definition not the first copy, so
  // it prints with the reprint banner and is queued as a REPRINT job.
  const receipt: ReceiptDocument | null = detail
    ? {
        kind: "REPRINT",
        title: "MÜŞTERİ BİLGİ FİŞİ",
        business: {
          name: detail.business_name,
          branch: detail.branch_name,
          address: detail.branch_address,
          phone: detail.branch_phone,
        },
        meta: {
          reference: detail.reference,
          tableName: detail.table_name,
          guestName: detail.customer_name,
          staffName: detail.staff_name,
          issuedAt: detail.paid_at ?? detail.created_at,
        },
        lines: detail.items
          // A struck-off line was never sold; it belongs on the screen, not
          // on the guest's receipt.
          .filter((item) => !CANCELLED_ITEM_STATUSES.has(item.status))
          .map((item) => ({
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            lineTotal: item.line_total,
            modifiers: item.modifiers,
            note: item.note,
          })),
        totals: {
          subtotal: detail.subtotal,
          discount: detail.discount_total,
          tax: detail.tax_total,
          total: detail.total,
          paid: detail.paid_total,
          remaining: detail.remaining,
        },
        payments: detail.payments
          .filter((payment) => payment.status === "COMPLETED")
          .map((payment) => ({
            method: payment.method,
            amount: payment.amount,
            reference: payment.reference,
          })),
      }
    : null

  const queuePrint = useMutation({
    mutationFn: () => {
      if (!detail) throw new Error("Sipariş detayı yüklenmedi.")
      const printer =
        printerId === AUTO_PRINTER
          ? null
          : printers.find((device) => device.id === printerId)
      return api.post("printing/jobs", {
        order_id: detail.order_id,
        // Left null for AUTO so the API resolves the branch's bill printer.
        printer_device_id: printer?.id ?? null,
        preparation_station_id: printer?.preparation_station_id ?? null,
        payload: {
          type: "BILL",
          order_id: detail.order_id,
          table_name: detail.table_name,
          copy: true,
          stage: detail.status === "PAID" ? "CLOSING" : "PRE_PAYMENT",
        },
        kind: "REPRINT",
        idempotency_key: `bill-reprint:${detail.order_id}:${crypto.randomUUID()}`,
      })
    },
    onSuccess: () => {
      const printer = printers.find((device) => device.id === printerId)
      toast.success("Fiş yazıcı kuyruğuna alındı", {
        description: printer
          ? `${printerLabel(printer, stationNames)} · REPRINT olarak denetim kaydına yazıldı.`
          : "Baskı REPRINT olarak denetim kaydına yazıldı.",
      })
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Baskı işi oluşturulamadı.",
      ),
  })

  return (
    <>
      <Dialog
        open={Boolean(orderId)}
        onOpenChange={(open) => {
          if (!open) {
            setReceiptOpen(false)
            onClose()
          }
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Sipariş detayı{detail ? ` · ${detail.reference}` : ""}
            </DialogTitle>
            <DialogDescription>
              Ne sipariş edildi, ne kadar tahsil edildi ve kim tarafından.
            </DialogDescription>
          </DialogHeader>

          {detailQuery.isLoading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Yükleniyor…
            </div>
          ) : detailQuery.error ? (
            <p className="py-10 text-sm text-destructive">
              Sipariş detayı alınamadı. Lütfen tekrar deneyin.
            </p>
          ) : detail ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">
                  {SOURCE_LABELS[detail.source] ?? detail.source}
                </Badge>
                {detail.delivery_channel ? (
                  <Badge variant="outline">
                    {CHANNEL_LABELS[detail.delivery_channel] ??
                      detail.delivery_channel}
                  </Badge>
                ) : null}
                <Badge
                  variant={detail.status === "PAID" ? "default" : "outline"}
                >
                  {STATUS_LABELS[detail.status] ?? detail.status}
                </Badge>
                {detail.member_code ? (
                  <Badge variant="outline" className="font-mono">
                    {detail.member_code}
                  </Badge>
                ) : null}
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border bg-muted/30 p-3 text-sm sm:grid-cols-3">
                <Field label="Masa / Müşteri">
                  {detail.table_name ?? detail.customer_name ?? "—"}
                </Field>
                <Field label="Giren">
                  {detail.staff_name ?? "Müşteri (QR)"}
                </Field>
                <Field label="Şube">{detail.branch_name}</Field>
                <Field label="Açılış">{formatDateTime(detail.created_at)}</Field>
                <Field label="Onay">
                  {detail.accepted_at ? formatDateTime(detail.accepted_at) : "—"}
                </Field>
                <Field label="Ödeme">
                  {detail.paid_at ? formatDateTime(detail.paid_at) : "—"}
                </Field>
              </dl>

              <div className="overflow-x-auto rounded-2xl border">
                <table className="w-full min-w-[30rem] text-sm">
                  <thead className="border-b bg-muted/40 text-left">
                    <tr className="text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">
                      <th className="px-3 py-2 font-semibold">Ürün</th>
                      <th className="px-3 py-2 text-right font-semibold">Adet</th>
                      <th className="px-3 py-2 text-right font-semibold">Birim</th>
                      <th className="px-3 py-2 text-right font-semibold">Tutar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {detail.items.map((item, index) => {
                      const struck = CANCELLED_ITEM_STATUSES.has(item.status)
                      return (
                        <tr
                          key={`${item.name}-${index}`}
                          className={cn(struck && "text-muted-foreground")}
                        >
                          <td className="px-3 py-2">
                            <span className={cn(struck && "line-through")}>
                              {item.name}
                            </span>
                            {struck ? (
                              <span className="ml-1.5 text-[0.65rem] font-semibold uppercase text-destructive">
                                {ITEM_STATUS_LABELS[item.status] ?? item.status}
                              </span>
                            ) : null}
                            {item.modifiers.length ? (
                              <p className="text-xs text-muted-foreground">
                                + {item.modifiers.join(", ")}
                              </p>
                            ) : null}
                            {item.note ? (
                              <p className="text-xs text-muted-foreground">
                                Not: {item.note}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatNumber(item.quantity)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatMoney(item.unit_price, detail.currency)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">
                            {formatMoney(item.line_total, detail.currency)}
                          </td>
                        </tr>
                      )
                    })}
                    {detail.items.length === 0 ? (
                      <tr>
                        <td
                          className="px-3 py-4 text-center text-muted-foreground"
                          colSpan={4}
                        >
                          Kayıtlı ürün yok
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <dl className="space-y-1 rounded-2xl border p-3 text-sm">
                  <Amount
                    label="Ara toplam"
                    value={detail.subtotal}
                    currency={detail.currency}
                  />
                  <Amount
                    label="İndirim"
                    value={detail.discount_total}
                    currency={detail.currency}
                  />
                  <Amount
                    label="KDV"
                    value={detail.tax_total}
                    currency={detail.currency}
                  />
                  <Amount
                    label="Toplam"
                    value={detail.total}
                    currency={detail.currency}
                    strong
                  />
                </dl>

                <div className="rounded-2xl border p-3 text-sm">
                  <p className="mb-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    Tahsilat
                  </p>
                  {detail.payments.length === 0 ? (
                    <p className="text-muted-foreground">Henüz ödeme yok.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {detail.payments.map((payment, index) => (
                        <li
                          key={`${payment.method}-${index}`}
                          className="flex items-baseline justify-between gap-2"
                        >
                          <span>
                            {PAYMENT_METHOD_LABELS[payment.method] ??
                              payment.method}
                            {payment.status === "COMPLETED" ? null : (
                              <span className="ml-1 text-xs text-destructive">
                                {PAYMENT_STATUS_LABELS[payment.status] ??
                                  payment.status}
                              </span>
                            )}
                            <span className="block text-xs text-muted-foreground">
                              {formatDateTime(payment.recorded_at)}
                              {payment.recorded_by
                                ? ` · ${payment.recorded_by}`
                                : ""}
                              {payment.reference
                                ? ` · ${payment.reference}`
                                : ""}
                            </span>
                          </span>
                          <span className="font-medium tabular-nums">
                            {formatMoney(payment.amount, detail.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <dl className="mt-2 space-y-1 border-t pt-2">
                    <Amount
                      label="Ödenen"
                      value={detail.paid_total}
                      currency={detail.currency}
                    />
                    <Amount
                      label="Kalan"
                      value={detail.remaining}
                      currency={detail.currency}
                      strong
                    />
                  </dl>
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            {detail ? (
              <Button variant="outline" render={<Link href={`/admin/orders?order=${detail.order_id}`} />}>
                <ExternalLink className="size-4" />
                Siparişi aç
              </Button>
            ) : null}
            <Button
              onClick={() => setReceiptOpen(true)}
              disabled={!detail}
            >
              <Receipt className="size-4" />
              Fiş çıkar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceiptPreviewDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        document={receipt}
        title="Fiş önizleme"
        description="Siparişin kayıtlı tutarlarıyla yeniden basılan fiş."
        onQueue={canQueuePrint ? () => queuePrint.mutate() : undefined}
        queueing={queuePrint.isPending}
        queueLabel="Yazıcıya gönder"
        queueOptions={
          canQueuePrint ? (
            <div className="space-y-1.5">
              <Label htmlFor="receipt-printer">İstasyon / yazıcı</Label>
              <Select
                value={printerId}
                onValueChange={(value) => setPrinterId(value ?? AUTO_PRINTER)}
              >
                <SelectTrigger id="receipt-printer" className="h-10 w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO_PRINTER}>
                    Otomatik (şubenin kasa yazıcısı)
                  </SelectItem>
                  {printers.map((printer) => (
                    <SelectItem key={printer.id} value={printer.id}>
                      {printerLabel(printer, stationNames)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {devicesQuery.isSuccess && printers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Bu şubede tanımlı aktif yazıcı yok; fişi tarayıcıdan
                  yazdırabilirsiniz.
                </p>
              ) : null}
            </div>
          ) : undefined
        }
      />
    </>
  )
}

/** "Kasa · Termal 1" — the station first, because that is what staff say. */
function printerLabel(
  printer: PrinterDevice,
  stationNames: Map<string, string>,
): string {
  const station = printer.preparation_station_id
    ? stationNames.get(printer.preparation_station_id)
    : null
  return station ? `${station} · ${printer.name}` : printer.name
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate">{children}</dd>
    </div>
  )
}

function Amount({
  label,
  value,
  currency,
  strong,
}: {
  label: string
  value: string
  currency: string
  strong?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-2",
        strong && "font-semibold",
      )}
    >
      <dt className={cn(!strong && "text-muted-foreground")}>{label}</dt>
      <dd className="tabular-nums">{formatMoney(value, currency)}</dd>
    </div>
  )
}
