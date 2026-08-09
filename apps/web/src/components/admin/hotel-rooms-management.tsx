"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BedDouble,
  Check,
  Loader2,
  LogIn,
  LogOut,
  Plus,

  User,
} from "lucide-react";
import { useState } from "react";

import { ReceiptPreviewDialog } from "@/components/printing/receipt-preview-dialog";
import type { ReceiptDocument } from "@/components/printing/receipt-types";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { useCurrentUser } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

type HotelRoom = {
  id: string;
  room_number: string;
  status: "VACANT" | "OCCUPIED";
  guest_name: string | null;
  checked_in_at: string | null;
  notes: string | null;
  is_active: boolean;
  sort_order: number;
  version: number;
  folio_reference: string | null;
};

type RoomFolioItem = {
  id: string;
  product_name_snapshot: string;
  quantity: string | number;
  unit_price: string | number;
  line_total: string | number;
  status: string;
};

type RoomFolioOrder = {
  order_id: string;
  reference: string;
  table_name?: string | null;
  created_at: string;
  items: RoomFolioItem[];
  order_total: string | number;
  room_charge_amount: string | number;
};

type RoomFolio = {
  reference: string;
  orders: RoomFolioOrder[];
  total: string | number;
};

const PAYMENT_METHODS = [
  { value: "CASH", label: "Nakit" },
  { value: "CARD", label: "Kart" },
  { value: "OTHER", label: "Diğer" },
] as const;

