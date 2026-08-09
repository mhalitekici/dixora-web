/**
 * Business-facing wording for raw audit action codes.
 *
 * The database keeps the technical action string untouched for integrity and
 * forensics; this map only affects how it is *read*. Unknown codes degrade to
 * a humanised form of the raw string rather than disappearing, so a newly
 * added backend action is never invisible to the business owner.
 */
export const auditActionLabels: Record<string, string> = {
  // Authentication
  "auth.login": "Kullanıcı giriş yaptı",
  "auth.login_failed": "Başarısız giriş denemesi",
  "auth.logout": "Kullanıcı çıkış yaptı",
  "auth.pin_login": "PIN ile giriş yapıldı",
  "auth.pin_login_failed": "Başarısız PIN giriş denemesi",
  "auth.branch_switched": "Şube değiştirildi",
  "auth.trusted_device_enrolled": "Güvenilir cihaz tanımlandı",

  // Business / platform lifecycle
  "registration.created": "Yeni işletme kaydı oluşturuldu",
  "business.created": "İşletme oluşturuldu",
  "business.updated": "İşletme bilgileri güncellendi",
  "business.reactivated": "İşletme üyeliği yeniden etkinleştirildi",
  "branch.created": "Yeni şube açıldı",
  "branch.updated": "Şube bilgileri güncellendi",

  // Users
  "user.created": "Yeni çalışan eklendi",
  "user.updated": "Çalışan bilgileri güncellendi",
  "user.password_reset": "Kullanıcı şifresi sıfırlandı",
  "user.password_changed": "Kullanıcı kendi şifresini değiştirdi",
  "user.pin_changed": "Kullanıcı PIN kodu değiştirildi",

  // Catalog
  "catalog.product_created": "Yeni ürün eklendi",
  "catalog.product_updated": "Ürün güncellendi",
  "catalog.product_archived": "Ürün arşivlendi",
  "catalog.product_imported": "Ürünler toplu içe aktarıldı",
  "catalog.product_image_uploaded": "Ürün görseli yüklendi",
  "catalog.product_image_deleted": "Ürün görseli kaldırıldı",
  "catalog.category_created": "Yeni kategori eklendi",
  "catalog.category_updated": "Kategori güncellendi",
  "catalog.category_archived": "Kategori arşivlendi",
  "catalog.modifier_created": "Yeni seçenek eklendi",
  "catalog.modifier_updated": "Seçenek güncellendi",
  "catalog.modifier_archived": "Seçenek arşivlendi",
  "catalog.modifier_group_created": "Yeni seçenek grubu eklendi",
  "catalog.modifier_group_updated": "Seçenek grubu güncellendi",
  "catalog.modifier_group_archived": "Seçenek grubu arşivlendi",

  // Tables & areas
  "area.created": "Yeni alan eklendi",
  "area.updated": "Alan güncellendi",
  "area.archived": "Alan arşivlendi",
  "table.updated": "Masa güncellendi",
  "table.archived": "Masa arşivlendi",
  "table.merged": "Masalar birleştirildi",
  "table.transferred": "Masa taşındı",
  "table.cleaning_auto_released": "Temizlikte kalan masa otomatik açıldı",
  "table_session.closed": "Masa hesabı kapatıldı",

  // Orders
  "order.created": "Yeni sipariş oluşturuldu",
  "order.accepted": "Sipariş onaylandı",
  "order.items_appended": "Siparişe ürün eklendi",
  "order.bill_requested": "Hesap istendi",
  "order.item_cancelled": "Sipariş kalemi iptal edildi",
  "order.voided": "Sipariş iptal edildi",
  "payment.recorded": "Ödeme alındı",
  "check.split_by_amount": "Hesap tutara göre bölündü",
  "check.split_by_items": "Hesap ürünlere göre bölündü",

  // Approvals
  "discount.requested": "İndirim talebi oluşturuldu",
  "discount.approved": "İndirim onaylandı",
  "discount.rejected": "İndirim reddedildi",
  "cancellation.requested": "İptal talebi oluşturuldu",
  "cancellation.rejected": "İptal talebi reddedildi",

  // Kitchen
  "kitchen.ticket_status_changed": "Hazırlık durumu güncellendi",

  // Inventory
  "inventory.item_created": "Yeni stok kalemi eklendi",
  "inventory.movement_created": "Stok hareketi kaydedildi",
  "inventory.recipe_updated": "Ürün reçetesi güncellendi",

  // QR menu
  "qr.config_updated": "QR menü ayarları güncellendi",
  "qr.request_approved": "QR sipariş talebi onaylandı",
  "qr.request_rejected": "QR sipariş talebi reddedildi",
  "qr.table_token_regenerated": "Masa QR kodu yenilendi",

  // Loyalty
  "loyalty.membership_enrolled": "Yeni sadakat müşterisi kaydoldu",
  "loyalty.membership_attached": "Sadakat üyeliği siparişe bağlandı",
  "loyalty.reward_redeemed": "Sadakat ödülü kullanıldı",
  "loyalty.redemption_reversed": "Sadakat ödülü geri alındı",
  "loyalty.order_reversed": "Sadakat puanı geri alındı",
  "loyalty.verification_started": "Telefon doğrulaması başlatıldı",
  "loyalty.verification_failed": "Telefon doğrulaması başarısız",
  "loyalty.verification_replayed": "Telefon doğrulaması tekrarlandı",

  // Printing
  "printing.job_created": "Yazdırma işi oluşturuldu",
  "printing.test_job_created": "Test yazdırma işi oluşturuldu",
  "printing.device_created": "Yazıcı eklendi",
  "printing.device_updated": "Yazıcı güncellendi",
  "printing.bridge_created": "Yazıcı köprüsü tanımlandı",

  // Shifts
  "shift.opened": "Vardiya açıldı",
  "shift.handoff": "Vardiya devredildi",
  "shift.handoff_opened": "Devralan vardiya açıldı",
  "shift.closed": "Vardiya kapatıldı",

  // Hotel rooms
  "hotel_room.created": "Otel odası eklendi",
  "hotel_room.updated": "Otel odası güncellendi",
  "hotel_room.checked_in": "Odaya misafir girişi yapıldı",
  "hotel_room.checked_out": "Odadan çıkış yapıldı",
};

