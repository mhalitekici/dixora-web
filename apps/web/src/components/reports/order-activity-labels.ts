/**
 * Turkish labels for the order activity feed and the detail behind each row.
 *
 * Shared so a row and the receipt it opens can never disagree about what a
 * status or a channel is called.
 */

export const SOURCE_LABELS: Record<string, string> = {
  WAITER: "Garson",
  CASHIER: "Kasiyer",
  QR: "QR Menü",
  TAKEAWAY: "Gel-Al",
  DELIVERY: "Paket",
  KIOSK: "Kiosk",
  API: "Entegrasyon",
}

export const CHANNEL_LABELS: Record<string, string> = {
  PHONE: "Telefon",
  TAKEAWAY: "Gel-Al",
  OWN_DELIVERY: "Kendi Kurye",
  MARKETPLACE: "Platform",
}

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Taslak",
  PENDING_APPROVAL: "Onay bekliyor",
  ACCEPTED: "Kabul edildi",
  PREPARING: "Hazırlanıyor",
  PARTIALLY_READY: "Kısmen hazır",
  READY: "Hazır",
  SERVED: "Servis edildi",
  BILL_REQUESTED: "Hesap istendi",
  PAID: "Ödendi",
  CANCELLED: "İptal",
  VOIDED: "İptal",
}

export const ITEM_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Taslak",
  SUBMITTED: "Gönderildi",
  ACCEPTED: "Kabul edildi",
  PREPARING: "Hazırlanıyor",
  READY: "Hazır",
  SERVED: "Servis edildi",
  CANCELLED: "İptal",
  VOIDED: "İptal",
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Bekliyor",
  COMPLETED: "Tamamlandı",
  REFUNDED: "İade",
  VOIDED: "İptal",
}

/** Statuses where the line was struck off and must not read as sold. */
export const CANCELLED_ITEM_STATUSES = new Set(["CANCELLED", "VOIDED"])
