"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  Check,
  ChevronRight,
  CircleDollarSign,
  CircleOff,
  CreditCard,
  DoorClosed,
  Grid2X2,
  Loader2,
  Merge,
  MoreHorizontal,
  Plus,
  Printer,
  ReceiptText,
  Search,
  Split,
  Tags,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { StaffLoyaltyPanel } from "@/components/loyalty/staff-loyalty-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  canCloseTableSession,
  selectCurrentTableOrder,
  terminalOrderStatuses,
} from "./cashier-rules";

type Area = { id: string; name: string };
type DiningTable = {
  id: string;
  area_id: string;
  name: string;
  capacity: number;
  state: string;
  version: number;
};
type Product = {
  id: string;
  name: string;
  category_id: string;
  selling_price: string | number;
  is_available: boolean;
};
type OrderItem = {
  id: string;
  product_name_snapshot: string;
  unit_price: string | number;
  quantity: string | number;
  line_total: string | number;
  status: string;
  note?: string | null;
};
type Payment = { id: string; method: string; amount: string | number; status: string };
type Order = {
  id: string;
  table_id?: string | null;
  table_session_id?: string | null;
  table_name?: string | null;
  status: string;
  customer_name?: string | null;
  subtotal: string | number;
  discount_total: string | number;
  tax_total: string | number;
  total: string | number;
  items: OrderItem[];
  payments: Payment[];
};
type ApprovalRequest = {
  id: string;
  order_id: string;
  order_item_id: string | null;
  status: string;
};
type MergeCandidate = {
  table: DiningTable;
  order: Order;
};
type TableSessionCloseResult = {
  table: DiningTable;
  session_id: string;
  already_closed: boolean;
  closed_at: string | null;
};

const currency = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
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
  const payload = (await response.json().catch(() => null)) as
    | T
    | {
        detail?: string;
        message?: string;
        error?: { message?: string };
      }
    | null;
  if (!response.ok) {
    const error = payload as {
      detail?: string;
      message?: string;
      error?: { message?: string };
    } | null;
    throw new Error(
      error?.error?.message ??
        error?.detail ??
        error?.message ??
        "İşlem tamamlanamadı.",
    );
  }
  return payload as T;
}

const tableState: Record<string, { label: string; tone: Parameters<typeof StatusBadge>[0]["tone"]; color: string }> = {
  AVAILABLE: { label: "Müsait", tone: "neutral", color: "border-border" },
  OCCUPIED: { label: "Açık", tone: "info", color: "border-blue-500/30" },
  ORDER_PENDING: { label: "Sipariş", tone: "warning", color: "border-amber-500/35" },
  PREPARING: { label: "Hazırlık", tone: "brand", color: "border-brand/35" },
  READY: { label: "Hazır", tone: "success", color: "border-emerald-500/40" },
  BILL_REQUESTED: { label: "Hesap", tone: "purple", color: "border-violet-500/40" },
  PAYMENT_PENDING: { label: "Ödeme", tone: "purple", color: "border-violet-500/40" },
  CLEANING: { label: "Kapanış", tone: "neutral", color: "border-slate-500/30" },
};

const loyaltyEligibleOrderStatuses = new Set([
  "ACCEPTED",
  "PREPARING",
  "PARTIALLY_READY",
  "READY",
  "SERVED",
  "BILL_REQUESTED",
]);
const terminalItemStatuses = new Set(["CANCELLED", "VOIDED"]);

function buildMergeCandidates(
  orders: Order[],
  tables: DiningTable[],
  selectedOrderId?: string,
  selectedTableId?: string,
) {
  const candidates = new Map<string, MergeCandidate>();
  for (const order of orders) {
    if (
      order.id === selectedOrderId ||
      terminalOrderStatuses.has(order.status)
    ) {
      continue;
    }
    const table =
      tables.find((item) => item.id === order.table_id) ??
      tables.find((item) => item.name === order.table_name);
    if (!table || table.id === selectedTableId || candidates.has(table.id)) {
      continue;
    }
    candidates.set(table.id, { table, order });
  }
  return Array.from(candidates.values());
}

