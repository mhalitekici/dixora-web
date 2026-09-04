"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChefHat,
  ChevronDown,
  CircleOff,
  Loader2,
  MessageSquareText,
  Minus,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  ShoppingBag,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/shared/status-badge";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

type Category = { id: string; name: string };
type Modifier = { id: string; name: string; price_delta: string | number };
type ModifierGroup = {
  id: string;
  name: string;
  is_required: boolean;
  minimum_selection: number;
  maximum_selection: number | null;
  modifiers: Modifier[];
};
type Product = {
  id: string;
  category_id: string;
  name: string;
  description?: string | null;
  selling_price: string | number;
  image_url?: string | null;
  is_available: boolean;
  waiter_visible: boolean;
  preparation_station_id?: string | null;
  modifier_groups?: ModifierGroup[];
};
type Table = { id: string; name: string; capacity: number; state: string };
type OrderItem = {
  id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_price: string | number;
  quantity: string | number;
  line_total: string | number;
  status: string;
  note?: string | null;
  modifiers?: Array<{ id: string; name_snapshot: string; price_delta_snapshot: string | number; quantity: number }>;
};
type Order = {
  id: string;
  table_id?: string;
  status: string;
  customer_name?: string | null;
  subtotal: string | number;
  discount_total: string | number;
  total: string | number;
  items: OrderItem[];
  version: number;
};
type PendingItem = {
  lineId: string;
  product: Product;
  quantity: number;
  note: string;
  modifiers: Modifier[];
};

const currency = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 2,
});

function unwrap<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: T[] }).items;
  }
  return [];
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw await ApiError.fromResponse(response);
  }
  return (await response.json().catch(() => null)) as T;
}

function itemUnitPrice(item: PendingItem) {
  return (
    Number(item.product.selling_price) +
    item.modifiers.reduce((sum, modifier) => sum + Number(modifier.price_delta), 0)
  );
}

// Cafe-friendly item status: the kitchen prep/ready/served timeline is not
// shown to the waiter — only whether the item is still active or cancelled.
const terminalItemStatuses = new Set(["CANCELLED", "VOIDED"]);

