"use client"

import {
  Check,
  ClipboardList,
  Clock3,
  Eye,
  Loader2,
  RefreshCw,
  ShoppingBag,
  X,
} from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { QrAdminNav } from "@/components/qr/qr-admin-nav"
import {
  useApproveQrRequest,
  useQrAdminProducts,
  useQrRequests,
  useQrTables,
  useRejectQrRequest,
} from "@/components/qr/qr-hooks"
import type {
  QrRequestDto,
  QrRequestStatus,
} from "@/components/qr/types"
import { requestStatusLabel } from "@/components/qr/qr-utils"
import { PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDateTime, formatRelativeTime } from "@/lib/formatters"

type StatusFilter = QrRequestStatus | "ALL"

export function QrRequestList() {
  const [status, setStatus] = useState<StatusFilter>("PENDING")
  const [selected, setSelected] = useState<QrRequestDto | null>(null)
  const requestsQuery = useQrRequests(status)
  const tablesQuery = useQrTables()
  const productsQuery = useQrAdminProducts()
  const approve = useApproveQrRequest()
  const reject = useRejectQrRequest()
  const tablesById = useMemo(
    () =>
      new Map((tablesQuery.data ?? []).map((table) => [table.id, table.name])),
    [tablesQuery.data],
  )
  const productsById = useMemo(
    () =>
      new Map(
        (productsQuery.data?.items ?? []).map((product) => [
          product.id,
          product.name,
        ]),
      ),
    [productsQuery.data?.items],
  )
  const requests = requestsQuery.data ?? []

  async function approveRequest(request: QrRequestDto) {
    try {
      await approve.mutateAsync(request.id)
      toast.success("Sipariş talebi onaylandı")
      setSelected(null)
    } catch (error) {
      toast.error("Talep onaylanamadı", {
        description:
          error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
      })
    }
  }

  async function rejectRequest(request: QrRequestDto) {
    try {
      await reject.mutateAsync(request.id)
      toast.success("Sipariş talebi reddedildi")
      setSelected(null)
    } catch (error) {
      toast.error("Talep reddedilemedi", {
        description:
          error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
      })
    }
  }

  return (
    <div>
      <QrAdminNav />
      <PageHeader
        eyebrow="Operasyon kuyruğu"
        title="Müşteri Talepleri"
        description="Masa QR menüsünden gönderilen talepleri inceleyin; onaylanan talepler birleşik sipariş motoruna aktarılır."
        icon={ClipboardList}
        actions={
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-xl"
            onClick={() => void requestsQuery.refetch()}
            disabled={requestsQuery.isFetching}
          >
            <RefreshCw
              className={requestsQuery.isFetching ? "animate-spin" : ""}
            />
            Yenile
          </Button>
        }
      />

      <div className="mb-5 flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Talep filtresi</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Bekleyen ve tüm talepler 15 saniyede bir yenilenir.
          </p>
        </div>
        <Select
          value={status}
          onValueChange={(value) => setStatus((value ?? "PENDING") as StatusFilter)}
        >
          <SelectTrigger className="h-10 w-full rounded-xl sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">Onay bekleyenler</SelectItem>
            <SelectItem value="APPROVED">Onaylananlar</SelectItem>
            <SelectItem value="REJECTED">Reddedilenler</SelectItem>
            <SelectItem value="EXPIRED">Süresi dolanlar</SelectItem>
            <SelectItem value="ALL">Tüm talepler</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {requestsQuery.isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : requestsQuery.isError ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-7 text-center">
          <p className="font-semibold">Talepler alınamadı</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {requestsQuery.error.message}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => void requestsQuery.refetch()}
          >
            Tekrar dene
          </Button>
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-12 text-center">
          <ClipboardList className="mx-auto size-9 text-muted-foreground/45" />
          <h2 className="mt-3 font-semibold">Bu filtrede talep yok</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Yeni müşteri talepleri geldiğinde liste otomatik yenilenir.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {requests.map((request) => {
            const itemCount = request.items_payload.reduce(
              (total, item) => total + readQuantity(item.quantity),
              0,
            )
            const pending = request.status === "PENDING"
            return (
              <article
                key={request.id}
                className="rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.03)]"
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <ShoppingBag className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">
                        {tablesById.get(request.table_id) ??
                          `Masa ${request.table_id.slice(0, 6)}`}
                      </h2>
                      <StatusBadge
                        tone={statusTone(request.status)}
                        pulse={pending}
                      >
                        {requestStatusLabel(request.status)}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {itemCount} ürün · {formatRelativeTime(request.created_at)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setSelected(request)}
                    aria-label="Talep detayını aç"
                  >
                    <Eye />
                  </Button>
                </div>

                <div className="mt-4 space-y-2 rounded-xl bg-muted/55 p-3">
                  {request.items_payload.slice(0, 3).map((item, index) => {
                    const productId = readString(item.product_id)
                    return (
                      <div
                        key={`${request.id}-${index}`}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="truncate">
                          {productsById.get(productId) ||
                            `Ürün ${productId.slice(0, 7)}`}
                        </span>
                        <span className="shrink-0 font-semibold">
                          × {readQuantity(item.quantity)}
                        </span>
                      </div>
                    )
                  })}
                  {request.items_payload.length > 3 ? (
                    <p className="text-xs text-muted-foreground">
                      +{request.items_payload.length - 3} kalem daha
                    </p>
                  ) : null}
                </div>

                {request.customer_note ? (
                  <p className="mt-3 line-clamp-2 rounded-lg border border-amber-500/15 bg-amber-500/5 p-2.5 text-xs italic text-amber-900 dark:text-amber-200">
                    “{request.customer_note}”
                  </p>
                ) : null}

                <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock3 className="size-3.5" />
                    {formatDateTime(request.created_at)}
                  </span>
                  {pending ? (
                    <RequestActions
                      request={request}
                      approvePending={
                        approve.isPending && approve.variables === request.id
                      }
                      rejectPending={
                        reject.isPending && reject.variables === request.id
                      }
                      onApprove={() => void approveRequest(request)}
                      onReject={() => void rejectRequest(request)}
                    />
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      )}

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {tablesById.get(selected.table_id) ?? "QR sipariş talebi"}
                </DialogTitle>
                <DialogDescription>
                  {formatDateTime(selected.created_at)} ·{" "}
                  {requestStatusLabel(selected.status)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {selected.items_payload.map((item, index) => {
                  const productId = readString(item.product_id)
                  const note = readString(item.note)
                  return (
                    <div
                      key={`${selected.id}-detail-${index}`}
                      className="rounded-xl border p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold">
                          {productsById.get(productId) ||
                            `Ürün ${productId.slice(0, 8)}`}
                        </p>
                        <span className="text-sm font-bold">
                          × {readQuantity(item.quantity)}
                        </span>
                      </div>
                      {note ? (
                        <p className="mt-2 text-xs italic text-muted-foreground">
                          “{note}”
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              {selected.customer_note ? (
                <div className="rounded-xl bg-amber-500/10 p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                    Müşteri notu
                  </p>
                  <p className="mt-1 leading-6">{selected.customer_note}</p>
                </div>
              ) : null}
              {selected.status === "PENDING" ? (
                <RequestActions
                  request={selected}
                  approvePending={
                    approve.isPending && approve.variables === selected.id
                  }
                  rejectPending={
                    reject.isPending && reject.variables === selected.id
                  }
                  onApprove={() => void approveRequest(selected)}
                  onReject={() => void rejectRequest(selected)}
                  wide
                />
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RequestActions({
  request,
  approvePending,
  rejectPending,
  onApprove,
  onReject,
  wide = false,
}: {
  request: QrRequestDto
  approvePending: boolean
  rejectPending: boolean
  onApprove: () => void
  onReject: () => void
  wide?: boolean
}) {
  return (
    <div className={wide ? "grid grid-cols-2 gap-2" : "flex gap-1.5"}>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              type="button"
              variant="destructive"
              size={wide ? "default" : "sm"}
              className={wide ? "w-full" : ""}
              disabled={approvePending || rejectPending}
            />
          }
        >
          {rejectPending ? <Loader2 className="animate-spin" /> : <X />}
          Reddet
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <X />
            </AlertDialogMedia>
            <AlertDialogTitle>Talep reddedilsin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              {request.id.slice(0, 8).toUpperCase()} numaralı müşteri talebi
              siparişe dönüşmeden kapatılır.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onReject}>
              Talebi reddet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              type="button"
              size={wide ? "default" : "sm"}
              className={wide ? "w-full" : ""}
              disabled={approvePending || rejectPending}
            />
          }
        >
          {approvePending ? <Loader2 className="animate-spin" /> : <Check />}
          Onayla
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-emerald-500/10 text-emerald-700">
              <Check />
            </AlertDialogMedia>
            <AlertDialogTitle>Sipariş oluşturulsun mu?</AlertDialogTitle>
            <AlertDialogDescription>
              Talep onaylandığında ürünler birleşik sipariş motoruna aktarılır
              ve hazırlık akışı başlar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Tekrar incele</AlertDialogCancel>
            <AlertDialogAction onClick={onApprove}>
              Onayla ve siparişe aktar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function readQuantity(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function statusTone(
  status: string,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "APPROVED") return "success"
  if (status === "PENDING") return "warning"
  if (status === "REJECTED") return "danger"
  return "neutral"
}
