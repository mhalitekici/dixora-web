"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BrandLogo } from "@/components/brand/brand-logo";
import { CashierWorkspace } from "@/components/cashier/cashier-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CashierShift = {
  id: string;
  status: string;
};

const SHIFT_ERROR_MESSAGES: Record<string, string> = {
  shift_already_open: "Bu terminalde zaten açık bir vardiya var. Sayfa yenileniyor…",
  shift_not_found: "Vardiya bulunamadı.",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => null)) as
    | T
    | { detail?: string; error?: { message?: string; code?: string } }
    | null;
  if (!response.ok) {
    const error = payload as { detail?: string; error?: { message?: string; code?: string } } | null;
    const code = error?.error?.code;
    throw new Error(
      (code && SHIFT_ERROR_MESSAGES[code]) ??
        error?.error?.message ??
        error?.detail ??
        "İşlem tamamlanamadı.",
    );
  }
  return payload as T;
}

export function CashierShiftGate() {
  const shiftQuery = useQuery({
    queryKey: ["shifts", "current"],
    queryFn: () => api<CashierShift | null>("/shifts/current"),
  });

  if (shiftQuery.isLoading) {
    return (
      <div
        className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-muted/25"
        role="status"
      >
        <Loader2 className="size-7 animate-spin text-brand" />
        <span className="sr-only">Vardiya durumu kontrol ediliyor</span>
      </div>
    );
  }

  if (shiftQuery.isError) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] bg-muted/25 p-4 sm:p-6">
        <EmptyState
          title="Vardiya bilgisi alınamadı"
          description="Bağlantınızı kontrol edip yeniden deneyin."
          icon={AlertTriangle}
          action={
            <Button variant="outline" onClick={() => void shiftQuery.refetch()}>
              Yeniden dene
            </Button>
          }
        />
      </div>
    );
  }

  if (!shiftQuery.data) {
    return <OpenShiftScreen onOpened={() => void shiftQuery.refetch()} />;
  }

  return <CashierWorkspace />;
}

function OpenShiftScreen({ onOpened }: { onOpened: () => void }) {
  const queryClient = useQueryClient();
  const [cashierName, setCashierName] = useState("");
  const [openingCash, setOpeningCash] = useState("");
  const [note, setNote] = useState("");
  const nameValid = cashierName.trim().length >= 2;

  const openMutation = useMutation({
    mutationFn: () =>
      api<CashierShift>("/shifts/open", {
        method: "POST",
        body: JSON.stringify({
          cashier_name: cashierName.trim(),
          opening_cash: openingCash || "0",
          note: note.trim() || null,
        }),
      }),
    onSuccess: async () => {
      toast.success("Vardiya açıldı");
      await queryClient.invalidateQueries({ queryKey: ["shifts"] });
      onOpened();
    },
    onError: async (error) => {
      toast.error(error instanceof Error ? error.message : "Vardiya açılamadı.");
      await queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
  });

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-muted/25 p-4">
      <div className="w-full max-w-sm rounded-3xl border bg-card p-8 text-center shadow-sm">
        <BrandLogo className="mx-auto h-9" />
        <h1 className="mt-5 text-lg font-semibold">Dixora Kasa</h1>
        <p className="mt-1 text-sm text-muted-foreground">Vardiya kapalı</p>
        <form
          className="mt-6 space-y-3.5 text-left"
          onSubmit={(event) => {
            event.preventDefault();
            openMutation.mutate();
          }}
        >
          <div>
            <Label htmlFor="shift-cashier-name">Kasiyer adı</Label>
            <Input
              id="shift-cashier-name"
              value={cashierName}
              onChange={(event) => setCashierName(event.target.value)}
              placeholder="Örn. Ahmet Yılmaz"
              className="mt-1.5 h-11 rounded-xl"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="shift-opening-cash">Açılış nakdi</Label>
            <Input
              id="shift-opening-cash"
              inputMode="decimal"
              value={openingCash}
              onChange={(event) => setOpeningCash(event.target.value)}
              placeholder="0,00"
              className="mt-1.5 h-13 rounded-xl text-xl font-semibold"
            />
          </div>
          <div>
            <Label htmlFor="shift-opening-note">Not (opsiyonel)</Label>
            <Input
              id="shift-opening-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Örn. devir teslim tutanağı"
              className="mt-1.5 h-11 rounded-xl"
            />
          </div>
          <Button
            type="submit"
            className="h-12 w-full rounded-xl text-base"
            disabled={
              !nameValid ||
              !openingCash ||
              Number.isNaN(Number(openingCash)) ||
              openMutation.isPending
            }
          >
            {openMutation.isPending ? <Loader2 className="animate-spin" /> : <Wallet />}
            Vardiyayı Aç
          </Button>
        </form>
      </div>
    </div>
  );
}
