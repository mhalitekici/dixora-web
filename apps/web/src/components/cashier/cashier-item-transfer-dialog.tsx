"use client";

import { ArrowLeft, ArrowRight, Check, Loader2, MoveRight } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type TransferItem = {
  id: string;
  product_name_snapshot: string;
  quantity: string | number;
  status: string;
  note?: string | null;
  is_complimentary?: boolean;
};

type TransferTable = {
  id: string;
  name: string;
  state: string;
};

export type ItemTransferPayload = {
  destination_table_id: string;
  items: { item_id: string; quantity: string }[];
  idempotency_key: string;
  reason: string;
};

type Props = {
  open: boolean;
  sourceTable: TransferTable | null | undefined;
  items: TransferItem[];
  tables: TransferTable[];
  onOpenChange: (open: boolean) => void;
  onTransfer: (payload: ItemTransferPayload) => Promise<void>;
};

type Step = "items" | "table" | "confirm";

const transferStatusLabel = (state: string) =>
  state === "AVAILABLE" ? "Boş" : "Dolu";
const newTransferKey = () => `cashier-item-transfer:${crypto.randomUUID()}`;

export function validTransferQuantity(
  value: string,
  maximum: number,
): number | null {
  if (!/^\d+$/.test(value)) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= maximum
    ? quantity
    : null;
}

export function stepTransferQuantity(
  value: string,
  direction: 1 | -1,
  maximum: number,
): string {
  const current = validTransferQuantity(value, maximum) ?? 1;
  return String(Math.min(maximum, Math.max(1, current + direction)));
}