export function CashierWorkspace() {
  const queryClient = useQueryClient();
  const [selectedArea, setSelectedArea] = useState("all");
  const [selectedTableId, setSelectedTableId] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [dialog, setDialog] = useState<
    | "products"
    | "payment"
    | "discount"
    | "transfer"
    | "merge"
    | "split"
    | "cancel-item"
    | "close-table"
    | null
  >(null);
  const [productSearch, setProductSearch] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [discountKind, setDiscountKind] = useState("PERCENTAGE");
  const [discountValue, setDiscountValue] = useState("10");
  const [reason, setReason] = useState("");
  const [destinationTable, setDestinationTable] = useState("");
  const [mergeDestinationTable, setMergeDestinationTable] = useState("");
  const [mergeReason, setMergeReason] = useState("");
  const [mergeIdempotencyKey, setMergeIdempotencyKey] = useState("");
  const [cancellationItem, setCancellationItem] = useState<OrderItem | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [splitAmount, setSplitAmount] = useState("");

  const areasQuery = useQuery({
    queryKey: ["cashier", "areas"],
    queryFn: async () => unwrap<Area>(await api<unknown>("/tables/areas")),
  });
  const tablesQuery = useQuery({
    queryKey: ["cashier", "tables"],
    queryFn: async () => unwrap<DiningTable>(await api<unknown>("/tables")),
    refetchInterval: 8_000,
  });
  const ordersQuery = useQuery({
    queryKey: ["cashier", "orders"],
    queryFn: async () =>
      unwrap<Order>(await api<unknown>("/orders?limit=200")),
    refetchInterval: 8_000,
  });
  const productsQuery = useQuery({
    queryKey: ["cashier", "products"],
    queryFn: async () =>
      unwrap<Product>(
        await api<unknown>("/catalog/products?limit=200"),
      ).filter((item) => item.is_available),
  });

  const areas = areasQuery.data ?? [];
  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);
  const orders = ordersQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const selectedTable = tables.find((table) => table.id === selectedTableId) ?? tables[0];
  const selectedOrder = selectCurrentTableOrder(orders, selectedTable);
  const paid = selectedOrder?.payments
    .filter((payment) => payment.status === "COMPLETED")
    .reduce((sum, payment) => sum + Number(payment.amount), 0) ?? 0;
  const remaining = Math.max(0, Number(selectedOrder?.total ?? 0) - paid);
  const tableCanClose = canCloseTableSession(
    selectedOrder,
    selectedTable,
    remaining,
  );
  const tableCloseHint = !selectedOrder
    ? "Kapatılacak aktif masa oturumu yok."
    : !terminalOrderStatuses.has(selectedOrder.status)
      ? "Masayı kapatmadan önce hesabı tamamen ödeyin veya siparişi iptal edin."
      : selectedOrder.status === "PAID" && remaining > 0.005
        ? `Kalan ${currency.format(remaining)} tahsil edilmeden masa kapatılamaz.`
        : tableCanClose
          ? "Kapanıştan sonra masa yeniden sipariş almaya açılır."
          : "Bu masa oturumu kapatılmaya uygun değil.";

  const filteredTables = useMemo(
    () =>
      tables.filter((table) => {
        const areaMatch = selectedArea === "all" || table.area_id === selectedArea;
        const searchMatch = table.name.toLocaleLowerCase("tr-TR").includes(tableSearch.toLocaleLowerCase("tr-TR"));
        return areaMatch && searchMatch;
      }),
    [selectedArea, tableSearch, tables],
  );
  const filteredProducts = products.filter((product) =>
    product.name.toLocaleLowerCase("tr-TR").includes(productSearch.toLocaleLowerCase("tr-TR")),
  );
  const mergeCandidates = buildMergeCandidates(
    orders,
    tables,
    selectedOrder?.id,
    selectedTable?.id,
  );

  function refreshOperations() {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cashier"] }),
      queryClient.invalidateQueries({ queryKey: ["orders"] }),
      queryClient.invalidateQueries({ queryKey: ["tables"] }),
      queryClient.invalidateQueries({ queryKey: ["waiter"] }),
      queryClient.invalidateQueries({ queryKey: ["kitchen"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-operations"] }),
    ]);
  }

  const productMutation = useMutation({
    mutationFn: async (product: Product) => {
      if (!selectedTable) {
        throw new Error("Canlı masa verisi olmadan ürün eklenemez.");
      }
      const payloadItems = [{ product_id: product.id, quantity: "1", note: null, modifiers: [] }];
      if (selectedOrder) {
        return api<Order>(`/orders/${selectedOrder.id}/items`, {
          method: "POST",
          body: JSON.stringify({ items: payloadItems, idempotency_key: crypto.randomUUID() }),
        });
      }
      return api<Order>("/orders", {
        method: "POST",
        body: JSON.stringify({
          table_id: selectedTable.id,
          source: "CASHIER",
          items: payloadItems,
          idempotency_key: crypto.randomUUID(),
          auto_accept: true,
        }),
      });
    },
    onSuccess: (_, product) => {
      toast.success(`${product.name} siparişe eklendi`);
      refreshOperations();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Ürün eklenemedi."),
  });

  const paymentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrder) throw new Error("Canlı sipariş verisi bulunamadı.");
      return api(`/orders/${selectedOrder.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          method: paymentMethod,
          amount: paymentAmount,
          idempotency_key: crypto.randomUUID(),
        }),
      });
    },
    onSuccess: () => {
      toast.success("Ödeme kaydedildi", {
        description: `${currency.format(Number(paymentAmount))} · ${paymentMethod}`,
      });
      setDialog(null);
      refreshOperations();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Ödeme kaydedilemedi."),
  });

  const closeTableMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTable || !selectedOrder?.table_session_id) {
        throw new Error("Kapatılabilecek canlı masa oturumu bulunamadı.");
      }
      return api<TableSessionCloseResult>(
        `/tables/${selectedTable.id}/sessions/${selectedOrder.table_session_id}/close`,
        {
          method: "POST",
          body: JSON.stringify({
            expected_table_version: selectedTable.version,
          }),
        },
      );
    },
    onSuccess: (result) => {
      if (result.already_closed) {
        toast.info("Masa oturumu zaten kapatılmış");
      } else {
        toast.success("Masa kapatıldı", {
          description: `${selectedTable?.name ?? "Masa"} yeniden sipariş almaya hazır.`,
        });
      }
      setDialog(null);
      refreshOperations();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Masa kapatılamadı.",
      );
      refreshOperations();
    },
  });

  const discountMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrder) throw new Error("Canlı sipariş verisi bulunamadı.");
      return api(`/orders/${selectedOrder.id}/discount-requests`, {
        method: "POST",
        body: JSON.stringify({
          kind: discountKind,
          value: discountValue,
          reason,
        }),
      });
    },
    onSuccess: () => {
      toast.success("İndirim onaya gönderildi");
      setDialog(null);
      refreshOperations();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "İndirim talebi oluşturulamadı."),
  });

  const transferMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrder) throw new Error("Canlı sipariş verisi bulunamadı.");
      return api(`/orders/${selectedOrder.id}/transfer`, {
        method: "POST",
        body: JSON.stringify({ destination_table_id: destinationTable, reason }),
      });
    },
    onSuccess: () => {
      toast.success("Masa transfer edildi");
      setSelectedTableId(destinationTable);
      setDialog(null);
      refreshOperations();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Masa transfer edilemedi."),
  });

  const mergeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrder) {
        throw new Error("Canlı sipariş verisi bulunamadı.");
      }
      if (terminalOrderStatuses.has(selectedOrder.status)) {
        throw new Error("Kapanmış bir sipariş başka masayla birleştirilemez.");
      }
      const target = mergeCandidates.find(
        (candidate) => candidate.table.id === mergeDestinationTable,
      );
      if (!target) {
        throw new Error("Aktif siparişi olan geçerli bir hedef masa seçin.");
      }
      const trimmedReason = mergeReason.trim();
      if (trimmedReason.length < 3) {
        throw new Error("Birleştirme nedeni en az 3 karakter olmalıdır.");
      }
      if (mergeIdempotencyKey.length < 8) {
        throw new Error("Birleştirme işlem anahtarı oluşturulamadı.");
      }
      return api<Order>(`/orders/${selectedOrder.id}/merge`, {
        method: "POST",
        body: JSON.stringify({
          destination_table_id: target.table.id,
          reason: trimmedReason,
          idempotency_key: mergeIdempotencyKey,
        }),
      });
    },
    onSuccess: (mergedOrder) => {
      toast.success("Masalar birleştirildi", {
        description: `Hesap Masa ${
          mergeCandidates.find(
            (candidate) => candidate.table.id === mergeDestinationTable,
          )?.table.name ?? ""
        } üzerinde devam ediyor.`,
      });
      setSelectedTableId(mergedOrder.table_id ?? mergeDestinationTable);
      setMergeDestinationTable("");
      setMergeReason("");
      setMergeIdempotencyKey("");
      setDialog(null);
      refreshOperations();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Masalar birleştirilemedi.",
      ),
  });

  const cancellationMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrder || !cancellationItem) {
        throw new Error("Canlı sipariş kalemi bulunamadı.");
      }
      if (terminalItemStatuses.has(cancellationItem.status)) {
        throw new Error("İptal edilmiş bir kalem için yeni talep oluşturulamaz.");
      }
      const trimmedReason = cancellationReason.trim();
      if (trimmedReason.length < 3) {
        throw new Error("İptal nedeni en az 3 karakter olmalıdır.");
      }
      return api<ApprovalRequest>(
        `/orders/${selectedOrder.id}/cancellation-requests`,
        {
          method: "POST",
          body: JSON.stringify({
            order_item_id: cancellationItem.id,
            reason: trimmedReason,
          }),
        },
      );
    },
    onSuccess: (approval) => {
      toast.success("İptal talebi yönetici onayına gönderildi", {
        description: `${cancellationItem?.product_name_snapshot ?? "Sipariş kalemi"} · ${approval.status}`,
      });
      setCancellationItem(null);
      setCancellationReason("");
      setDialog(null);
      refreshOperations();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "İptal talebi oluşturulamadı.",
      ),
  });

  const splitMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrder) throw new Error("Canlı sipariş verisi bulunamadı.");
      return api(`/orders/${selectedOrder.id}/split/amount`, {
        method: "POST",
        body: JSON.stringify({
          parts: [
            Number(splitAmount).toFixed(2),
            (remaining - Number(splitAmount)).toFixed(2),
          ],
          idempotency_key: crypto.randomUUID(),
        }),
      });
    },
    onSuccess: () => {
      toast.success("Bölünmüş hesap oluşturuldu");
      setDialog(null);
      refreshOperations();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Hesap bölünemedi."),
  });

  const printMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrder) throw new Error("Canlı sipariş verisi bulunamadı.");
      return api("/printing/jobs", {
        method: "POST",
        body: JSON.stringify({
          order_id: selectedOrder.id,
          payload: {
            type: "BILL",
            order_id: selectedOrder.id,
            table_name: selectedTable?.name,
            copy: true,
          },
          kind: "REPRINT",
          idempotency_key: `bill-reprint:${selectedOrder.id}:${crypto.randomUUID()}`,
        }),
      });
    },
    onSuccess: () => toast.success("Yeniden baskı kuyruğa alındı", { description: "Fiş REPRINT olarak işaretlendi." }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Baskı işi oluşturulamadı."),
  });

  const workspaceLoading =
    areasQuery.isLoading ||
    tablesQuery.isLoading ||
    ordersQuery.isLoading ||
    productsQuery.isLoading;
  const workspaceError =
    areasQuery.error ??
    tablesQuery.error ??
    ordersQuery.error ??
    productsQuery.error;
  const workspaceFetching =
    areasQuery.isFetching ||
    tablesQuery.isFetching ||
    ordersQuery.isFetching ||
    productsQuery.isFetching;

  if (workspaceLoading) {
    return (
      <div
        className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-muted/25"
        role="status"
      >
        <Loader2 className="size-7 animate-spin text-brand" />
        <span className="sr-only">Kasa çalışma alanı yükleniyor</span>
      </div>
    );
  }

  if (workspaceError) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] bg-muted/25 p-4 sm:p-6">
        <EmptyState
          title="Kasa çalışma alanı yüklenemedi"
          description="Masa, sipariş veya ürün verilerine ulaşılamıyor. Bağlantınızı kontrol edip yeniden deneyin."
          icon={AlertTriangle}
          action={
            <Button
              variant="outline"
              disabled={workspaceFetching}
              onClick={() => {
                void Promise.all([
                  areasQuery.refetch(),
                  tablesQuery.refetch(),
                  ordersQuery.refetch(),
                  productsQuery.refetch(),
                ]);
              }}
            >
              {workspaceFetching ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Grid2X2 />
              )}
              Yeniden dene
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="grid min-h-[calc(100dvh-4rem)] bg-muted/25 xl:grid-cols-[280px_minmax(0,1fr)_350px]">
      <aside className="border-r bg-card xl:min-h-[calc(100dvh-4rem)]">
        <div className="border-b p-3">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h1 className="text-sm font-semibold">Masalar</h1>
              <p className="text-[0.65rem] text-muted-foreground">{tables.length} masa · {orders.length} açık hesap</p>
            </div>
            <StatusBadge tone="success" pulse>Canlı</StatusBadge>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Masa ara"
              name="cashier-table-search"
              value={tableSearch}
              onChange={(event) => setTableSearch(event.target.value)}
              placeholder="Masa ara…"
              className="h-10 rounded-xl pl-9"
            />
          </div>
        </div>
        <div className="scrollbar-subtle flex gap-1 overflow-x-auto border-b p-2 xl:flex-wrap">
          <button
            type="button"
            className={cn(
              "h-8 shrink-0 rounded-lg px-2.5 text-[0.68rem] font-semibold",
              selectedArea === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}
            onClick={() => setSelectedArea("all")}
          >
            Tümü
          </button>
          {areas.map((area) => (
            <button
              key={area.id}
              type="button"
              className={cn(
                "h-8 shrink-0 rounded-lg px-2.5 text-[0.68rem] font-semibold",
                selectedArea === area.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
              onClick={() => setSelectedArea(area.id)}
            >
              {area.name}
            </button>
          ))}
        </div>
        <ScrollArea className="h-[320px] xl:h-[calc(100dvh-13.4rem)]">
          <div className="grid grid-cols-2 gap-2 p-2 xl:grid-cols-1">
            {filteredTables.map((table) => {
              const meta = tableState[table.state] ?? tableState.AVAILABLE;
              const order = selectCurrentTableOrder(orders, table);
              return (
                <button
                  type="button"
                  key={table.id}
                  onClick={() => setSelectedTableId(table.id)}
                  className={cn(
                    "flex min-h-18 items-center gap-3 rounded-xl border bg-card p-2.5 text-left transition-colors",
                    meta.color,
                    selectedTableId === table.id && "border-primary bg-primary/[0.035] ring-2 ring-primary/10",
                  )}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-bold">
                    {table.name}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold">{meta.label}</span>
                    <span className="mt-0.5 block truncate text-[0.62rem] text-muted-foreground">
                      {order ? currency.format(Number(order.total)) : `${table.capacity} kişilik`}
                    </span>
                  </span>
                  <ChevronRight className="hidden size-4 text-muted-foreground xl:block" />
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </aside>

      <section className="min-w-0 border-r bg-background">
        <header className="flex min-h-16 items-center gap-3 border-b bg-card px-4">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-lg font-bold text-brand">
            {selectedTable?.name ?? "—"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold">
                {selectedTable ? `Masa ${selectedTable.name}` : "Masa seçin"}
              </h2>
              {selectedOrder ? (
                <StatusBadge tone={tableState[selectedTable?.state ?? "AVAILABLE"]?.tone ?? "neutral"}>
                  {selectedOrder.status}
                </StatusBadge>
              ) : null}
            </div>
            <p className="text-[0.65rem] text-muted-foreground">
              {selectedOrder?.customer_name || (selectedOrder ? `${selectedOrder.items.length} kalem` : "Yeni hesap")}
            </p>
          </div>
          <Button
            variant="outline"
            className="h-9 rounded-xl"
            onClick={() => setDialog("products")}
            disabled={
              !selectedTable ||
              Boolean(selectedOrder && terminalOrderStatuses.has(selectedOrder.status))
            }
          >
            <Plus />
            Ürün ekle
          </Button>
        </header>

        <ScrollArea className="h-[440px] xl:h-[calc(100dvh-12.2rem)]">
          <div className="p-4">
            {selectedOrder?.items?.length ? (
              <div className="space-y-2">
                {selectedOrder.items.map((item) => (
                  <article key={item.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-xs font-bold">
                      {Number(item.quantity)}×
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{item.product_name_snapshot}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <StatusBadge
                          tone={
                            item.status === "READY"
                              ? "success"
                              : item.status === "PREPARING"
                                ? "brand"
                                : item.status === "SERVED"
                                  ? "neutral"
                                  : "info"
                          }
                          dot={false}
                          className="h-5 px-1.5 text-[0.56rem]"
                        >
                          {item.status}
                        </StatusBadge>
                        {item.note ? <span className="truncate text-[0.62rem] text-amber-700">{item.note}</span> : null}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">{currency.format(Number(item.line_total))}</p>
                      <p className="text-[0.62rem] text-muted-foreground">{currency.format(Number(item.unit_price))} / adet</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`${item.product_name_snapshot} kalem işlemleri`}
                            disabled={cancellationMutation.isPending}
                          />
                        }
                      >
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={terminalItemStatuses.has(item.status)}
                          onClick={() => {
                            setCancellationItem(item);
                            setCancellationReason("");
                            setDialog("cancel-item");
                          }}
                        >
                          <CircleOff />
                          İptal talebi oluştur
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </article>
                ))}
                  <Button
                    variant="outline"
                    className="mt-3 h-12 w-full rounded-xl border-dashed text-muted-foreground"
                    onClick={() => setDialog("products")}
                    disabled={
                      !selectedTable ||
                      Boolean(
                        selectedOrder && terminalOrderStatuses.has(selectedOrder.status),
                      )
                    }
                >
                  <Plus />
                  Yeni kalem ekle
                </Button>
              </div>
            ) : (
              <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed text-center">
                <Grid2X2 className="size-7 text-muted-foreground" />
                <h3 className="mt-4 text-sm font-semibold">
                  {selectedTable ? `${selectedTable.name} için açık sipariş yok` : "Bir masa seçin"}
                </h3>
                <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                  Müşterinin siparişini başlatmak için ürün ekleyin.
                </p>
                <Button
                  className="mt-4 h-10 rounded-xl"
                  onClick={() => setDialog("products")}
                  disabled={
                    !selectedTable ||
                    Boolean(
                      selectedOrder && terminalOrderStatuses.has(selectedOrder.status),
                    )
                  }
                >
                  <Plus />
                  İlk ürünü ekle
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>

        <footer className="grid grid-cols-2 gap-2 border-t bg-card p-3 sm:grid-cols-4">
          <Button
            variant="outline"
            className="h-10 rounded-xl"
            disabled={
              !selectedOrder || terminalOrderStatuses.has(selectedOrder.status)
            }
            onClick={() => setDialog("transfer")}
          >
            <ArrowLeftRight />
            Masa taşı
          </Button>
          <Button
            variant="outline"
            className="h-10 rounded-xl"
            disabled={
              !selectedOrder || terminalOrderStatuses.has(selectedOrder.status)
            }
            onClick={() => setDialog("split")}
          >
            <Split />
            Hesabı böl
          </Button>
          <Button
            variant="outline"
            className="h-10 rounded-xl"
            disabled={
              !selectedOrder ||
              terminalOrderStatuses.has(selectedOrder.status) ||
              mergeCandidates.length === 0 ||
              mergeMutation.isPending
            }
            title={
              mergeCandidates.length
                ? undefined
                : "Birleştirilebilecek başka aktif masa siparişi yok"
            }
            onClick={() => {
              setMergeDestinationTable("");
              setMergeReason("");
              setMergeIdempotencyKey(`cashier-merge:${crypto.randomUUID()}`);
              setDialog("merge");
            }}
          >
            <Merge />
            Masaları birleştir
          </Button>
          <Button variant="outline" className="h-10 rounded-xl" disabled={!selectedOrder || printMutation.isPending} onClick={() => printMutation.mutate()}>
            {printMutation.isPending ? <Loader2 className="animate-spin" /> : <Printer />}
            Fiş yazdır
          </Button>
        </footer>
      </section>

      <aside className="bg-card">
        <div className="border-b p-4">
          <h2 className="text-sm font-semibold">Hesap ve ödeme</h2>
          <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
            {selectedTable ? `Masa ${selectedTable.name}` : "Masa seçilmedi"}
          </p>
        </div>
        <div className="space-y-4 p-4">
          <div className="space-y-2 rounded-2xl bg-muted/45 p-4 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Ara toplam</span>
              <span className="tabular-nums">{currency.format(Number(selectedOrder?.subtotal ?? 0))}</span>
            </div>
            <div className="flex justify-between text-emerald-700 dark:text-emerald-300">
              <span>İndirimler</span>
              <span className="tabular-nums">−{currency.format(Number(selectedOrder?.discount_total ?? 0))}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Vergi</span>
              <span className="tabular-nums">{currency.format(Number(selectedOrder?.tax_total ?? 0))}</span>
            </div>
            <div className="flex justify-between border-t pt-3 text-xl font-semibold">
              <span>Toplam</span>
              <span className="tabular-nums">{currency.format(Number(selectedOrder?.total ?? 0))}</span>
            </div>
            {paid > 0 ? (
              <>
                <div className="flex justify-between text-blue-700 dark:text-blue-300">
                  <span>Ödenen</span>
                  <span>{currency.format(paid)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Kalan</span>
                  <span>{currency.format(remaining)}</span>
                </div>
              </>
            ) : null}
          </div>

          <StaffLoyaltyPanel
            orderId={selectedOrder?.id ?? null}
            items={selectedOrder?.items ?? []}
            disabled={
              paid > 0 ||
              Boolean(selectedOrder && !loyaltyEligibleOrderStatuses.has(selectedOrder.status))
            }
            compact
            onChanged={refreshOperations}
          />

          <Button
            className="h-14 w-full rounded-2xl text-base"
            disabled={
              !selectedOrder ||
              remaining <= 0 ||
              terminalOrderStatuses.has(selectedOrder.status)
            }
            onClick={() => {
              setPaymentAmount(remaining.toFixed(2));
              setDialog("payment");
            }}
          >
            <WalletCards />
            Ödeme al
            <span className="ml-auto">{currency.format(remaining)}</span>
          </Button>

          <div className="space-y-1.5">
            <Button
              variant="outline"
              className="h-12 w-full rounded-xl"
              disabled={!tableCanClose || closeTableMutation.isPending}
              aria-describedby="table-close-hint"
              onClick={() => setDialog("close-table")}
            >
              {closeTableMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <DoorClosed />
              )}
              Masayı kapat
            </Button>
            <p
              id="table-close-hint"
              className="px-1 text-[0.65rem] leading-4 text-muted-foreground"
              aria-live="polite"
            >
              {tableCloseHint}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11 rounded-xl"
              disabled={
                !selectedOrder || terminalOrderStatuses.has(selectedOrder.status)
              }
              onClick={() => setDialog("discount")}
            >
              <Tags />
              İndirim
            </Button>
            <Button
              variant="outline"
              className="h-11 rounded-xl"
              disabled={
                !selectedOrder || terminalOrderStatuses.has(selectedOrder.status)
              }
              onClick={() => setDialog("split")}
            >
              <Split />
              Parçalı ödeme
            </Button>
          </div>

          <div className="rounded-2xl border p-3">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold">Ödeme geçmişi</h3>
              <span className="text-[0.62rem] text-muted-foreground">{selectedOrder?.payments.length ?? 0} kayıt</span>
            </div>
            {selectedOrder?.payments.length ? (
              <div className="space-y-2">
                {selectedOrder.payments.map((payment) => (
                  <div key={payment.id} className="flex items-center gap-2 rounded-xl bg-muted/45 p-2.5">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-card">
                      {payment.method === "CASH" ? <Banknote className="size-4" /> : <CreditCard className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1 text-xs font-semibold">{payment.method}</span>
                    <span className="text-xs font-semibold">{currency.format(Number(payment.amount))}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-20 flex-col items-center justify-center rounded-xl bg-muted/30 text-center">
                <CircleDollarSign className="size-4 text-muted-foreground" />
                <p className="mt-2 text-[0.65rem] text-muted-foreground">Henüz ödeme yok</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      <Dialog
        open={dialog === "close-table"}
        onOpenChange={(open) => {
          if (!open && !closeTableMutation.isPending) setDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Masayı kapat</DialogTitle>
            <DialogDescription>
              Masa {selectedTable?.name ?? "—"} oturumunu kapatmak üzeresiniz.
              İşlem denetim kaydına yazılır ve masa yeniden sipariş almaya açılır.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border bg-muted/35 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Hesap durumu</span>
              <span className="font-semibold">{selectedOrder?.status ?? "—"}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Kalan bakiye</span>
              <span className="font-semibold tabular-nums">
                {currency.format(remaining)}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={closeTableMutation.isPending}
              onClick={() => setDialog(null)}
            >
              Vazgeç
            </Button>
            <Button
              disabled={!tableCanClose || closeTableMutation.isPending}
              onClick={() => closeTableMutation.mutate()}
            >
              {closeTableMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <DoorClosed />
              )}
              Masayı kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "products"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Masa {selectedTable?.name} · Ürün ekle</DialogTitle>
            <DialogDescription>Eklenen ürün doğrudan mevcut siparişin yeni gönderimine katılır.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Ürün ara"
              name="cashier-product-search"
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="Ürün ara…"
              className="h-11 rounded-xl pl-9"
            />
          </div>
          <div className="grid max-h-[55dvh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {filteredProducts.map((product) => (
              <button
                type="button"
                key={product.id}
                disabled={productMutation.isPending}
                onClick={() => productMutation.mutate(product)}
                className="flex min-h-28 flex-col rounded-xl border p-3 text-left transition-colors hover:border-brand/25 hover:bg-brand-soft/40 disabled:opacity-50"
              >
                <span className="line-clamp-2 text-sm font-semibold">{product.name}</span>
                <span className="mt-auto flex w-full items-center justify-between pt-3">
                  <span className="text-xs font-bold">{currency.format(Number(product.selling_price))}</span>
                  <Plus className="size-4 text-brand" />
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "payment"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ödeme kaydet</DialogTitle>
            <DialogDescription>Kısmi veya tam ödeme alın. Kalan tutar otomatik hesaplanır.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Ödeme yöntemi</Label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ["CASH", Banknote, "Nakit"],
                  ["CARD", CreditCard, "Kart"],
                  ["ROOM_CHARGE", ReceiptText, "Oda"],
                ].map(([value, Icon, label]) => {
                  const MethodIcon = Icon as typeof Banknote;
                  return (
                    <button
                      key={String(value)}
                      type="button"
                      onClick={() => setPaymentMethod(String(value))}
                      className={cn(
                        "flex min-h-20 flex-col items-center justify-center rounded-xl border text-xs font-semibold",
                        paymentMethod === value && "border-brand/35 bg-brand-soft text-brand",
                      )}
                    >
                      <MethodIcon className="mb-2 size-4" />
                      {String(label)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-amount">Tutar</Label>
              <Input
                id="payment-amount"
                type="number"
                step="0.01"
                min="0.01"
                max={remaining}
                value={paymentAmount}
                onChange={(event) => setPaymentAmount(event.target.value)}
                className="h-14 rounded-xl text-xl font-semibold"
              />
              <div className="grid grid-cols-3 gap-2">
                {[remaining / 2, remaining / 3, remaining].map((amount, index) => (
                  <Button
                    key={index}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPaymentAmount(amount.toFixed(2))}
                  >
                    {index === 0 ? "½" : index === 1 ? "⅓" : "Tamamı"}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Vazgeç</Button>
            <Button
              disabled={
                !Number(paymentAmount) ||
                Number(paymentAmount) > remaining ||
                paymentMutation.isPending
              }
              onClick={() => paymentMutation.mutate()}
            >
              {paymentMutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
              Ödemeyi kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "discount"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>İndirim talebi</DialogTitle>
            <DialogDescription>Yetki limitini aşan indirimler yönetici onayına gider.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={discountKind === "PERCENTAGE" ? "default" : "outline"}
                onClick={() => setDiscountKind("PERCENTAGE")}
              >
                Yüzde %
              </Button>
              <Button
                variant={discountKind === "FIXED" ? "default" : "outline"}
                onClick={() => setDiscountKind("FIXED")}
              >
                Sabit ₺
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="discount-value">Değer</Label>
              <Input
                id="discount-value"
                type="number"
                min="0.01"
                value={discountValue}
                onChange={(event) => setDiscountValue(event.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="discount-reason">Neden</Label>
              <Textarea
                id="discount-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="rounded-xl"
                placeholder="Denetim kaydı için açıklama…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Vazgeç</Button>
            <Button
              disabled={
                !discountValue ||
                reason.trim().length < 3 ||
                discountMutation.isPending
              }
              onClick={() => discountMutation.mutate()}
            >
              {discountMutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
              Onaya gönder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "transfer"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Masa transferi</DialogTitle>
            <DialogDescription>Açık oturum ve sipariş hedef masaya transaction içinde taşınır.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Hedef masa</Label>
              <Select value={destinationTable} onValueChange={(value) => setDestinationTable(value ?? "")}>
                <SelectTrigger className="h-11 w-full rounded-xl">
                  <SelectValue placeholder="Müsait masa seçin" />
                </SelectTrigger>
                <SelectContent>
                  {tables
                    .filter((table) => table.state === "AVAILABLE" && table.id !== selectedTable?.id)
                    .map((table) => (
                      <SelectItem key={table.id} value={table.id}>
                        {table.name} · {table.capacity} kişi
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="transfer-reason">Transfer nedeni</Label>
              <Textarea
                id="transfer-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="rounded-xl"
                placeholder="Misafir talebi…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Vazgeç</Button>
            <Button
              disabled={
                !destinationTable ||
                reason.trim().length < 3 ||
                transferMutation.isPending
              }
              onClick={() => transferMutation.mutate()}
            >
              {transferMutation.isPending ? <Loader2 className="animate-spin" /> : <ArrowLeftRight />}
              Masayı taşı
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === "merge"}
        onOpenChange={(open) => {
          if (!open && !mergeMutation.isPending) {
            setMergeDestinationTable("");
            setMergeReason("");
            setMergeIdempotencyKey("");
            setDialog(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Masaları birleştir</DialogTitle>
            <DialogDescription>
              Masa {selectedTable?.name} hesabındaki aktif kalemler hedef masanın
              açık siparişine taşınır. Kaynak hesap kapatılır.
            </DialogDescription>
          </DialogHeader>
          <form
            id="merge-table-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              mergeMutation.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="merge-destination">Hedef aktif masa</Label>
              <Select
                value={mergeDestinationTable}
                onValueChange={(value) =>
                  setMergeDestinationTable(value ?? "")
                }
              >
                <SelectTrigger
                  id="merge-destination"
                  className="h-11 w-full rounded-xl"
                  aria-label="Birleştirme hedefi"
                >
                  <SelectValue placeholder="Aktif siparişli masa seçin" />
                </SelectTrigger>
                <SelectContent>
                  {mergeCandidates.map(({ table, order }) => (
                    <SelectItem key={table.id} value={table.id}>
                      {table.name} · {order.status} ·{" "}
                      {currency.format(Number(order.total))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Yalnızca başka bir aktif siparişi bulunan masalar listelenir.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="merge-reason">Birleştirme nedeni</Label>
              <Textarea
                id="merge-reason"
                value={mergeReason}
                onChange={(event) => setMergeReason(event.target.value)}
                minLength={3}
                maxLength={255}
                aria-invalid={
                  mergeReason.length > 0 && mergeReason.trim().length < 3
                }
                aria-describedby="merge-reason-help"
                className="rounded-xl"
                placeholder="Misafirler aynı masaya geçti…"
              />
              <p
                id="merge-reason-help"
                className={cn(
                  "text-xs",
                  mergeReason.length > 0 && mergeReason.trim().length < 3
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                Denetim kaydı için en az 3 karakter · {mergeReason.length}/255
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={mergeMutation.isPending}
                onClick={() => {
                  setMergeDestinationTable("");
                  setMergeReason("");
                  setMergeIdempotencyKey("");
                  setDialog(null);
                }}
              >
                Vazgeç
              </Button>
              <Button
                type="submit"
                disabled={
                  !mergeDestinationTable ||
                  mergeReason.trim().length < 3 ||
                  mergeMutation.isPending
                }
              >
                {mergeMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Merge />
                )}
                Hesapları birleştir
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === "cancel-item"}
        onOpenChange={(open) => {
          if (!open && !cancellationMutation.isPending) {
            setCancellationItem(null);
            setCancellationReason("");
            setDialog(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kalem iptal talebi oluştur</DialogTitle>
            <DialogDescription>
              Bu işlem kalemi hemen iptal etmez. Talep yetkili yönetici onayına
              gönderilir ve yalnızca onaydan sonra siparişe uygulanır.
            </DialogDescription>
          </DialogHeader>
          <form
            id="cancel-order-item-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              cancellationMutation.mutate();
            }}
          >
            <div className="rounded-xl border bg-muted/35 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {cancellationItem?.product_name_snapshot}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {Number(cancellationItem?.quantity ?? 0)} adet ·{" "}
                    {cancellationItem?.status}
                  </p>
                </div>
                <span className="text-sm font-semibold">
                  {currency.format(Number(cancellationItem?.line_total ?? 0))}
                </span>
              </div>
            </div>
            <div
              className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-800 dark:text-amber-200"
              role="note"
            >
              Yönetici onayı beklenirken kalem mevcut durumuyla siparişte ve
              hazırlık akışında kalır.
            </div>
            <div className="space-y-2">
              <Label htmlFor="cancellation-reason">İptal nedeni</Label>
              <Textarea
                id="cancellation-reason"
                value={cancellationReason}
                onChange={(event) => setCancellationReason(event.target.value)}
                minLength={3}
                maxLength={255}
                aria-invalid={
                  cancellationReason.length > 0 &&
                  cancellationReason.trim().length < 3
                }
                aria-describedby="cancellation-reason-help"
                className="rounded-xl"
                placeholder="Yanlış ürün girildi…"
                autoFocus
              />
              <p
                id="cancellation-reason-help"
                className={cn(
                  "text-xs",
                  cancellationReason.length > 0 &&
                    cancellationReason.trim().length < 3
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                Denetim kaydı için en az 3 karakter ·{" "}
                {cancellationReason.length}/255
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
                  setDialog(null);
                }}
              >
                Vazgeç
              </Button>
              <Button
                type="submit"
                disabled={
                  !cancellationItem ||
                  cancellationReason.trim().length < 3 ||
                  cancellationMutation.isPending
                }
              >
                {cancellationMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Check />
                )}
                Yönetici onayına gönder
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "split"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hesabı tutara göre böl</DialogTitle>
            <DialogDescription>Yeni alt hesap tutarı toplam bakiyeyi aşamaz; finansal bütünlük korunur.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="split-amount">Ayrılacak tutar</Label>
            <Input
              id="split-amount"
              type="number"
              min="0.01"
              max={remaining}
              step="0.01"
              value={splitAmount}
              onChange={(event) => setSplitAmount(event.target.value)}
              className="h-14 rounded-xl text-xl font-semibold"
              placeholder="0,00"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Vazgeç</Button>
            <Button
              disabled={
                !Number(splitAmount) ||
                Number(splitAmount) >= remaining ||
                splitMutation.isPending
              }
              onClick={() => splitMutation.mutate()}
            >
              {splitMutation.isPending ? <Loader2 className="animate-spin" /> : <Split />}
              Alt hesap oluştur
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