export function HotelRoomsManagement() {
  const queryClient = useQueryClient();
  const session = useCurrentUser();
  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [newRoomNumber, setNewRoomNumber] = useState("");
  const [checkInRoom, setCheckInRoom] = useState<HotelRoom | null>(null);
  const [guestName, setGuestName] = useState("");
  const [checkoutRoom, setCheckoutRoom] = useState<HotelRoom | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>("CASH");

  const roomsQuery = useQuery({
    queryKey: ["admin", "hotel-rooms"],
    queryFn: () => api.get<HotelRoom[]>("hotel-rooms"),
  });
  const rooms = roomsQuery.data ?? [];

  const folioQuery = useQuery({
    queryKey: ["admin", "hotel-rooms", "folio", checkoutRoom?.id, checkoutRoom?.checked_in_at],
    queryFn: () => api.get<RoomFolio>(`hotel-rooms/${checkoutRoom?.id}/folio`),
    enabled: Boolean(checkoutRoom?.id),
  });

  const createRoomMutation = useMutation({
    mutationFn: () =>
      api.post<HotelRoom>("hotel-rooms", {
        room_number: newRoomNumber.trim(),
        sort_order: rooms.length,
      }),
    onSuccess: async () => {
      setAddRoomOpen(false);
      setNewRoomNumber("");
      await queryClient.invalidateQueries({ queryKey: ["admin", "hotel-rooms"] });
    },
  });

  const checkInMutation = useMutation({
    mutationFn: () => {
      if (!checkInRoom) throw new Error("Oda seçilmedi.");
      return api.post<HotelRoom>(`hotel-rooms/${checkInRoom.id}/check-in`, {
        guest_name: guestName.trim(),
        expected_version: checkInRoom.version,
      });
    },
    onSuccess: async () => {
      setCheckInRoom(null);
      setGuestName("");
      await queryClient.invalidateQueries({ queryKey: ["admin", "hotel-rooms"] });
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: () => {
      if (!checkoutRoom) throw new Error("Oda seçilmedi.");
      return api.post(`hotel-rooms/${checkoutRoom.id}/check-out`, {
        payment_method: paymentMethod,
        expected_version: checkoutRoom.version,
      });
    },
    onSuccess: async () => {
      setCheckoutRoom(null);
      setPaymentMethod("CASH");
      await queryClient.invalidateQueries({ queryKey: ["admin", "hotel-rooms"] });
    },
  });

  const businessName = session.data?.tenant?.name ?? "Dixora";
  const branchName = session.data?.branch?.name;
  const folio = folioQuery.data;

  // Historical integrity: every line comes from the order's stored snapshot,
  // so a receipt printed after a menu change still shows what was consumed.
  const checkoutReceipt: ReceiptDocument | null = checkoutRoom
    ? {
        kind: "ORIGINAL",
        title: "ODA HESABI",
        business: { name: businessName, branch: branchName ?? null },
        meta: {
          roomNumber: checkoutRoom.room_number,
          guestName: checkoutRoom.guest_name,
          staffName: session.data?.user?.displayName ?? null,
          checkedInAt: checkoutRoom.checked_in_at,
          issuedAt: new Date().toISOString(),
        },
        lines: (folio?.orders ?? []).flatMap((order) =>
          order.items.map((item) => ({
            name: item.product_name_snapshot,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            lineTotal: item.line_total,
          })),
        ),
        totals: { total: folio?.total ?? 0 },
        payments: [{ method: paymentMethod, amount: folio?.total ?? 0 }],
      }
    : null;

  return (
    <div className="min-h-full bg-muted/20 p-4 sm:p-6">

      <PageHeader
        eyebrow="Konaklama"
        title="Otel Odaları"
        description="Odaları tanımlayın, misafir giriş/çıkışlarını yönetin ve check-out sırasında hesabı yazdırıp tahsilatı kaydedin."
        icon={BedDouble}
        actions={
          <Button onClick={() => setAddRoomOpen(true)}>
            <Plus className="size-4" />
            Oda ekle
          </Button>
        }
      />

      {roomsQuery.isLoading ? (
        <div className="flex items-center gap-2 rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Yükleniyor…
        </div>
      ) : rooms.length === 0 ? (
        <EmptyState
          title="Henüz oda eklenmedi"
          description="Otel odalarınızı (örn. 211, 212, 213…) ekleyerek misafir giriş/çıkışlarını buradan yönetmeye başlayın."
          icon={BedDouble}
          action={
            <Button onClick={() => setAddRoomOpen(true)}>
              <Plus className="size-4" />
              İlk odayı ekle
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rooms.map((room) => {
            const occupied = room.status === "OCCUPIED";
            return (
              <Card
                key={room.id}
                className={cn(
                  "overflow-hidden transition-colors",
                  occupied ? "border-brand/25 bg-brand-soft/25" : "border-emerald-600/20",
                )}
              >
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-2xl font-bold tracking-tight">{room.room_number}</p>
                      <span
                        className={cn(
                          "mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[0.68rem] font-semibold",
                          occupied
                            ? "bg-brand/15 text-brand"
                            : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                        )}
                      >
                        {occupied ? "Dolu" : "Boş"}
                      </span>
                    </div>
                    <BedDouble
                      className={cn(
                        "size-6 shrink-0",
                        occupied ? "text-brand" : "text-emerald-600/70",
                      )}
                    />
                  </div>

                  {occupied ? (
                    <div className="space-y-1 text-sm">
                      <p className="flex items-center gap-1.5 font-medium">
                        <User className="size-3.5 text-muted-foreground" />
                        {room.guest_name}
                      </p>
                      {room.checked_in_at ? (
                        <p className="text-xs text-muted-foreground">
                          Giriş: {formatDateTime(room.checked_in_at)}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Yeni misafir bekleniyor.</p>
                  )}

                  {occupied ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-auto"
                      onClick={() => setCheckoutRoom(room)}
                    >
                      <LogOut className="size-4" />
                      Check-out
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      className="mt-auto"
                      onClick={() => setCheckInRoom(room)}
                    >
                      <LogIn className="size-4" />
                      Check-in
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={addRoomOpen} onOpenChange={setAddRoomOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Yeni oda ekle</DialogTitle>
            <DialogDescription>Oda numarasını girin (örn. 211).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-room-number">Oda numarası</Label>
            <Input
              id="new-room-number"
              value={newRoomNumber}
              onChange={(event) => setNewRoomNumber(event.target.value)}
              placeholder="Örn. 211"
              className="h-11 rounded-xl"
              autoFocus
            />
          </div>
          {createRoomMutation.isError ? (
            <p className="text-sm text-destructive">
              {createRoomMutation.error instanceof Error
                ? createRoomMutation.error.message
                : "Oda eklenemedi."}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddRoomOpen(false)}>
              Vazgeç
            </Button>
            <Button
              disabled={!newRoomNumber.trim() || createRoomMutation.isPending}
              onClick={() => createRoomMutation.mutate()}
            >
              {createRoomMutation.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              Ekle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(checkInRoom)} onOpenChange={(open) => !open && setCheckInRoom(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Oda {checkInRoom?.room_number} · Check-in</DialogTitle>
            <DialogDescription>
              Misafirin adını girin; sipariş alırken &quot;Oda&quot; ödeme yönteminde bu oda
              otomatik önerilecek.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="check-in-guest-name">Misafir adı</Label>
            <Input
              id="check-in-guest-name"
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
              placeholder="Örn. Ahmet Yılmaz"
              className="h-11 rounded-xl"
              autoFocus
            />
          </div>
          {checkInMutation.isError ? (
            <p className="text-sm text-destructive">
              {checkInMutation.error instanceof Error
                ? checkInMutation.error.message
                : "Check-in yapılamadı."}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckInRoom(null)}>
              Vazgeç
            </Button>
            <Button
              disabled={!guestName.trim() || checkInMutation.isPending}
              onClick={() => checkInMutation.mutate()}
            >
              {checkInMutation.isPending ? <Loader2 className="animate-spin" /> : <LogIn />}
              Check-in yap
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceiptPreviewDialog
        open={Boolean(checkoutRoom)}
        onOpenChange={(open) => {
          if (!open) {
            setCheckoutRoom(null);
            setPaymentMethod("CASH");
          }
        }}
        document={checkoutReceipt}
        title={`Oda ${checkoutRoom?.room_number ?? ""} · Check-out`}
        description={
          folioQuery.isLoading
            ? "Hesap yükleniyor…"
            : "Hesabı kontrol edin, fişi yazdırın ve tahsilat yöntemini seçip onaylayın."
        }
        confirmSlot={
          <div className="flex w-full flex-col gap-3 sm:w-auto">
            <div className="flex flex-wrap items-center gap-2">
              {PAYMENT_METHODS.map((method) => (
                <button
                  key={method.value}
                  type="button"
                  onClick={() => setPaymentMethod(method.value)}
                  className={cn(
                    "h-9 rounded-xl border px-3 text-sm font-semibold transition-colors",
                    paymentMethod === method.value
                      ? "border-brand/35 bg-brand-soft text-brand"
                      : "text-muted-foreground hover:bg-muted/45",
                  )}
                >
                  {method.label}
                </button>
              ))}
            </div>
            {checkOutMutation.isError ? (
              <p className="text-sm text-destructive">
                {checkOutMutation.error instanceof Error
                  ? checkOutMutation.error.message
                  : "Check-out tamamlanamadı."}
              </p>
            ) : null}
            <Button
              disabled={checkOutMutation.isPending}
              onClick={() => checkOutMutation.mutate()}
            >
              {checkOutMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Check />
              )}
              Ödendi, odayı boşalt
            </Button>
          </div>
        }
      />
    </div>
  );
}