export function CashierItemTransferDialog({
  open,
  sourceTable,
  items,
  tables,
  onOpenChange,
  onTransfer,
}: Props) {
  const [step, setStep] = useState<Step>("items");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [targetTableId, setTargetTableId] = useState("");
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newTransferKey);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetDialog() {
    setStep("items");
    setQuantities({});
    setTargetTableId("");
    setReason("");
    setIdempotencyKey(newTransferKey());
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) resetDialog();
    onOpenChange(next);
  }

  const transferableItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.status !== "CANCELLED" &&
          item.status !== "VOIDED" &&
          Math.floor(Number(item.quantity)) >= 1,
      ),
    [items],
  );
  const selectedLines = useMemo(
    () =>
      transferableItems.flatMap((item) => {
        const maximum = Math.floor(Number(item.quantity));
        const quantity = validTransferQuantity(
          quantities[item.id] ?? "",
          maximum,
        );
        return quantity === null ? [] : [{ item, quantity }];
      }),
    [quantities, transferableItems],
  );
  const targetTables = useMemo(
    () =>
      tables.filter(
        (table) => table.id !== sourceTable?.id && table.state !== "DISABLED",
      ),
    [sourceTable?.id, tables],
  );
  const targetTable = targetTables.find((table) => table.id === targetTableId);

  function toggleItem(item: TransferItem, checked: boolean) {
    setQuantities((current) => {
      const next = { ...current };
      if (checked) next[item.id] = String(Math.floor(Number(item.quantity)));
      else delete next[item.id];
      return next;
    });
    setError(null);
  }

  async function submit() {
    if (
      !targetTable ||
      selectedLines.length === 0 ||
      reason.trim().length < 3
    ) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onTransfer({
        destination_table_id: targetTable.id,
        items: selectedLines.map(({ item, quantity }) => ({
          item_id: item.id,
          quantity: String(quantity),
        })),
        idempotency_key: idempotencyKey,
        reason: reason.trim(),
      });
      resetDialog();
      onOpenChange(false);
    } catch (transferError) {
      setError(
        transferError instanceof Error
          ? transferError.message
          : "Ürünler taşınamadı. Lütfen tekrar deneyin.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-5 py-4 text-left">
          <div className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span className={step === "items" ? "text-foreground" : undefined}>
              1 Ürün
            </span>
            <ArrowRight className="size-3" />
            <span className={step === "table" ? "text-foreground" : undefined}>
              2 Masa
            </span>
            <ArrowRight className="size-3" />
            <span
              className={step === "confirm" ? "text-foreground" : undefined}
            >
              3 Onay
            </span>
          </div>
          <DialogTitle className="mt-2">Ürün taşı</DialogTitle>
          <DialogDescription>
            {sourceTable?.name ?? "Kaynak masa"} hesabındaki kalemleri boş veya
            dolu başka bir masaya taşıyın.
          </DialogDescription>
        </DialogHeader>

        {step === "items" ? (
          <ScrollArea className="max-h-[56dvh] px-5 py-4">
            <div
              className="space-y-2"
              role="group"
              aria-label="Taşınacak ürünler"
            >
              {transferableItems.length ? (
                transferableItems.map((item) => {
                  const selected = quantities[item.id] !== undefined;
                  const max = Math.floor(Number(item.quantity));
                  const quantityValue = quantities[item.id] ?? "";
                  const quantityIsInvalid =
                    selected &&
                    validTransferQuantity(quantityValue, max) === null;
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "grid grid-cols-[auto_minmax(0,1fr)_5.5rem] items-center gap-3 rounded-xl border p-3 transition-colors",
                        selected && "border-primary/40 bg-primary/5",
                      )}
                    >
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(value) =>
                          toggleItem(item, value === true)
                        }
                        aria-label={`${item.product_name_snapshot} ürününü seç`}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {item.product_name_snapshot}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {max} adet{item.is_complimentary ? " · İkram" : ""}
                          {item.note ? ` · ${item.note}` : ""}
                        </p>
                      </div>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max={max}
                        step="1"
                        value={quantityValue}
                        disabled={!selected}
                        onChange={(event) => {
                          const value = event.target.value;
                          setQuantities((current) => ({
                            ...current,
                            [item.id]: value,
                          }));
                          setError(
                            validTransferQuantity(value, max) === null
                              ? `Taşıma adedi 1 ile ${max} arasında tam sayı olmalı.`
                              : null,
                          );
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key !== "ArrowUp" &&
                            event.key !== "ArrowDown"
                          ) {
                            return;
                          }
                          event.preventDefault();
                          const next = stepTransferQuantity(
                            quantityValue,
                            event.key === "ArrowUp" ? 1 : -1,
                            max,
                          );
                          setQuantities((current) => ({
                            ...current,
                            [item.id]: next,
                          }));
                          setError(null);
                        }}
                        aria-invalid={quantityIsInvalid}
                        aria-label={`${item.product_name_snapshot} taşınacak adet`}
                        className="h-10 text-center tabular-nums"
                      />
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Bu hesapta taşınabilecek ürün yok.
                </div>
              )}
            </div>
          </ScrollArea>
        ) : null}

        {step === "table" ? (
          <ScrollArea className="max-h-[56dvh] px-5 py-4">
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
              role="radiogroup"
              aria-label="Hedef masa"
            >
              {targetTables.map((table) => {
                const selected = targetTableId === table.id;
                const empty = table.state === "AVAILABLE";
                return (
                  <button
                    key={table.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setTargetTableId(table.id);
                      setError(null);
                    }}
                    className={cn(
                      "min-h-20 rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "border-primary bg-primary/8"
                        : "hover:bg-muted/60",
                    )}
                  >
                    <span className="block truncate text-sm font-semibold">
                      {table.name}
                    </span>
                    <span
                      className={cn(
                        "mt-2 inline-flex rounded-full px-2 py-0.5 text-[0.65rem] font-semibold",
                        empty
                          ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                          : "bg-amber-500/12 text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {transferStatusLabel(table.state)}
                    </span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        ) : null}

        {step === "confirm" ? (
          <div className="space-y-4 px-5 py-4">
            <div className="flex items-center gap-3 rounded-xl border bg-muted/35 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {sourceTable?.name} → {targetTable?.name}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedLines.length} kalem ·{" "}
                  {targetTable ? transferStatusLabel(targetTable.state) : ""}{" "}
                  masa
                </p>
              </div>
              <MoveRight className="size-5 text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-transfer-reason">Taşıma nedeni</Label>
              <Textarea
                id="item-transfer-reason"
                value={reason}
                maxLength={255}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Örn. misafir masa değiştirdi"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Denetim kaydı için en az 3 karakter.
              </p>
            </div>
          </div>
        ) : null}

        {error ? (
          <p
            className="mx-5 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <DialogFooter className="border-t px-5 py-4 sm:justify-between">
          {step === "items" ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Vazgeç
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setStep(step === "confirm" ? "table" : "items")}
            >
              <ArrowLeft /> Geri
            </Button>
          )}
          {step === "confirm" ? (
            <Button
              type="button"
              disabled={pending || reason.trim().length < 3}
              onClick={() => void submit()}
            >
              {pending ? <Loader2 className="animate-spin" /> : <Check />}
              {pending ? "Taşınıyor..." : "Ürünleri taşı"}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={
                step === "items" ? selectedLines.length === 0 : !targetTableId
              }
              onClick={() => setStep(step === "items" ? "table" : "confirm")}
            >
              Devam <ArrowRight />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
