"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentUser } from "@/hooks/use-auth";
import { api } from "@/lib/api";

export function OwnShiftOpen({ onOpened }: { onOpened: () => void }) {
  const current = useCurrentUser();
  const cache = useQueryClient();
  const [cash, setCash] = useState("");
  const open = useMutation({
    mutationFn: () =>
      api.post("shifts/open-own", { opening_cash: cash.replace(",", ".") }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["shifts"] });
      onOpened();
    },
  });
  const amount = Number(cash.replace(",", "."));
  return (
    <div className="mx-auto max-w-md space-y-5 p-5 sm:py-12">
      <h1 className="text-xl font-semibold">Kendi kasa vardiyanızı açın</h1>
      <p className="text-sm text-muted-foreground">
        Kasiyer: <strong>{current.data?.user.displayName}</strong>. Diğer
        kasiyerlerin vardiyası devam eder; tahsilatlarınız bu ayrı vardiyaya
        kaydedilir.
      </p>
      <form
        className="space-y-4 rounded-xl border bg-card p-5"
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          if (!open.isPending) open.mutate();
        }}
      >
        <Label htmlFor="own-opening-cash">Açılış nakdi</Label>
        <Input
          id="own-opening-cash"
          name="opening_cash"
          inputMode="decimal"
          value={cash}
          onChange={(event) => setCash(event.target.value)}
          required
          disabled={open.isPending}
          placeholder="0,00"
        />
        <p className="text-xs text-muted-foreground">
          Kendi kasanızdaki tutarı girin. 0 TL geçerlidir.
        </p>
        {open.error ? (
          <p role="alert" className="text-sm text-destructive">
            {open.error.message}
          </p>
        ) : null}
        <Button
          className="min-h-11 w-full"
          type="submit"
          disabled={
            open.isPending ||
            !cash.trim() ||
            !Number.isFinite(amount) ||
            amount < 0
          }
        >
          {open.isPending ? "Vardiya açılıyor…" : "Kendi vardiyamı aç"}
        </Button>
      </form>
    </div>
  );
}