export function OrderBuilder({ tableId }: { tableId: string }) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productDetailLoading, setProductDetailLoading] = useState(false);
  const [selectedModifiers, setSelectedModifiers] = useState<Set<string>>(new Set());
  const [productQuantity, setProductQuantity] = useState(1);
  const [productNote, setProductNote] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [cancellationItem, setCancellationItem] = useState<OrderItem | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const submissionKey = useRef<string | null>(null);
  const detailRequest = useRef(0);

  const tableQuery = useQuery({
    queryKey: ["waiter", "table", tableId],
    queryFn: () => api<Table>(`/tables/${tableId}`),
  });
  const categoriesQuery = useQuery({
    queryKey: ["waiter", "categories"],
    queryFn: async () =>
      unwrap<Category>(await api<unknown>("/catalog/categories?limit=100")),
  });
  const productsQuery = useQuery({
    queryKey: ["waiter", "products"],
    queryFn: async () =>
      unwrap<Product>(
        await api<unknown>("/catalog/products?limit=200"),
      ).filter((product) => product.waiter_visible && product.is_available),
  });
  const orderQuery = useQuery({
    queryKey: ["waiter", "table", tableId, "active-order"],
    queryFn: async () => {
      try {
        return await api<Order>(`/tables/${tableId}/active-order`);
      } catch (error) {
        // A free table has no active order yet. The API deliberately exposes
        // that state as 404; for the order builder it means an empty ticket,
        // not a failed screen. The first submitted item creates the order.
        if (
          error instanceof ApiError &&
          error.status === 404 &&
          error.code === "active_order_not_found"
        ) {
          return null;
        }
        throw error;
      }
    },
    refetchInterval: 8_000,
  });

  const table = tableQuery.data;
  const order = orderQuery.data;
  const categories = [{ id: "all", name: "Tüm ürünler" }, ...(categoriesQuery.data ?? [])];
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);

  const visibleProducts = useMemo(
    () =>
      products.filter((product) => {
        const matchesCategory = category === "all" || product.category_id === category;
        const query = search.toLocaleLowerCase("tr-TR");
        const matchesSearch =
          product.name.toLocaleLowerCase("tr-TR").includes(query) ||
          product.description?.toLocaleLowerCase("tr-TR").includes(query);
        return matchesCategory && matchesSearch;
      }),
    [category, products, search],
  );
  const pendingTotal = pending.reduce(
    (sum, item) => sum + itemUnitPrice(item) * item.quantity,
    0,
  );
  const total = Number(order?.total ?? 0) + pendingTotal;

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!pending.length) return null;
      const key = submissionKey.current ?? crypto.randomUUID();
      submissionKey.current = key;
      const items = pending.map((item) => ({
        product_id: item.product.id,
        quantity: String(item.quantity),
        note: item.note || null,
        modifiers: item.modifiers.map((modifier) => ({
          modifier_id: modifier.id,
          quantity: 1,
        })),
      }));
      if (order) {
        return api<Order>(`/orders/${order.id}/items`, {
          method: "POST",
          body: JSON.stringify({ items, idempotency_key: key }),
        });
      }
      return api<Order>("/orders", {
        method: "POST",
        body: JSON.stringify({
          table_id: tableId,
          source: "WAITER",
          customer_name: customerName || null,
          items,
          idempotency_key: key,
          auto_accept: true,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Sipariş mutfağa gönderildi", {
        description: `${pending.length} yeni kalem istasyonlara yönlendirildi.`,
      });
      setPending([]);
      submissionKey.current = null;
      setCartOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["waiter", "table", tableId] });
    },
    onError: (error) =>
      toast.error("Sipariş gönderilemedi", {
        description: error instanceof Error ? error.message : "Bağlantıyı kontrol edin.",
      }),
  });

  const billMutation = useMutation({
    mutationFn: () => {
      if (!order) throw new Error("Canlı sipariş verisi bulunamadı.");
      return api<Order>(`/orders/${order.id}/bill-request`, { method: "POST" });
    },
    onSuccess: () => {
      toast.success("Hesap talebi kasaya iletildi");
      void queryClient.invalidateQueries({ queryKey: ["waiter", "table", tableId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Hesap talebi iletilemedi."),
  });

  const printBillMutation = useMutation({
    mutationFn: () => {
      if (!order) throw new Error("Canlı sipariş verisi bulunamadı.");
      return api(`/printing/jobs`, {
        method: "POST",
        body: JSON.stringify({
          order_id: order.id,
          payload: {
            type: "BILL",
            order_id: order.id,
          },
          kind: "ORIGINAL",
          idempotency_key: `bill-original:${order.id}`,
        }),
      });
    },
    onSuccess: async () => {
      toast.success("Müşteri bilgi fişi yazıcı kuyruğuna alındı");
      await queryClient.invalidateQueries({ queryKey: ["waiter", "table", tableId] });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Fiş yazdırılamadı.",
      ),
  });

  const cancellationMutation = useMutation({
    mutationFn: async () => {
      if (!order || !cancellationItem) throw new Error("Canlı sipariş kalemi bulunamadı.");
      const trimmedReason = cancellationReason.trim();
      if (trimmedReason.length < 3) {
        throw new Error("İptal nedeni en az 3 karakter olmalıdır.");
      }
      return api(`/orders/${order.id}/cancellation-requests`, {
        method: "POST",
        body: JSON.stringify({ order_item_id: cancellationItem.id, reason: trimmedReason }),
      });
    },
    onSuccess: () => {
      toast.success("İptal talebi kasaya/yöneticiye gönderildi");
      setCancellationItem(null);
      setCancellationReason("");
      void queryClient.invalidateQueries({ queryKey: ["waiter", "table", tableId] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "İptal talebi oluşturulamadı."),
  });

  async function openProduct(product: Product) {
    const requestId = ++detailRequest.current;
    setSelectedProduct(product);
    setSelectedModifiers(new Set());
    setProductQuantity(1);
    setProductNote("");
    setProductDetailLoading(true);
    try {
      const detail = await api<Product>(`/catalog/products/${product.id}`);
      if (requestId === detailRequest.current) setSelectedProduct(detail);
    } catch (error) {
      if (requestId !== detailRequest.current) return;
      setSelectedProduct(null);
      toast.error("Ürün seçenekleri yüklenemedi", {
        description:
          error instanceof Error ? error.message : "Lütfen bağlantınızı kontrol edip tekrar deneyin.",
      });
    } finally {
      if (requestId === detailRequest.current) setProductDetailLoading(false);
    }
  }

  function addSelectedProduct() {
    if (!selectedProduct) return;
    const groups = selectedProduct.modifier_groups ?? [];
    for (const group of groups) {
      const count = group.modifiers.filter((modifier) => selectedModifiers.has(modifier.id)).length;
      if (group.is_required && count < Math.max(1, group.minimum_selection)) {
        toast.error(`${group.name} seçimi zorunlu.`);
        return;
      }
      if (group.maximum_selection !== null && count > group.maximum_selection) {
        toast.error(`${group.name} için en fazla ${group.maximum_selection} seçim yapabilirsiniz.`);
        return;
      }
    }
    const modifiers = groups
      .flatMap((group) => group.modifiers)
      .filter((modifier) => selectedModifiers.has(modifier.id));
    setPending((items) => [
      ...items,
      {
        lineId: crypto.randomUUID(),
        product: selectedProduct,
        quantity: productQuantity,
        note: productNote.trim(),
        modifiers,
      },
    ]);
    setSelectedProduct(null);
    submissionKey.current = null;
    toast.success(`${selectedProduct.name} siparişe eklendi`);
  }

  const dataLoading =
    tableQuery.isLoading ||
    categoriesQuery.isLoading ||
    productsQuery.isLoading ||
    orderQuery.isLoading;
  const dataError =
    tableQuery.error ??
    categoriesQuery.error ??
    productsQuery.error ??
    orderQuery.error;
  const dataFetching =
    tableQuery.isFetching ||
    categoriesQuery.isFetching ||
    productsQuery.isFetching ||
    orderQuery.isFetching;

  if (dataLoading) {
    return (
      <div className="flex min-h-72 items-center justify-center" role="status">
        <Loader2 className="size-6 animate-spin text-brand" />
        <span className="sr-only">Sipariş ekranı yükleniyor</span>
      </div>
    );
  }

  if (dataError) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center">
        <AlertTriangle className="size-7 text-destructive" />
        <h1 className="mt-4 text-base font-semibold">Sipariş ekranı yüklenemedi</h1>
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
          Masa, katalog veya aktif sipariş verilerine ulaşılamıyor. Bağlantınızı kontrol edip yeniden deneyin.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" render={<Link href="/waiter/tables" />}>
            <ArrowLeft />
            Masalara dön
          </Button>
          <Button
            disabled={dataFetching}
            onClick={() => {
              void Promise.all([
                tableQuery.refetch(),
                categoriesQuery.refetch(),
                productsQuery.refetch(),
                orderQuery.refetch(),
              ]);
            }}
          >
            <RefreshCw className={cn(dataFetching && "animate-spin")} />
            Yeniden dene
          </Button>
        </div>
      </div>
    );
  }

  const cartContent = (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {order?.items?.length ? (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                  Gönderilenler
                </h3>
                <span className="text-[0.65rem] text-muted-foreground">{order.items.length} kalem</span>
              </div>
              <div className="space-y-2">
                {order.items.map((item) => {
                  const cancelled = terminalItemStatuses.has(item.status);
                  return (
                    <div key={item.id} className="rounded-xl border bg-muted/20 p-3">
                      <div className="flex items-start gap-2">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold">
                          {Number(item.quantity)}×
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold">{item.product_name_snapshot}</p>
                          {item.modifiers?.length ? (
                            <p className="mt-0.5 truncate text-[0.62rem] text-muted-foreground">
                              {item.modifiers.map((modifier) => modifier.name_snapshot).join(" · ")}
                            </p>
                          ) : null}
                          {item.note ? (
                            <p className="mt-1 flex items-center gap-1 text-[0.62rem] text-amber-700 dark:text-amber-300">
                              <MessageSquareText className="size-3" />
                              {item.note}
                            </p>
                          ) : null}
                          {cancelled ? (
                            <StatusBadge tone="danger" dot={false} className="mt-1.5 h-5 px-1.5 text-[0.56rem]">
                              İptal
                            </StatusBadge>
                          ) : null}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 text-right">
                          <p className="text-xs font-semibold">{currency.format(Number(item.line_total))}</p>
                          {!cancelled ? (
                            <button
                              type="button"
                              onClick={() => {
                                setCancellationItem(item);
                                setCancellationReason("");
                              }}
                              className="inline-flex items-center gap-1 text-[0.62rem] font-medium text-muted-foreground hover:text-destructive"
                            >
                              <CircleOff className="size-3" />
                              İptal talebi
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-brand">
                Yeni kalemler
              </h3>
              <span className="text-[0.65rem] text-muted-foreground">{pending.length} kalem</span>
            </div>
            {pending.length ? (
              <div className="space-y-2">
                {pending.map((item) => (
                  <div key={item.lineId} className="rounded-xl border border-brand/20 bg-brand/[0.035] p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex shrink-0 items-center rounded-lg border bg-card">
                        <button
                          type="button"
                          onClick={() =>
                            setPending((items) =>
                              items
                                .map((line) =>
                                  line.lineId === item.lineId
                                    ? { ...line, quantity: line.quantity - 1 }
                                    : line,
                                )
                                .filter((line) => line.quantity > 0),
                            )
                          }
                          className="flex size-7 items-center justify-center"
                          aria-label="Adedi azalt"
                        >
                          <Minus className="size-3" />
                        </button>
                        <span className="w-6 text-center text-xs font-bold">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setPending((items) =>
                              items.map((line) =>
                                line.lineId === item.lineId
                                  ? { ...line, quantity: Math.min(99, line.quantity + 1) }
                                  : line,
                              ),
                            )
                          }
                          className="flex size-7 items-center justify-center"
                          aria-label="Adedi artır"
                        >
                          <Plus className="size-3" />
                        </button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold">{item.product.name}</p>
                        {item.modifiers.length ? (
                          <p className="mt-0.5 truncate text-[0.62rem] text-muted-foreground">
                            {item.modifiers.map((modifier) => modifier.name).join(" · ")}
                          </p>
                        ) : null}
                        {item.note ? (
                          <p className="mt-1 text-[0.62rem] text-amber-700 dark:text-amber-300">{item.note}</p>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold">
                          {currency.format(itemUnitPrice(item) * item.quantity)}
                        </p>
                        <button
                          type="button"
                          onClick={() => setPending((items) => items.filter((line) => line.lineId !== item.lineId))}
                          className="mt-1 inline-flex text-muted-foreground hover:text-destructive"
                          aria-label={`${item.product.name} kaldır`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed text-center">
                <ShoppingBag className="size-5 text-muted-foreground" />
                <p className="mt-2 text-xs font-semibold">Henüz yeni kalem yok</p>
                <p className="mt-1 text-[0.62rem] text-muted-foreground">Menüden bir ürün seçin.</p>
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
      <div className="border-t bg-card p-4">
        <div className="mb-3 space-y-1.5 text-xs">
          <div className="flex justify-between text-muted-foreground">
            <span>Gönderilmiş toplam</span>
            <span>{currency.format(Number(order?.total ?? 0))}</span>
          </div>
          {pendingTotal > 0 ? (
            <div className="flex justify-between text-brand">
              <span>Yeni kalemler</span>
              <span>+{currency.format(pendingTotal)}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t pt-2 text-base font-semibold">
            <span>Masa toplamı</span>
            <span>{currency.format(total)}</span>
          </div>
        </div>
        <Button
          className="h-12 w-full rounded-xl"
          disabled={!pending.length || submitMutation.isPending}
          onClick={() => submitMutation.mutate()}
        >
          {submitMutation.isPending ? <Loader2 className="animate-spin" /> : <Send />}
          {pending.length ? `${pending.length} yeni kalemi gönder` : "Yeni kalem yok"}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="grid min-h-[calc(100dvh-6.5rem)] gap-3 lg:grid-cols-[minmax(0,1fr)_390px]">
      <section className="min-w-0">
        <div className="mb-3 flex items-center gap-2">
          <Link
            href="/waiter/tables"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card"
            aria-label="Masalara dön"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold">
                Masa {table?.name ?? "..."}
              </h1>
            </div>
            <p className="text-[0.65rem] text-muted-foreground">
              {order
                ? `${order.items.length} gönderilmiş kalem · ${
                    order.status === "BILL_REQUESTED" ? "Hesap istendi" : "Açık"
                  }`
                : "Yeni masa oturumu"}
            </p>
          </div>
          {order ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="h-10 rounded-xl"
                disabled={billMutation.isPending}
                onClick={() => billMutation.mutate()}
              >
                {billMutation.isPending ? <Loader2 className="animate-spin" /> : <ReceiptText />}
                <span className="hidden sm:inline">Hesap iste</span>
              </Button>
              <Button
                variant="outline"
                className="h-10 rounded-xl"
                disabled={printBillMutation.isPending}
                onClick={() => printBillMutation.mutate()}
              >
                {printBillMutation.isPending ? <Loader2 className="animate-spin" /> : <Printer />}
                <span className="hidden sm:inline">Bilgi fişi</span>
              </Button>
            </div>
          ) : (
            <div className="relative hidden sm:block">
              <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="Müşteri adı"
                className="h-10 w-40 rounded-xl pl-9"
              />
            </div>
          )}
        </div>

        <div className="sticky top-[4.45rem] z-20 -mx-3 bg-background/95 px-3 pb-3 pt-1 backdrop-blur-xl sm:-mx-5 sm:px-5 lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Ürün ara"
              name="waiter-product-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Ürün ara…"
              className="h-11 rounded-xl bg-card pl-10"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-label="Aramayı temizle"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          <div className="scrollbar-subtle flex gap-1.5 overflow-x-auto pb-1">
            {categories.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setCategory(item.id)}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold",
                  category === item.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground ring-1 ring-border",
                )}
              >
                {index === 0 ? <ShoppingBag className="size-3.5" /> : null}
                {item.name}
              </button>
            ))}
          </div>
        </div>

        {productsQuery.isLoading ? (
          <div className="flex min-h-72 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-brand" />
          </div>
        ) : visibleProducts.length ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {visibleProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => void openProduct(product)}
                className="group flex min-h-36 flex-col rounded-2xl border bg-card p-3 text-left transition-[transform,box-shadow,border-color] active:scale-[0.98] lg:hover:-translate-y-0.5 lg:hover:border-brand/25 lg:hover:shadow-lg lg:hover:shadow-black/5"
              >
                <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <ChefHat className="size-4" />
                </span>
                <span className="line-clamp-2 text-sm font-semibold leading-5">{product.name}</span>
                <span className="mt-1 line-clamp-1 text-[0.62rem] text-muted-foreground">
                  {product.description ?? "Hızlı sipariş"}
                </span>
                <span className="mt-auto flex w-full items-end justify-between pt-3">
                  <span className="text-sm font-bold tabular-nums">
                    {currency.format(Number(product.selling_price))}
                  </span>
                  <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors group-hover:bg-brand group-hover:text-brand-foreground">
                    <Plus className="size-4" />
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex min-h-60 flex-col items-center justify-center rounded-2xl border border-dashed">
            <Search className="size-5 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">Ürün bulunamadı</p>
            <Button variant="ghost" className="mt-2" onClick={() => { setSearch(""); setCategory("all"); }}>
              Filtreleri temizle
            </Button>
          </div>
        )}
      </section>

      <aside className="hidden min-h-0 overflow-hidden rounded-2xl border bg-card lg:flex lg:flex-col">
        <div className="flex h-14 items-center justify-between border-b px-4">
          <div>
            <h2 className="text-sm font-semibold">Masa siparişi</h2>
            <p className="text-[0.62rem] text-muted-foreground">
              Yeni kalemler turuncu işaretlidir
            </p>
          </div>
          <StatusBadge tone={pending.length ? "brand" : "neutral"} dot={false}>
            {pending.length} yeni
          </StatusBadge>
        </div>
        {cartContent}
      </aside>

      <div className="fixed inset-x-3 bottom-[4.4rem] z-30 lg:hidden">
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="flex h-14 w-full items-center gap-3 rounded-2xl bg-primary px-4 text-primary-foreground shadow-2xl shadow-black/20"
        >
          <span className="relative flex size-9 items-center justify-center rounded-xl bg-white/10">
            <ShoppingBag className="size-4" />
            {pending.length ? (
              <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-brand text-[0.6rem] font-bold text-brand-foreground">
                {pending.length}
              </span>
            ) : null}
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-xs font-semibold">
              {pending.length ? `${pending.length} yeni kalem` : "Masa siparişini aç"}
            </span>
            <span className="block text-[0.62rem] text-primary-foreground/55">
              {order?.items?.length ?? 0} gönderilmiş
            </span>
          </span>
          <span className="text-sm font-semibold tabular-nums">{currency.format(total)}</span>
          <ChevronDown className="size-4 -rotate-90" />
        </button>
      </div>

      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] rounded-t-3xl p-0">
          <SheetHeader className="border-b text-left">
            <SheetTitle>Masa {table?.name} siparişi</SheetTitle>
            <SheetDescription>Gönderilen ve yeni eklenen kalemler</SheetDescription>
          </SheetHeader>
          {cartContent}
        </SheetContent>
      </Sheet>

      <Dialog
        open={Boolean(selectedProduct)}
        onOpenChange={(open) => {
          if (!open) {
            detailRequest.current += 1;
            setProductDetailLoading(false);
            setSelectedProduct(null);
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedProduct?.name}</DialogTitle>
            <DialogDescription>
              {selectedProduct?.description ?? "Adet, seçenek ve ürün notunu belirleyin."}
            </DialogDescription>
          </DialogHeader>
          {selectedProduct ? (
            <div className="space-y-5">
              {productDetailLoading ? (
                <div className="flex items-center gap-2 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Ürün seçenekleri yükleniyor…
                </div>
              ) : null}
              {(selectedProduct.modifier_groups ?? []).map((group) => (
                <section key={group.id}>
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">{group.name}</h3>
                      <p className="text-[0.62rem] text-muted-foreground">
                        {group.is_required ? "Zorunlu" : "Opsiyonel"} · En fazla {group.maximum_selection ?? "sınırsız"}
                      </p>
                    </div>
                    {group.is_required ? <StatusBadge tone="brand" dot={false}>Gerekli</StatusBadge> : null}
                  </div>
                  <div className="space-y-2">
                    {group.modifiers.map((modifier) => {
                      const checked = selectedModifiers.has(modifier.id);
                      return (
                        <label
                          key={modifier.id}
                          className={cn(
                            "flex min-h-12 items-center gap-3 rounded-xl border p-3",
                            checked && "border-brand/30 bg-brand-soft",
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(nextChecked) =>
                              setSelectedModifiers((current) => {
                                const next = new Set(current);
                                if (nextChecked) {
                                  if (group.maximum_selection === 1) {
                                    group.modifiers.forEach((item) => next.delete(item.id));
                                  }
                                  next.add(modifier.id);
                                } else {
                                  next.delete(modifier.id);
                                }
                                return next;
                              })
                            }
                          />
                          <span className="min-w-0 flex-1 text-sm">{modifier.name}</span>
                          <span className="text-xs font-semibold">
                            {Number(modifier.price_delta)
                              ? `+${currency.format(Number(modifier.price_delta))}`
                              : "Dahil"}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
              <div className="space-y-2">
                <Label htmlFor="product-note">Ürün notu</Label>
                <Textarea
                  id="product-note"
                  rows={3}
                  value={productNote}
                  onChange={(event) => setProductNote(event.target.value)}
                  placeholder="Örn. Sos ayrı, soğansız…"
                  className="rounded-xl"
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border p-3">
                <span>
                  <span className="block text-sm font-semibold">Adet</span>
                  <span className="text-[0.62rem] text-muted-foreground">
                    Birim {currency.format(Number(selectedProduct.selling_price))}
                  </span>
                </span>
                <div className="flex items-center rounded-xl border bg-card">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-10 rounded-xl"
                    onClick={() => setProductQuantity((value) => Math.max(1, value - 1))}
                  >
                    <Minus />
                  </Button>
                  <span className="w-8 text-center text-sm font-bold">{productQuantity}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-10 rounded-xl"
                    onClick={() => setProductQuantity((value) => Math.min(99, value + 1))}
                  >
                    <Plus />
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedProduct(null)}>
              Vazgeç
            </Button>
            <Button onClick={addSelectedProduct} disabled={productDetailLoading}>
              {productDetailLoading ? <Loader2 className="animate-spin" /> : <Plus />}
              {productDetailLoading ? "Seçenekler yükleniyor" : "Siparişe ekle"}
              <span className="ml-auto">
                {currency.format(
                  (Number(selectedProduct?.selling_price ?? 0) +
                    (selectedProduct?.modifier_groups ?? [])
                      .flatMap((group) => group.modifiers)
                      .filter((modifier) => selectedModifiers.has(modifier.id))
                      .reduce((sum, modifier) => sum + Number(modifier.price_delta), 0)) *
                    productQuantity,
                )}
              </span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cancellationItem)}
        onOpenChange={(open) => {
          if (!open && !cancellationMutation.isPending) {
            setCancellationItem(null);
            setCancellationReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kalem iptal talebi oluştur</DialogTitle>
            <DialogDescription>
              Bu işlem kalemi hemen iptal etmez. Talep kasa/yönetici onayına gönderilir ve
              yalnızca onaydan sonra siparişe uygulanır.
            </DialogDescription>
          </DialogHeader>
          <form
            id="waiter-cancel-item-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              cancellationMutation.mutate();
            }}
          >
            <div className="rounded-xl border bg-muted/35 p-3">
              <p className="truncate text-sm font-semibold">
                {cancellationItem?.product_name_snapshot}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {Number(cancellationItem?.quantity ?? 0)} adet ·{" "}
                {currency.format(Number(cancellationItem?.line_total ?? 0))}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="waiter-cancellation-reason">İptal nedeni</Label>
              <Textarea
                id="waiter-cancellation-reason"
                value={cancellationReason}
                onChange={(event) => setCancellationReason(event.target.value)}
                minLength={3}
                maxLength={255}
                aria-describedby="waiter-cancellation-reason-help"
                className="rounded-xl"
                placeholder="Yanlış ürün girildi…"
                autoFocus
              />
              <p
                id="waiter-cancellation-reason-help"
                className={cn(
                  "text-xs",
                  cancellationReason.length > 0 && cancellationReason.trim().length < 3
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                Denetim kaydı için en az 3 karakter · {cancellationReason.length}/255
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={cancellationMutation.isPending}
                onClick={() => {
                  setCancellationItem(null);
                  setCancellationReason("");
                }}
              >
                Vazgeç
              </Button>
              <Button
                type="submit"
                disabled={cancellationReason.trim().length < 3 || cancellationMutation.isPending}
              >
                {cancellationMutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                Onaya gönder
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
