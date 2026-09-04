"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Minus, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { deliveryKeys } from "@/components/delivery/delivery-api";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Product = {
  id: string;
  name: string;
  selling_price: string | number;
  is_available: boolean;
};

type Line = { product: Product; quantity: number };

const CHANNELS = [
  ["PHONE", "Telefon"],
  ["TAKEAWAY", "Gel-Al"],
  ["OWN_DELIVERY", "Paket Servis"],
] as const;

const PAYMENTS = [
  ["CASH_ON_DELIVERY", "Nakit"],
  ["CARD_ON_DELIVERY", "Kart"],
  ["ONLINE", "Online"],
  ["MEAL_CARD", "Yemek kartı"],
] as const;

const money = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
});

/**
 * Phone-order entry, optimised for a cashier with a handset to their ear.
 *
 * Everything lives on one screen rather than a wizard: the caller is waiting,
 * and paging back and forth to fix a quantity loses the order.
 */
export function NewDeliveryOrderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState<(typeof CHANNELS)[number][0]>("PHONE");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [district, setDistrict] = useState("");
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState<(typeof PAYMENTS)[number][0]>(
    "CASH_ON_DELIVERY",
  );
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

  const productsQuery = useQuery({
    queryKey: ["delivery", "products"],
    queryFn: () =>
      api.get<{ items: Product[] }>("catalog/products", {
        search: { limit: 250 },
      }),
    enabled: open,
  });

  const products = useMemo(() => {
    const all = (productsQuery.data?.items ?? []).filter((item) => item.is_available);
    const needle = search.toLocaleLowerCase("tr-TR");
    return needle
      ? all.filter((item) => item.name.toLocaleLowerCase("tr-TR").includes(needle))
      : all;
  }, [productsQuery.data, search]);

  const total = lines.reduce(
    (sum, line) => sum + Number(line.product.selling_price) * line.quantity,
    0,
  );

  function addProduct(product: Product) {
    setLines((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) =>
          line.product.id === product.id
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }
      return [...current, { product, quantity: 1 }];
    });
  }

  function changeQuantity(productId: string, delta: number) {
    setLines((current) =>
      current
        .map((line) =>
          line.product.id === productId
            ? { ...line, quantity: line.quantity + delta }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  function reset() {
    setChannel("PHONE");
    setCustomerName("");
    setCustomerPhone("");
    setAddressLine("");
    setDistrict("");
    setNote("");
    setPayment("CASH_ON_DELIVERY");
    setSearch("");
    setLines([]);
  }

  const createMutation = useMutation({
    mutationFn: () =>
      api.post("delivery", {
        channel,
        items: lines.map((line) => ({
          product_id: line.product.id,
          quantity: String(line.quantity),
        })),
        // Generated per submission so a double-click cannot create two orders.
        idempotency_key: `manual-${crypto.randomUUID()}`,
        customer_name: customerName.trim() || null,
        customer_phone: customerPhone.trim() || null,
        address_line: addressLine.trim() || null,
        district: district.trim() || null,
        customer_note: note.trim() || null,
        payment_method: payment,
        payment_status: "UNPAID",
        auto_accept: true,
      }),
    onSuccess: async () => {
      toast.success("Sipariş oluşturuldu ve mutfağa iletildi.");
      onOpenChange(false);
      reset();
      await queryClient.invalidateQueries({ queryKey: deliveryKeys.root });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Sipariş oluşturulamadı.",
      ),
  });

  const needsAddress = channel === "OWN_DELIVERY";
  const canSubmit =
    lines.length > 0 && (!needsAddress || addressLine.trim().length > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Yeni paket siparişi</DialogTitle>
          <DialogDescription>
            Telefonla gelen siparişi buradan girin; sipariş doğrudan mutfağa düşer.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex gap-1.5">
              {CHANNELS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setChannel(value)}
                  className={cn(
                    "h-9 flex-1 rounded-xl border-2 text-xs font-semibold transition-colors",
                    channel === value
                      ? "border-brand bg-brand-soft/40 text-brand"
                      : "hover:bg-muted/50",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="delivery-customer">Müşteri adı</Label>
                <Input
                  id="delivery-customer"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  className="h-10 rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="delivery-phone">Telefon</Label>
                <Input
                  id="delivery-phone"
                  type="tel"
                  inputMode="tel"
                  value={customerPhone}
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  className="h-10 rounded-xl"
                />
              </div>
            </div>

            {needsAddress ? (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label htmlFor="delivery-address">Adres</Label>
                  <Input
                    id="delivery-address"
                    value={addressLine}
                    onChange={(event) => setAddressLine(event.target.value)}
                    placeholder="Cadde, sokak, bina, daire"
                    className="h-10 rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="delivery-district">Semt / mahalle</Label>
                  <Input
                    id="delivery-district"
                    value={district}
                    onChange={(event) => setDistrict(event.target.value)}
                    className="h-10 rounded-xl"
                  />
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="delivery-note">Sipariş notu</Label>
              <Input
                id="delivery-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Örn. soğansız, zil çalışmıyor"
                className="h-10 rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Ödeme</Label>
              <div className="flex flex-wrap gap-1.5">
                {PAYMENTS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPayment(value)}
                    className={cn(
                      "h-9 rounded-xl border-2 px-3 text-xs font-semibold transition-colors",
                      payment === value
                        ? "border-brand bg-brand-soft/40 text-brand"
                        : "hover:bg-muted/50",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ürün ara…"
                aria-label="Ürün ara"
                className="h-10 rounded-xl pl-9"
              />
            </div>

            <ScrollArea className="h-40 rounded-xl border">
              <div className="p-1">
                {products.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addProduct(product)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="min-w-0 truncate">{product.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {money.format(Number(product.selling_price))}
                    </span>
                  </button>
                ))}
                {products.length === 0 ? (
                  <p className="p-3 text-center text-xs text-muted-foreground">
                    Ürün bulunamadı.
                  </p>
                ) : null}
              </div>
            </ScrollArea>

            <div className="rounded-xl border">
              {lines.length === 0 ? (
                <p className="p-3 text-center text-xs text-muted-foreground">
                  Sipariş boş — soldaki listeden ürün ekleyin.
                </p>
              ) : (
                <ul className="divide-y">
                  {lines.map((line) => (
                    <li
                      key={line.product.id}
                      className="flex items-center gap-2 px-2.5 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {line.product.name}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${line.product.name} adet azalt`}
                          onClick={() => changeQuantity(line.product.id, -1)}
                        >
                          <Minus className="size-3.5" />
                        </Button>
                        <span className="w-6 text-center font-semibold tabular-nums">
                          {line.quantity}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${line.product.name} adet artır`}
                          onClick={() => changeQuantity(line.product.id, 1)}
                        >
                          <Plus className="size-3.5" />
                        </Button>
                      </div>
                      <span className="w-20 shrink-0 text-right tabular-nums">
                        {money.format(
                          Number(line.product.selling_price) * line.quantity,
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-baseline justify-between border-t px-2.5 py-2">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Toplam
                </span>
                <span className="text-lg font-bold tabular-nums">
                  {money.format(total)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            disabled={!canSubmit || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? <Loader2 className="animate-spin" /> : null}
            Siparişi oluştur
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
