"use client";

import { AlertCircle, Database, LoaderCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toErrorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

import type { ApprovalStatus, ApprovalType, OrderStatus, QrRequestStatus, TableState } from "./types";

export const orderStatusText: Record<OrderStatus, string> = {
  DRAFT: "Taslak",
  SUBMITTED: "Gönderildi",
  AWAITING_APPROVAL: "Onay bekliyor",
  ACCEPTED: "Kabul edildi",
  PREPARING: "Hazırlanıyor",
  PARTIALLY_READY: "Kısmen hazır",
  READY: "Hazır",
  SERVED: "Servis edildi",
  BILL_REQUESTED: "Hesap istendi",
  PAYMENT_PENDING: "Ödeme bekliyor",
  PAID: "Ödendi",
  CANCELLED: "İptal",
  VOIDED: "Geçersiz",
};

export const tableStateText: Record<TableState, string> = {
  AVAILABLE: "Müsait",
  OCCUPIED: "Dolu",
  ORDER_PENDING: "Sipariş bekliyor",
  PREPARING: "Hazırlanıyor",
  READY: "Hazır",
  BILL_REQUESTED: "Hesap istendi",
  PAYMENT_PENDING: "Ödeme bekliyor",
  CLEANING: "Temizleniyor",
  DISABLED: "Kapalı",
};

export const qrStatusText: Record<QrRequestStatus, string> = {
  PENDING: "Onay bekliyor",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  EXPIRED: "Süresi doldu",
};

export const approvalTypeText: Record<ApprovalType, string> = {
  DISCOUNT: "İndirim talebi",
  ITEM_CANCELLATION: "Ürün iptal talebi",
  ORDER_VOID: "Sipariş iptal talebi",
  STOCK_OVERRIDE: "Stok müdahalesi",
  TABLE_TRANSFER: "Masa transferi",
};

export const approvalStatusText: Record<ApprovalStatus, string> = {
  PENDING: "Onay bekliyor",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  CANCELLED: "İptal edildi",
};

export function toneForApproval(status: ApprovalStatus) {
  if (status === "APPROVED") return "success" as const;
  if (status === "REJECTED" || status === "CANCELLED") return "danger" as const;
  return "warning" as const;
}

export function money(value: string | number, currency = "TRY") {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(amount)
    : "—";
}

export function number(value: string | number, maximumFractionDigits = 0) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("tr-TR", { maximumFractionDigits }).format(amount)
    : "—";
}

export function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

export function relativeMinutes(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "şimdi";
  if (minutes < 60) return `${minutes} dk`;
  return `${Math.floor(minutes / 60)} sa ${minutes % 60} dk`;
}

export function shortId(value: string | null | undefined) {
  return value ? value.slice(0, 8).toUpperCase() : "—";
}

export function toneForOrder(status: OrderStatus) {
  if (status === "PAID" || status === "SERVED" || status === "READY") return "success" as const;
  if (status === "CANCELLED" || status === "VOIDED") return "danger" as const;
  if (status === "BILL_REQUESTED" || status === "PAYMENT_PENDING") return "warning" as const;
  if (status === "PREPARING" || status === "PARTIALLY_READY") return "brand" as const;
  return "info" as const;
}

export function toneForTable(state: TableState) {
  if (state === "AVAILABLE") return "success" as const;
  if (state === "READY") return "info" as const;
  if (state === "DISABLED") return "neutral" as const;
  if (state === "BILL_REQUESTED" || state === "PAYMENT_PENDING") return "warning" as const;
  return "brand" as const;
}

export function LoadingState({ label = "Veriler yükleniyor…" }: { label?: string }) {
  return (
    <div className="flex min-h-52 items-center justify-center rounded-2xl border bg-card">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        {label}
      </div>
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = "Veriler alınamadı",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <Card className="border-destructive/20 bg-destructive/5">
      <CardContent className="flex min-h-44 flex-col items-center justify-center text-center">
        <AlertCircle className="mb-3 size-6 text-destructive" />
        <p className="font-semibold">{title}</p>
        <p className="mt-1 max-w-lg text-sm text-muted-foreground">{toErrorMessage(error)}</p>
        {onRetry ? (
          <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
            <RefreshCw />
            Yeniden dene
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AdapterNotice({
  children,
  className,
  title = "API adapter notu",
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-sm",
        className,
      )}
    >
      <Database className="mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-300" />
      <div>
        <p className="font-semibold text-blue-800 dark:text-blue-200">{title}</p>
        <p className="mt-0.5 leading-5 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1 text-xs text-destructive">{children}</p>;
}
