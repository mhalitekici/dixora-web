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
  ClipboardCheck,
  Copy,
  CreditCard,
  DoorClosed,
  Grid2X2,
  Loader2,
  Merge,
  MonitorDot,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Printer,
  QrCode,
  ReceiptText,
  Search,
  Split,
  Tags,
  Volume2,
  VolumeX,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  useApproveQrRequest,
  useQrRequests,
  useRejectQrRequest,
} from "@/components/qr/qr-hooks";
import type { QrRequestDto } from "@/components/qr/types";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  dwellMinutes,
  dwellUrgency,
  formatDwell,
} from "@/components/cashier/table-dwell";
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
import { useGuestLabel } from "@/components/tables/use-guest-label";
import { formatDateTime, formatRelativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

import {
  canCloseTableSession,
  selectCurrentTableOrder,
  terminalOrderStatuses,
} from "./cashier-rules";
import { useAlertChime } from "./use-alert-chime";

type Area = { id: string; name: string };
type DiningTable = {
  id: string;
  area_id: string;
  name: string;
  guest_label?: string | null;
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
type OrderItemModifier = {
  id: string;
  name_snapshot: string;
  price_delta_snapshot: string | number;
  quantity: number;
};
type OrderItem = {
  id: string;
  product_name_snapshot: string;
  unit_price: string | number;
  quantity: string | number;
  line_total: string | number;
  status: string;
  note?: string | null;
  modifiers?: OrderItemModifier[];
};
type Payment = {
  id: string;
  method: string;
  amount: string | number;
  status: string;
  reference?: string | null;
};
type HotelRoomSummary = {
  id: string;
  room_number: string;
  status: "VACANT" | "OCCUPIED";
  guest_name: string | null;
  folio_reference: string | null;
};
const dwellTone: Record<ReturnType<typeof dwellUrgency>, string> = {
  fresh: "bg-muted text-muted-foreground",
  settled: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  long: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

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
  created_at?: string;
};
type ApprovalRequest = {
  id: string;
  order_id: string;
  order_item_id: string | null;
  status: string;
};
type ApprovalSummary = {
  id: string;
  order_id: string | null;
  approval_type: "DISCOUNT" | "ITEM_CANCELLATION" | "ORDER_VOID" | "STOCK_OVERRIDE" | "TABLE_TRANSFER";
  status: string;
  reason: string;
  created_at: string;
  table_name: string | null;
  order_item_name: string | null;
  requested_by_name: string | null;
};
type PrintJobSummary = {
  id: string;
  kind: "ORIGINAL" | "COPY" | "REPRINT";
  payload: Record<string, unknown>;
  created_at: string;
};
type CashierShiftSummary = {
  id: string;
  status: string;
  cashier_name?: string | null;
  opening_cash: string | number;
  cash_sales: string | number;
  card_sales: string | number;
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

class ApiCallError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Nakit",
  CARD: "Kart",
  ROOM_CHARGE: "Oda",
};

const CLOSE_TABLE_ERROR_MESSAGES: Record<string, string> = {
  table_has_open_orders: "Masayı kapatmadan önce açık siparişleri ödeyin veya iptal edin.",
  table_has_unsettled_balance: "Masada tahsil edilmemiş veya iade edilmemiş bir bakiye var. Lütfen ödemeleri kontrol edin.",
  table_version_conflict: "Masa bilgisi güncellendi, lütfen tekrar deneyin.",
  table_session_conflict: "Masada birden fazla açık oturum var, önce bunları çözün.",
  table_disabled: "Devre dışı masalar kapatılamaz.",
  table_session_not_open: "Bu oturum zaten kapatılmış.",
};


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
        error?: { message?: string; code?: string };
      }
    | null;
  if (!response.ok) {
    const error = payload as {
      detail?: string;
      message?: string;
      error?: { message?: string; code?: string };
    } | null;
    const code = error?.error?.code;
    throw new ApiCallError(
      (code && CLOSE_TABLE_ERROR_MESSAGES[code]) ??
        error?.error?.message ??
        error?.detail ??
        error?.message ??
        "İşlem tamamlanamadı.",
      code,
    );
  }
  return payload as T;
}

