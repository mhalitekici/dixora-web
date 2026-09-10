"use client";

import { Check, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import {
  invalidModifierGroup,
  selectedModifierOptions,
  toggleModifierSelection,
  type ModifierGroupLike,
} from "@/components/qr/modifier-selection";
import { decimalToMinor, formatMinorMoney } from "@/components/qr/qr-utils";
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

export type CashierProductDetail = {
  id: string;
  name: string;
  selling_price: string | number;
  modifier_groups: ModifierGroupLike[];
};

export function CashierModifierDialog({
  product,
  pending,
  onClose,
  onConfirm,
}: {
  product: CashierProductDetail | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (modifierIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(
    () => selectedModifierOptions(product?.modifier_groups ?? [], selected),
    [product, selected],
  );
  const total = options.reduce(
    (sum, option) => sum + decimalToMinor(option.price_delta),
    decimalToMinor(String(product?.selling_price ?? 0)),
  );

  function confirm() {
    if (!product) return;
    const invalid = invalidModifierGroup(product.modifier_groups, selected);
    if (invalid) {
      const minimum = Math.max(
        invalid.minimum_selection,
        invalid.is_required ? 1 : 0,
      );
      setError(`${invalid.name} grubundan en az ${minimum} seçim yapın.`);
      return;
    }
    onConfirm(options.map((option) => option.id));
  }

  return (
    <Dialog
      open={Boolean(product)}
      onOpenChange={(open) => {
        if (!open && !pending) {
          setSelected({});
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{product?.name ?? "Ürün seçenekleri"}</DialogTitle>
          <DialogDescription>
            Hazırlama seçeneklerini belirleyin. Toplam backend tarafından
            yeniden doğrulanır.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {(product?.modifier_groups ?? []).map((group) => (
            <fieldset key={group.id} className="space-y-2">
              <legend className="flex w-full items-center justify-between gap-3 text-sm font-semibold">
                <span>{group.name}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {group.is_required ? "Zorunlu" : "İsteğe bağlı"} · min{" "}
                  {Math.max(group.minimum_selection, group.is_required ? 1 : 0)}
                  {group.maximum_selection === null
                    ? ""
                    : ` / maks ${group.maximum_selection}`}
                </span>
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.modifiers
                  .filter((option) => option.is_active !== false)
                  .map((option) => {
                    const checked = (selected[group.id] ?? []).includes(
                      option.id,
                    );
                    return (
                      <label
                        key={option.id}
                        className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 py-2.5 has-[[data-state=checked]]:border-brand/40 has-[[data-state=checked]]:bg-brand-soft"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => {
                            setError(null);
                            setSelected((current) =>
                              toggleModifierSelection(
                                current,
                                group,
                                option.id,
                              ),
                            );
                          }}
                          aria-label={option.name}
                        />
                        <span className="min-w-0 flex-1 text-sm font-medium">
                          {option.name}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {decimalToMinor(option.price_delta) > 0 ? "+" : ""}
                          {formatMinorMoney(
                            decimalToMinor(option.price_delta),
                            "TRY",
                          )}
                        </span>
                      </label>
                    );
                  })}
              </div>
            </fieldset>
          ))}
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={pending} onClick={confirm}>
            {pending ? <Plus className="animate-pulse" /> : <Check />}
            Siparişe ekle · {formatMinorMoney(total, "TRY")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