const resourceLabels: Record<string, string> = {
  user: "Çalışan",
  tenant: "İşletme",
  branch: "Şube",
  product: "Ürün",
  category: "Kategori",
  modifier: "Seçenek",
  modifier_group: "Seçenek grubu",
  order: "Sipariş",
  order_item: "Sipariş kalemi",
  payment: "Ödeme",
  table: "Masa",
  table_session: "Masa oturumu",
  area: "Alan",
  print_job: "Yazdırma işi",
  printer_device: "Yazıcı",
  kitchen_ticket: "Hazırlık bileti",
  inventory_item: "Stok kalemi",
  stock_movement: "Stok hareketi",
  loyalty_membership: "Sadakat üyeliği",
  loyalty_redemption: "Sadakat ödülü",
  qr_config: "QR menü ayarı",
  qr_request: "QR sipariş talebi",
  cashier_shift: "Vardiya",
  hotel_room: "Otel odası",
  approval_request: "Onay talebi",
};

/** Human sentence for an audit action, falling back to a tidied raw code. */
export function auditActionLabel(action: string): string {
  const known = auditActionLabels[action];
  if (known) return known;
  // e.g. "some.new_action" -> "Some new action"
  const humanised = action.replace(/[._]/g, " ").trim();
  return humanised.charAt(0).toLocaleUpperCase("tr-TR") + humanised.slice(1);
}

export function auditResourceLabel(resourceType: string | null | undefined): string | null {
  if (!resourceType) return null;
  return resourceLabels[resourceType] ?? resourceType.replace(/[._]/g, " ");
}

/** True when we have real business wording (vs. a generated fallback). */
export function hasFriendlyAuditLabel(action: string): boolean {
  return action in auditActionLabels;
}
