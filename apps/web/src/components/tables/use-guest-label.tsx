"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
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
import { api } from "@/lib/api";

export type LabelledTable = {
  id: string;
  name: string;
  guest_label?: string | null;
};

/** "B1 · Ahmet" when a party is named, otherwise just "B1". */
export function tableDisplayName(table: LabelledTable): string {
  return table.guest_label ? `${table.name} · ${table.guest_label}` : table.name;
}

/**
 * Right-click (or long-press on touch) a table to name the party sitting at it.
 *
 * Returns the props to spread onto each table element plus the dialog to render
 * once, so the cashier and waiter screens share one implementation rather than
 * growing two subtly different ones.
 */
export function useGuestLabel(invalidateKeys: readonly unknown[][]) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<LabelledTable | null>(null);
  const [value, setValue] = useState("");

  const mutation = useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) =>
      api.patch(`tables/${id}/guest-label`, { guest_label: label }),
    onSuccess: async () => {
      setTarget(null);
      await Promise.all(
        invalidateKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  });

  const open = useCallback((table: LabelledTable) => {
    setTarget(table);
    setValue(table.guest_label ?? "");
  }, []);

  const labelProps = useCallback(
    (table: LabelledTable) => ({
      onContextMenu: (event: React.MouseEvent) => {
        event.preventDefault();
        open(table);
      },
      // Touch tills have no right-click; a long press is the equivalent gesture.
      onPointerDown: (event: React.PointerEvent) => {
        if (event.pointerType !== "touch") return;
        const timer = window.setTimeout(() => open(table), 550);
        const cancel = () => window.clearTimeout(timer);
        event.currentTarget.addEventListener("pointerup", cancel, { once: true });
        event.currentTarget.addEventListener("pointerleave", cancel, { once: true });
        event.currentTarget.addEventListener("pointercancel", cancel, { once: true });
      },
    }),
    [open],
  );

  const dialog = (
    <Dialog open={target !== null} onOpenChange={(next) => !next && setTarget(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Masa {target?.name} · misafir adı</DialogTitle>
          <DialogDescription>
            Masaya kısa bir not ekleyin (örn. &quot;Ahmet&quot;). Masa listesinde
            adın yanında görünür. Boş bırakırsanız not kaldırılır.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="guest-label-input">Misafir adı</Label>
          <Input
            id="guest-label-input"
            value={value}
            maxLength={60}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && target) {
                mutation.mutate({ id: target.id, label: value.trim() });
              }
            }}
            placeholder="Örn. Ahmet"
            className="h-11 rounded-xl"
            autoFocus
          />
        </div>
        {mutation.isError ? (
          <p className="text-sm text-destructive">
            {mutation.error instanceof Error
              ? mutation.error.message
              : "Not kaydedilemedi."}
          </p>
        ) : null}
        <DialogFooter>
          {target?.guest_label ? (
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => target && mutation.mutate({ id: target.id, label: "" })}
            >
              Notu kaldır
            </Button>
          ) : null}
          <Button
            disabled={mutation.isPending}
            onClick={() => target && mutation.mutate({ id: target.id, label: value.trim() })}
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { labelProps, dialog, openGuestLabel: open };
}