// Cafe-friendly table states: kitchen prep/ready states are collapsed into
// a single "Dolu" state so the cashier isn't shown a kitchen timeline.
// Each state gets a distinct, high-contrast card treatment (not just a
// border tint) so open vs. empty tables are legible at a glance.
type TableStateMeta = {
  label: string;
  tone: Parameters<typeof StatusBadge>[0]["tone"];
  card: string;
  badge: string;
  dot: string;
  pulse?: boolean;
};
const tableState: Record<string, TableStateMeta> = {
  AVAILABLE: {
    label: "Boş",
    tone: "success",
    card: "border-emerald-300/70 bg-emerald-50 hover:border-emerald-400 dark:border-emerald-500/25 dark:bg-emerald-500/10",
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  OCCUPIED: {
    label: "Dolu",
    tone: "info",
    card: "border-blue-300/70 bg-blue-50 hover:border-blue-400 dark:border-blue-500/25 dark:bg-blue-500/10",
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  ORDER_PENDING: {
    label: "Dolu",
    tone: "info",
    card: "border-blue-300/70 bg-blue-50 hover:border-blue-400 dark:border-blue-500/25 dark:bg-blue-500/10",
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  PREPARING: {
    label: "Hazırlanıyor",
    tone: "warning",
    card: "border-amber-300/70 bg-amber-50 hover:border-amber-400 dark:border-amber-500/25 dark:bg-amber-500/10",
    badge: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200",
    dot: "bg-amber-500",
  },
  READY: {
    label: "Hazır",
    tone: "success",
    card: "border-teal-400 bg-teal-50 hover:border-teal-500 dark:border-teal-500/35 dark:bg-teal-500/12",
    badge: "bg-teal-100 text-teal-900 dark:bg-teal-500/25 dark:text-teal-200",
    dot: "bg-teal-500",
    // Food is sitting on the pass; this is the one that needs a person.
    pulse: true,
  },
  BILL_REQUESTED: {
    label: "Hesap İstendi",
    tone: "purple",
    card: "border-violet-400 bg-violet-100 hover:border-violet-500 dark:border-violet-500/40 dark:bg-violet-500/15",
    badge: "bg-violet-200 text-violet-900 dark:bg-violet-500/25 dark:text-violet-200",
    dot: "bg-violet-500",
    pulse: true,
  },
  PAYMENT_PENDING: {
    label: "Ödeme Bekliyor",
    tone: "warning",
    card: "border-amber-400 bg-amber-100 hover:border-amber-500 dark:border-amber-500/40 dark:bg-amber-500/15",
    badge: "bg-amber-200 text-amber-900 dark:bg-amber-500/25 dark:text-amber-200",
    dot: "bg-amber-500",
    pulse: true,
  },
  CLEANING: {
    label: "Temizleniyor",
    tone: "neutral",
    card: "border-slate-300 bg-slate-100 dark:border-slate-500/25 dark:bg-slate-500/10",
    badge: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
    dot: "bg-slate-400",
  },
  DISABLED: {
    label: "Kapalı",
    tone: "neutral",
    card: "border-border bg-muted/40 opacity-70",
    badge: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/40",
  },
};
// Cafe-friendly order status: hides the kitchen (PREPARING/READY/SERVED)
// timeline and shows only the operational state the cashier acts on.
const orderStatusLabel: Record<string, string> = {
  DRAFT: "Açık",
  SUBMITTED: "Açık",
  AWAITING_APPROVAL: "Açık",
  ACCEPTED: "Açık",
  PREPARING: "Açık",
  PARTIALLY_READY: "Açık",
  READY: "Açık",
  SERVED: "Açık",
  BILL_REQUESTED: "Hesap İstendi",
  PAYMENT_PENDING: "Ödeme Bekliyor",
  PAID: "Ödendi",
  CANCELLED: "İptal",
  VOIDED: "İptal",
};

function simplifiedOrderStatus(status: string): string {
  return orderStatusLabel[status] ?? status;
}

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
  const { labelProps, dialog: guestLabelDialog } = useGuestLabel([["cashier", "tables"]]);
  const [statusFilter, setStatusFilter] =
    useState<"all" | "free" | "busy" | "bill">("all");
  const [selectedArea, setSelectedArea] = useState("all");
  const [selectedTableId, setSelectedTableId] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  // Drives the dwell timers. Ticking locally keeps them moving without
  // refetching every table once a minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const [dialog, setDialog] = useState<
    | "products"
    | "payment"
    | "discount"
    | "transfer"
    | "merge"
    | "split"
    | "cancel-item"
    | "close-table"
    | "qr-queue"
    | "approvals-queue"
    | null
  >(null);
  const [productSearch, setProductSearch] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [roomReference, setRoomReference] = useState("");
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
  const shiftQuery = useQuery({
    queryKey: ["shifts", "current"],
    queryFn: async () => api<CashierShiftSummary | null>("/shifts/current"),
    refetchInterval: 30_000,
  });
  const hotelRoomsQuery = useQuery({
    queryKey: ["cashier", "hotel-rooms"],
    queryFn: async () => api<HotelRoomSummary[]>("/hotel-rooms"),
    staleTime: 30_000,
  });
  const occupiedRoomReferences = (hotelRoomsQuery.data ?? [])
    .filter((room) => room.status === "OCCUPIED" && room.folio_reference)
    .map((room) => room.folio_reference as string);
  const qrRequestsQuery = useQrRequests("PENDING");
  const approveQrRequest = useApproveQrRequest();
  const rejectQrRequest = useRejectQrRequest();
  const approvalsQuery = useQuery({
    queryKey: ["cashier", "approval-requests", "PENDING"],
    queryFn: async () =>
      unwrap<ApprovalSummary>(
        await api<unknown>("/orders/approval-requests?status=PENDING"),
      ),
    refetchInterval: 10_000,
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

  const qrPendingRequests = useMemo(() => qrRequestsQuery.data ?? [], [qrRequestsQuery.data]);
  const qrPendingTableIds = useMemo(
    () => new Set(qrPendingRequests.map((request) => request.table_id)),
    [qrPendingRequests],
  );

  const {
    alerting: qrAlerting,
    acknowledge: acknowledgeQrAlert,
    soundEnabled: alertSoundEnabled,
    setSoundPreference: setAlertSoundEnabled,
  } = useAlertChime(qrPendingRequests.length, !qrRequestsQuery.isLoading);
  const billRequestedCount = orders.filter((order) => order.status === "BILL_REQUESTED").length;
  // The two numbers a cashier is asked for all evening: how much is still on
  // the floor, and how long the oldest table has been sitting.
  const outstandingTotal = orders.reduce((sum, order) => {
    const collected = order.payments
      .filter((payment) => payment.status === "COMPLETED")
      .reduce((paid, payment) => paid + Number(payment.amount), 0);
    return sum + Math.max(0, Number(order.total) - collected);
  }, 0);
  const longestDwell = orders.reduce((longest, order) => {
    const minutes = dwellMinutes(order.created_at, now);
    return minutes !== null && minutes > longest ? minutes : longest;
  }, 0);
  const pendingApprovals = approvalsQuery.data ?? [];

  // Counts drive the status chips, so the till can jump straight to the tables
  // that need something rather than scrolling a 29-table list.
  const statusCounts = useMemo(() => {
    const inArea = tables.filter(
      (table) => selectedArea === "all" || table.area_id === selectedArea,
    );
    return {
      all: inArea.length,
      free: inArea.filter((table) => table.state === "AVAILABLE").length,
      busy: inArea.filter(
        (table) => !["AVAILABLE", "DISABLED", "BILL_REQUESTED"].includes(table.state),
      ).length,
      bill: inArea.filter((table) => table.state === "BILL_REQUESTED").length,
    };
  }, [tables, selectedArea]);

  const filteredTables = useMemo(
    () =>
      tables
        .filter((table) => {
          const areaMatch = selectedArea === "all" || table.area_id === selectedArea;
          const needle = tableSearch.toLocaleLowerCase("tr-TR");
          // Searching the guest label lets staff find a party by name.
          const searchMatch =
            table.name.toLocaleLowerCase("tr-TR").includes(needle) ||
            (table.guest_label ?? "").toLocaleLowerCase("tr-TR").includes(needle);
          const statusMatch =
            statusFilter === "all"
              ? true
              : statusFilter === "free"
                ? table.state === "AVAILABLE"
                : statusFilter === "bill"
                  ? table.state === "BILL_REQUESTED"
                  : !["AVAILABLE", "DISABLED", "BILL_REQUESTED"].includes(table.state);
          return areaMatch && searchMatch && statusMatch;
        })
        .sort((a, b) => {
          const priority = (table: DiningTable) =>
            table.state === "BILL_REQUESTED" ? 0 : qrPendingTableIds.has(table.id) ? 1 : 2;
          return priority(a) - priority(b);
        }),
    [selectedArea, tableSearch, tables, qrPendingTableIds, statusFilter],
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
      if (paymentMethod === "ROOM_CHARGE" && !roomReference.trim()) {
        throw new Error("Oda numarası veya adı girin.");
      }
      return api(`/orders/${selectedOrder.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          method: paymentMethod,
          amount: paymentAmount,
          idempotency_key: crypto.randomUUID(),
          reference: paymentMethod === "ROOM_CHARGE" ? roomReference.trim() : null,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Ödeme kaydedildi", {
        description: `${currency.format(Number(paymentAmount))} · ${paymentMethod}`,
      });
      setDialog(null);
      setRoomReference("");
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

  const approveCancellationMutation = useMutation({
    mutationFn: async (approval: ApprovalSummary) =>
      api(`/orders/cancellation-requests/${approval.id}/approve`, { method: "POST" }),
    onSuccess: () => {
      toast.success("İptal talebi onaylandı");
      refreshOperations();
      void approvalsQuery.refetch();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Talep onaylanamadı."),
  });

  const rejectCancellationMutation = useMutation({
    mutationFn: async (approval: ApprovalSummary) =>
      api(`/orders/cancellation-requests/${approval.id}/reject`, { method: "POST" }),
    onSuccess: () => {
      toast.success("İptal talebi reddedildi");
      refreshOperations();
      void approvalsQuery.refetch();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Talep reddedilemedi."),
  });

  async function handleApproveQr(request: QrRequestDto) {
    try {
      await approveQrRequest.mutateAsync(request.id);
      toast.success("QR siparişi onaylandı ve siparişe aktarıldı");
      refreshOperations();
    } catch (error) {
      toast.error("QR siparişi onaylanamadı", {
        description: error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
      });
    }
  }

  async function handleRejectQr(request: QrRequestDto) {
    try {
      await rejectQrRequest.mutateAsync(request.id);
      toast.success("QR siparişi reddedildi");
      refreshOperations();
    } catch (error) {
      toast.error("QR siparişi reddedilemedi", {
        description: error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
      });
    }
  }

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

  const printJobsQuery = useQuery({
    queryKey: ["cashier", "print-jobs", selectedOrder?.id],
    queryFn: async () =>
      unwrap<PrintJobSummary>(
        await api<unknown>(`/printing/jobs?order_id=${selectedOrder?.id}`),
      ),
    enabled: Boolean(selectedOrder?.id),
  });
  const billPrintJobs = (printJobsQuery.data ?? []).filter(
    (job) => (job.payload as { type?: string })?.type === "BILL",
  );
  const hasOriginalBillPrint = billPrintJobs.some((job) => job.kind !== "REPRINT");

  const printMutation = useMutation({
    mutationFn: async (kind: "ORIGINAL" | "REPRINT") => {
      if (!selectedOrder) throw new Error("Canlı sipariş verisi bulunamadı.");
      return api("/printing/jobs", {
        method: "POST",
        body: JSON.stringify({
          order_id: selectedOrder.id,
          payload: {
            type: "BILL",
            order_id: selectedOrder.id,
            table_name: selectedTable?.name,
            copy: kind === "REPRINT",
            stage: selectedOrder.status === "PAID" ? "CLOSING" : "PRE_PAYMENT",
          },
          kind,
          idempotency_key:
            kind === "ORIGINAL"
              ? `bill-original:${selectedOrder.id}`
              : `bill-reprint:${selectedOrder.id}:${crypto.randomUUID()}`,
        }),
      });
    },
    onSuccess: (_, kind) => {
      toast.success(
        kind === "ORIGINAL" ? "Hesap fişi yazdırılıyor" : "Yeniden baskı kuyruğa alındı",
        {
          description:
            kind === "ORIGINAL"
              ? "Fiş ilk kez ORIGINAL olarak basılıyor."
              : "Fiş REPRINT olarak denetim kaydına yazıldı.",
        },
      );
      void printJobsQuery.refetch();
    },
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
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col bg-muted/25">
      {guestLabelDialog}
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2.5">
        <div className="flex items-center gap-3 rounded-xl border bg-muted/40 px-3 py-1.5">
          <span className="flex flex-col leading-tight">
            <span className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Açık hesap
            </span>
            <span className="text-sm font-bold tabular-nums">{orders.length}</span>
          </span>
          <span className="h-7 w-px bg-border" aria-hidden="true" />
          <span className="flex flex-col leading-tight">
            <span className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Tahsil edilecek
            </span>
            <span className="text-sm font-bold tabular-nums">
              {currency.format(outstandingTotal)}
            </span>
          </span>
          {longestDwell > 0 ? (
            <>
              <span className="h-7 w-px bg-border" aria-hidden="true" />
              <span className="flex flex-col leading-tight">
                <span className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  En uzun masa
                </span>
                <span
                  className={cn(
                    "text-sm font-bold tabular-nums",
                    dwellUrgency(longestDwell) === "long" &&
                      "text-rose-600 dark:text-rose-400",
                  )}
                >
                  {formatDwell(longestDwell)}
                </span>
              </span>
            </>
          ) : null}
        </div>
        {shiftQuery.data ? (
          <Link
            href="/cashier/shift"
            className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
            title="Vardiya özetini görüntüle, kapat veya devret"
          >
            <MonitorDot className="size-3.5" />
            {shiftQuery.data.cashier_name || "Vardiya Açık"}
            <span className="hidden text-[0.68rem] font-normal opacity-80 sm:inline">
              Açılış {currency.format(Number(shiftQuery.data.opening_cash))}
            </span>
          </Link>
        ) : null}
        <button
          type="button"
          onClick={() => {
            const table = tables.find((item) => item.state === "BILL_REQUESTED");
            if (table) setSelectedTableId(table.id);
          }}
          disabled={billRequestedCount === 0}
          className={cn(
            "flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors",
            billRequestedCount > 0
              ? "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300"
              : "border-border bg-muted/50 text-muted-foreground",
          )}
          title="Hesap isteyen masalar sol listede önceliklidir"
        >
          <ReceiptText className="size-3.5" />
          Hesap İstekleri
          <span className="rounded-full bg-current/15 px-1.5 tabular-nums">{billRequestedCount}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            acknowledgeQrAlert();
            setDialog("qr-queue");
          }}
          className={cn(
            "flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors",
            qrPendingRequests.length > 0
              ? "border-brand/30 bg-brand-soft text-brand"
              : "border-border bg-muted/50 text-muted-foreground",
          )}
        >
          <QrCode className="size-3.5" />
          QR Siparişleri
          <span className="rounded-full bg-current/15 px-1.5 tabular-nums">{qrPendingRequests.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setDialog("approvals-queue")}
          className={cn(
            "flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors",
            pendingApprovals.length > 0
              ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : "border-border bg-muted/50 text-muted-foreground",
          )}
        >
          <ClipboardCheck className="size-3.5" />
          Onay Bekleyenler
          <span className="rounded-full bg-current/15 px-1.5 tabular-nums">{pendingApprovals.length}</span>
        </button>
      </div>
      {qrAlerting ? (
        <div
          role="alert"
          aria-live="assertive"
          className="flex flex-wrap items-center gap-3 border-b border-brand/30 bg-brand-soft px-4 py-3 text-sm"
        >
          <span className="relative flex size-2.5 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand/60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2.5 rounded-full bg-brand" />
          </span>
          <span className="font-semibold text-brand">
            {qrPendingRequests.length} yeni QR sipariş talebi bekliyor
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAlertSoundEnabled(!alertSoundEnabled)}
              aria-pressed={alertSoundEnabled}
              title={alertSoundEnabled ? "Sesi kapat" : "Sesi aç"}
            >
              {alertSoundEnabled ? (
                <Volume2 className="size-4" />
              ) : (
                <VolumeX className="size-4" />
              )}
              <span className="sr-only">
                {alertSoundEnabled ? "Uyarı sesini kapat" : "Uyarı sesini aç"}
              </span>
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={acknowledgeQrAlert}>
              Sesi durdur
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                acknowledgeQrAlert();
                setDialog("qr-queue");
              }}
            >
              Kuyruğu aç
            </Button>
          </div>
        </div>
      ) : null}
      <div className="grid flex-1 xl:grid-cols-[280px_minmax(0,1fr)_350px]">
      <aside className="border-r bg-muted/30 xl:min-h-[calc(100dvh-4rem)]">
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
        <div className="flex flex-wrap gap-1.5 border-b px-2 py-2">
          {(
            [
              ["all", "Tümü", statusCounts.all, "bg-foreground"],
              ["free", "Boş", statusCounts.free, "bg-emerald-500"],
              ["busy", "Dolu", statusCounts.busy, "bg-blue-500"],
              ["bill", "Hesap", statusCounts.bill, "bg-violet-500"],
            ] as const
          ).map(([value, label, count, dot]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value)}
              className={cn(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[0.66rem] font-semibold transition-colors",
                statusFilter === value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-transparent bg-muted/70 text-muted-foreground hover:bg-muted",
              )}
            >
              <span className={cn("size-1.5 rounded-full", dot)} />
              {label}
              <span className="tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>
        <ScrollArea className="h-[320px] xl:h-[calc(100dvh-15.4rem)]">
          <div className="grid grid-cols-2 gap-2.5 p-3 xl:grid-cols-1">
            {filteredTables.map((table) => {
              const meta = tableState[table.state] ?? tableState.AVAILABLE;
              const order = selectCurrentTableOrder(orders, table);
              const hasQrRequest = qrPendingTableIds.has(table.id);
              const dwell = order ? dwellMinutes(order.created_at, now) : null;
              return (
                <button
                  type="button"
                  key={table.id}
                  onClick={() => setSelectedTableId(table.id)}
                  {...labelProps(table)}
                  title="Sağ tık: misafir adı ekle"
                  className={cn(
                    "relative flex min-h-16 items-center gap-2.5 overflow-hidden rounded-2xl border-2 p-2.5 text-left shadow-sm transition-all hover:shadow-md active:scale-[0.99]",
                    meta.card,
                    selectedTableId === table.id &&
                      "border-primary shadow-md ring-2 ring-primary/25",
                  )}
                >
                  {hasQrRequest ? (
                    <span
                      className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-sm"
                      title="QR sipariş talebi var"
                    >
                      <QrCode className="size-3" />
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-lg text-base font-bold",
                      meta.badge,
                    )}
                  >
                    {table.name}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={cn("relative flex size-1.5 shrink-0 rounded-full", meta.dot)}>
                        {meta.pulse ? (
                          <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", meta.dot)} />
                        ) : null}
                      </span>
                      <span className="text-xs font-bold uppercase tracking-wide">{meta.label}</span>
                    </span>
                    {table.guest_label ? (
                      <span className="mt-0.5 block truncate text-[0.7rem] font-semibold text-foreground">
                        {table.guest_label}
                      </span>
                    ) : null}
                    <span className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="truncate text-[0.72rem] font-bold tabular-nums text-foreground">
                        {order ? currency.format(Number(order.total)) : `${table.capacity} kişilik`}
                      </span>
                      {dwell !== null ? (
                        <span
                          className={cn(
                            "shrink-0 rounded px-1 text-[0.62rem] font-semibold tabular-nums",
                            dwellTone[dwellUrgency(dwell)],
                          )}
                        >
                          {formatDwell(dwell)}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <ChevronRight className="hidden size-4 text-muted-foreground xl:block" />
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </aside>

      <section className="min-w-0 border-r bg-muted/15">
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
                  {simplifiedOrderStatus(selectedOrder.status)}
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
                  <article key={item.id} className="flex items-start gap-3 rounded-2xl border bg-card p-3 shadow-sm">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-xs font-bold">
                      {Number(item.quantity)}×
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{item.product_name_snapshot}</p>
                      {terminalItemStatuses.has(item.status) ? (
                        <StatusBadge tone="danger" dot={false} className="mt-1 h-5 px-1.5 text-[0.56rem]">
                          İptal
                        </StatusBadge>
                      ) : null}
                      {item.modifiers?.length ? (
                        <ul className="mt-1.5 space-y-0.5">
                          {item.modifiers.map((modifier) => (
                            <li
                              key={modifier.id}
                              className="flex items-baseline gap-1.5 text-[0.7rem] leading-4 text-muted-foreground"
                            >
                              <Plus className="size-3 shrink-0 text-brand" aria-hidden="true" />
                              <span className="min-w-0 flex-1">
                                {modifier.quantity > 1 ? `${modifier.quantity}× ` : ""}
                                {modifier.name_snapshot}
                              </span>
                              {Number(modifier.price_delta_snapshot) !== 0 ? (
                                <span className="shrink-0 tabular-nums">
                                  {Number(modifier.price_delta_snapshot) > 0 ? "+" : ""}
                                  {currency.format(Number(modifier.price_delta_snapshot))}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {item.note ? (
                        // The customer's own words: shown in full, because a
                        // truncated "az acılı" is worse than no note at all.
                        <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-[0.7rem] leading-4 text-amber-800 dark:text-amber-200">
                          <MessageSquare className="mt-px size-3 shrink-0" aria-hidden="true" />
                          <span className="min-w-0 whitespace-pre-wrap break-words">{item.note}</span>
                        </p>
                      ) : null}
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

        <footer className="grid grid-cols-2 gap-2 border-t bg-card p-3 sm:grid-cols-3 lg:grid-cols-5">
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
          <Button
            variant="outline"
            className="h-10 rounded-xl"
            disabled={!selectedOrder || printMutation.isPending}
            onClick={() => printMutation.mutate("ORIGINAL")}
            title="Hesap fişini ilk kez yazdır"
          >
            {printMutation.isPending && printMutation.variables === "ORIGINAL" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Printer />
            )}
            Fiş yazdır
          </Button>
          <Button
            variant="outline"
            className="h-10 rounded-xl"
            disabled={!selectedOrder || printMutation.isPending || !hasOriginalBillPrint}
            onClick={() => printMutation.mutate("REPRINT")}
            title={
              hasOriginalBillPrint
                ? "Fişi REPRINT olarak yeniden yazdır"
                : "Önce hesap fişini bir kez yazdırın"
            }
          >
            {printMutation.isPending && printMutation.variables === "REPRINT" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Copy />
            )}
            Yeniden yazdır
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
          <div className="rounded-2xl bg-muted/45 p-4 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Toplam
              </span>
              <span className="text-3xl font-bold tabular-nums tracking-tight">
                {currency.format(Number(selectedOrder?.total ?? 0))}
              </span>
            </div>
            <div className="mt-3 space-y-1 border-t pt-3 text-[0.72rem]">
              <div className="flex justify-between text-muted-foreground">
                <span>Ara toplam</span>
                <span className="tabular-nums">{currency.format(Number(selectedOrder?.subtotal ?? 0))}</span>
              </div>
              {Number(selectedOrder?.discount_total ?? 0) > 0 ? (
                <div className="flex justify-between text-emerald-700 dark:text-emerald-300">
                  <span>İndirimler</span>
                  <span className="tabular-nums">−{currency.format(Number(selectedOrder?.discount_total ?? 0))}</span>
                </div>
              ) : null}
              {Number(selectedOrder?.tax_total ?? 0) > 0 ? (
                <div className="flex justify-between text-muted-foreground">
                  <span>Vergi</span>
                  <span className="tabular-nums">{currency.format(Number(selectedOrder?.tax_total ?? 0))}</span>
                </div>
              ) : null}
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
              setRoomReference("");
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
                      {payment.method === "CASH" ? (
                        <Banknote className="size-4" />
                      ) : payment.method === "ROOM_CHARGE" ? (
                        <ReceiptText className="size-4" />
                      ) : (
                        <CreditCard className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 text-xs font-semibold">
                      {PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}
                      {payment.reference ? (
                        <span className="ml-1 font-normal text-muted-foreground">· {payment.reference}</span>
                      ) : null}
                    </span>
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
      </div>

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
              <span className="font-semibold">
                {selectedOrder ? simplifiedOrderStatus(selectedOrder.status) : "—"}
              </span>
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
            {paymentMethod === "ROOM_CHARGE" ? (
              <div className="space-y-2">
                <Label htmlFor="payment-room-reference">Oda numarası / adı</Label>
                <Input
                  id="payment-room-reference"
                  value={roomReference}
                  onChange={(event) => setRoomReference(event.target.value)}
                  placeholder="Örn. 214 veya Ahmet Yılmaz"
                  className="h-11 rounded-xl"
                  list="occupied-room-references"
                  autoFocus
                />
                <datalist id="occupied-room-references">
                  {occupiedRoomReferences.map((reference) => (
                    <option key={reference} value={reference} />
                  ))}
                </datalist>
                {occupiedRoomReferences.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Şu an dolu odalar: {occupiedRoomReferences.join(", ")}
                  </p>
                ) : null}
              </div>
            ) : null}
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
                (paymentMethod === "ROOM_CHARGE" && !roomReference.trim()) ||
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
                      {table.name} · {simplifiedOrderStatus(order.status)} ·{" "}
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

      <Dialog open={dialog === "qr-queue"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>QR sipariş talepleri</DialogTitle>
            <DialogDescription>
              Onaylanan talepler doğrudan siparişe dönüşür ve masa hesabına eklenir.
            </DialogDescription>
          </DialogHeader>
          {qrRequestsQuery.isLoading ? (
            <div className="flex min-h-32 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : qrRequestsQuery.isError ? (
            <div className="flex min-h-32 flex-col items-center justify-center text-center">
              <AlertTriangle className="size-7 text-destructive" />
              <p className="mt-3 text-sm font-semibold">QR talepleri alınamadı</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void qrRequestsQuery.refetch()}
              >
                Tekrar dene
              </Button>
            </div>
          ) : qrPendingRequests.length === 0 ? (
            <div className="flex min-h-32 flex-col items-center justify-center text-center">
              <QrCode className="size-7 text-muted-foreground/50" />
              <p className="mt-3 text-sm font-semibold">Bekleyen QR talebi yok</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Yeni müşteri talepleri geldiğinde burada görünür.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {qrPendingRequests.map((request) => {
                const table = tables.find((item) => item.id === request.table_id);
                const itemCount = request.items_payload.reduce((total, item) => {
                  const quantity = Number((item as { quantity?: unknown }).quantity);
                  return total + (Number.isFinite(quantity) ? quantity : 0);
                }, 0);
                const approving =
                  approveQrRequest.isPending && approveQrRequest.variables === request.id;
                const rejecting =
                  rejectQrRequest.isPending && rejectQrRequest.variables === request.id;
                return (
                  <article key={request.id} className="rounded-xl border bg-card p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold">{table?.name ?? "Masa"}</p>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(request.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {itemCount} ürün · {formatDateTime(request.created_at)}
                    </p>
                    {request.customer_note ? (
                      <p className="mt-2 rounded-lg border border-amber-500/15 bg-amber-500/5 p-2 text-xs italic text-amber-900 dark:text-amber-200">
                        “{request.customer_note}”
                      </p>
                    ) : null}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={approving || rejecting}
                        onClick={() => void handleRejectQr(request)}
                      >
                        {rejecting ? <Loader2 className="animate-spin" /> : <X />}
                        Reddet
                      </Button>
                      <Button
                        size="sm"
                        disabled={approving || rejecting}
                        onClick={() => void handleApproveQr(request)}
                      >
                        {approving ? <Loader2 className="animate-spin" /> : <Check />}
                        Onayla
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "approvals-queue"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Onay bekleyenler</DialogTitle>
            <DialogDescription>
              Ürün iptal taleplerini burada onaylayabilirsiniz. İndirim talepleri yönetici
              onayı gerektirir.
            </DialogDescription>
          </DialogHeader>
          {approvalsQuery.isLoading ? (
            <div className="flex min-h-32 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : approvalsQuery.isError ? (
            <div className="flex min-h-32 flex-col items-center justify-center text-center">
              <AlertTriangle className="size-7 text-destructive" />
              <p className="mt-3 text-sm font-semibold">Onay talepleri alınamadı</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void approvalsQuery.refetch()}
              >
                Tekrar dene
              </Button>
            </div>
          ) : pendingApprovals.length === 0 ? (
            <div className="flex min-h-32 flex-col items-center justify-center text-center">
              <ClipboardCheck className="size-7 text-muted-foreground/50" />
              <p className="mt-3 text-sm font-semibold">Bekleyen talep yok</p>
            </div>
          ) : (
            <div className="space-y-2">
              {pendingApprovals.map((approval) => {
                const isCancellation =
                  approval.approval_type === "ITEM_CANCELLATION" ||
                  approval.approval_type === "ORDER_VOID";
                const approving =
                  approveCancellationMutation.isPending &&
                  approveCancellationMutation.variables?.id === approval.id;
                const rejecting =
                  rejectCancellationMutation.isPending &&
                  rejectCancellationMutation.variables?.id === approval.id;
                return (
                  <article key={approval.id} className="rounded-xl border bg-card p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold">{approval.table_name ?? "Masa bilinmiyor"}</p>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(approval.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {approval.approval_type === "DISCOUNT"
                        ? "İndirim talebi"
                        : approval.order_item_name
                          ? `İptal talebi · ${approval.order_item_name}`
                          : "Sipariş iptal talebi"}
                    </p>
                    <p className="mt-2 text-xs italic text-muted-foreground">“{approval.reason}”</p>
                    {isCancellation ? (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={approving || rejecting}
                          onClick={() => rejectCancellationMutation.mutate(approval)}
                        >
                          {rejecting ? <Loader2 className="animate-spin" /> : <X />}
                          Reddet
                        </Button>
                        <Button
                          size="sm"
                          disabled={approving || rejecting}
                          onClick={() => approveCancellationMutation.mutate(approval)}
                        >
                          {approving ? <Loader2 className="animate-spin" /> : <Check />}
                          Onayla
                        </Button>
                      </div>
                    ) : (
                      <p className="mt-3 rounded-lg bg-muted/50 px-2.5 py-1.5 text-[0.68rem] font-medium text-muted-foreground">
                        Yönetici onayı bekleniyor · Onaylar ekranından yönetilir
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
