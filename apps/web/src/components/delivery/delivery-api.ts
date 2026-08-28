import { api } from "@/lib/api";

export type DeliveryChannel = "PHONE" | "TAKEAWAY" | "OWN_DELIVERY" | "MARKETPLACE";

export type DeliveryStatus =
  | "NEW"
  | "ACCEPTED"
  | "PREPARING"
  | "READY"
  | "DISPATCHED"
  | "DELIVERED"
  | "CANCELLED"
  | "REJECTED";

export type DeliveryOrderItem = {
  name: string;
  quantity: string;
  unit_price: string;
  line_total: string;
  note: string | null;
  modifiers: string[];
};

export type DeliveryOrder = {
  id: string;
  order_id: string;
  branch_id: string;
  channel: DeliveryChannel;
  provider: string | null;
  delivery_status: DeliveryStatus;
  /** Provider sync is reported separately from the local status on purpose. */
  sync_status: "NOT_APPLICABLE" | "PENDING" | "SYNCED" | "FAILED";
  sync_error: string | null;
  external_display_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  address_line: string | null;
  district: string | null;
  neighbourhood: string | null;
  address_note: string | null;
  customer_note: string | null;
  payment_method: string;
  payment_status: string;
  courier_name: string | null;
  promised_minutes: number | null;
  total: string;
  items: DeliveryOrderItem[];
  created_at: string;
  accepted_at: string | null;
  ready_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  rejection_reason: string | null;
};

export type DeliveryCounts = {
  new: number;
  accepted: number;
  preparing: number;
  ready: number;
  dispatched: number;
  delivered: number;
  cancelled: number;
};

export const deliveryKeys = {
  root: ["delivery"] as const,
  list: (channel: string) => ["delivery", "list", channel] as const,
  counts: () => ["delivery", "counts"] as const,
};

export const deliveryApi = {
  list: (channel: string, signal?: AbortSignal) =>
    api.get<{ items: DeliveryOrder[]; total: number }>("delivery", {
      search: channel === "all" ? {} : { channel },
      signal,
    }),
  counts: (signal?: AbortSignal) =>
    api.get<DeliveryCounts>("delivery/counts", { signal }),
  accept: (id: string, promisedMinutes: number | null) =>
    api.post<DeliveryOrder>(`delivery/${id}/accept`, {
      promised_minutes: promisedMinutes,
    }),
  reject: (id: string, reason: string) =>
    api.post<DeliveryOrder>(`delivery/${id}/reject`, { reason }),
  setStatus: (id: string, status: DeliveryStatus, reason?: string) =>
    api.post<DeliveryOrder>(`delivery/${id}/status`, { status, reason }),
};

export const CHANNEL_LABELS: Record<DeliveryChannel, string> = {
  PHONE: "Telefon",
  TAKEAWAY: "Gel-Al",
  OWN_DELIVERY: "Kendi Kurye",
  MARKETPLACE: "Platform",
};

export const STATUS_LABELS: Record<DeliveryStatus, string> = {
  NEW: "Yeni",
  ACCEPTED: "Kabul edildi",
  PREPARING: "Hazırlanıyor",
  READY: "Hazır",
  DISPATCHED: "Yolda",
  DELIVERED: "Teslim edildi",
  CANCELLED: "İptal",
  REJECTED: "Reddedildi",
};

export const PAYMENT_LABELS: Record<string, string> = {
  ONLINE: "Online ödendi",
  CASH_ON_DELIVERY: "Kapıda nakit",
  CARD_ON_DELIVERY: "Kapıda kart",
  MEAL_CARD: "Yemek kartı",
  OTHER: "Diğer",
};

/** Minutes since the order arrived — the number staff actually watch. */
export function elapsedMinutes(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

/**
 * Urgency band for the elapsed timer.
 *
 * Three bands only, and "late" is reserved for genuinely late: colouring every
 * card red teaches staff to ignore the colour.
 */
export function urgency(minutes: number): "normal" | "warning" | "late" {
  if (minutes >= 25) return "late";
  if (minutes >= 12) return "warning";
  return "normal";
}
