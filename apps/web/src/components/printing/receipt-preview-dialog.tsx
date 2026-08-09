"use client";

import { Loader2, Printer } from "lucide-react";

import type { ReceiptDocument } from "@/components/printing/receipt-types";
import { ThermalReceipt } from "@/components/printing/thermal-receipt";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Shared 80mm receipt preview.
 *
 * Development and venues without a bridge-connected printer use the browser
 * print path; where a Print Bridge printer exists the caller passes
 * `onQueue` so the authoritative flow stays API -> PrintJob -> Bridge and the
 * browser dialog is only a preview.
 */
export function ReceiptPreviewDialog({
  open,
  onOpenChange,
  document: doc,
  title,
  description,
  onQueue,
  queueing,
  queueLabel = "Yazıcıya gönder",
  confirmSlot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: ReceiptDocument | null;
  title?: string;
  description?: string;
  onQueue?: () => void;
  queueing?: boolean;
  queueLabel?: string;
  confirmSlot?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader data-print-hidden="true">
          <DialogTitle>{title ?? "Fiş önizleme"}</DialogTitle>
          <DialogDescription>
            {description ??
              "80 mm termal yazıcı formatı. Yazdırmadan önce kontrol edin."}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border bg-white p-2 shadow-inner" data-receipt-frame>
          {doc ? <ThermalReceipt document={doc} printTarget /> : null}
        </div>

        <DialogFooter data-print-hidden="true">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" />
            Yazdır (80mm)
          </Button>
          {onQueue ? (
            <Button onClick={onQueue} disabled={queueing}>
              {queueing ? <Loader2 className="animate-spin" /> : <Printer className="size-4" />}
              {queueLabel}
            </Button>
          ) : null}
          {confirmSlot}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
