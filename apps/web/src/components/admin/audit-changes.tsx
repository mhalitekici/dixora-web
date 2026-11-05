import { permissionLabels } from "./permission-labels";

const fieldLabels: Record<string, string> = {
  description: "Açıklama", category_id: "Kategori", preparation_station_id: "Hazırlık istasyonu",
  preparation_time_minutes: "Hazırlık süresi", track_inventory: "Stok takibi", is_available: "Satış durumu",
  sku: "Stok kodu", barcode: "Barkod", tax_rate: "KDV oranı", unit_price: "Birim fiyat", line_total: "Kalem toplamı",
  calories: "Kalori", allergens: "Alerjenler", tags: "Etiketler", role_id: "Rol", station_id: "İstasyon",
  permission_codes: "Yetkiler", is_system: "Sistem şablonu", created_at: "Oluşturulma zamanı",
  updated_at: "Güncellenme zamanı", opened_at: "Açılış zamanı", closed_at: "Kapanış zamanı",
  opened_by_user_id: "Vardiyayı açan", cashier_name: "Kasiyer adı", closing_note: "Kapanış notu",
  reported_card_total: "Bildirilen POS / Z toplamı", net_card_total: "Net kart tahsilatı",
  total_sales: "Toplam satış", sales_total: "Satış toplamı", minimum_stock: "Asgari stok",
  reorder_level: "Yeniden sipariş seviyesi", recipe_id: "Reçete", inventory_item_id: "Stok kalemi",
  inventory_location_id: "Stok konumu", product_id: "Ürün", table_session_id: "Masa oturumu",
  theme_mode: "Tema", logo_url: "Logo bağlantısı", cover_image_url: "Kapak görseli",
  currency: "Para birimi", archived_at: "Arşivlenme zamanı", refunded_at: "İade zamanı",
  applied: "Uygulandı",
  attempt_count: "Deneme sayısı",
  balance_after: "İşlem sonrası bakiye",
  branch_id: "Şube",
  bridge_id: "Yazdırma bilgisayarı",
  business_date: "İşletme tarihi",
  business_type: "İşletme türü",
  by: "İşlemi yapan",
  campaigns: "Kampanyalar",
  campaigns_granted: "Tanımlanan kampanyalar",
  card_difference: "POS farkı",
  cash_difference: "Kasa farkı",
  cashier_user_id: "Kasiyer",
  channel: "Sipariş kanalı",
  closed_by_user_id: "Kapatan çalışan",
  code: "Kod",
  completed: "Tamamlandı",
  consent_version: "İzin metni sürümü",
  content_type: "Dosya türü",
  contract_version: "Sözleşme sürümü",
  courier: "Kurye",
  created_by_user_id: "Oluşturan çalışan",
  default_currency: "Para birimi",
  deleted: "Kaldırıldı",
  delivery_platforms: "Paket servis platformları",
  destination_order_id: "Hedef adisyon",
  destination_table_id: "Hedef masa",
  difference: "Fark",
  discount_amount: "İndirim tutarı",
  expires_at: "Geçerlilik sonu",
  extended_days: "Eklenen gün",
  guest_label: "Misafir etiketi",
  guest_name: "Misafir adı",
  height: "Görsel yüksekliği",
  image_url: "Görsel bağlantısı",
  ingredient_count: "Malzeme sayısı",
  is_enabled: "Kullanım durumu",
  item_count: "Kalem sayısı",
  item_ids: "Etkilenen kalemler",
  items: "Kalemler",
  kind: "Baskı türü",
  locales: "Diller",
  mapping_id: "Yazıcı eşleştirmesi",
  marketing_consent: "Pazarlama izni",
  member_code: "Üyelik kodu",
  membership_code: "Üyelik kodu",
  offers_delivery: "Paket servis sunuluyor",
  opening_quantity: "Açılış miktarı",
  order_count: "Sipariş sayısı",
  order_id: "Adisyon",
  order_mode: "Sipariş modu",
  parts: "Bölümler",
  payment_method: "Ödeme yöntemi",
  payment_preference: "Ödeme tercihi",
  payment_required: "Ödeme gerekli",
  plan: "Üyelik planı",
  platform: "Platform",
  predecessor_shift_id: "Önceki vardiya",
  prevent_negative_stock: "Eksi stok engeli",
  previous_valid_until: "Önceki geçerlilik sonu",
  printer_device_id: "Dixora yazıcısı",
  privacy_notice_acknowledged: "Aydınlatma metni kabulü",
  privacy_notice_version: "Aydınlatma metni sürümü",
  program_id: "Sadakat programı",
  programs: "Programlar",
  progress: "İlerleme",
  promised_minutes: "Tahmini hazırlık süresi",
  purpose: "Yazıcı görevi",
  quantity_delta: "Miktar değişimi",
  refund_shift_id: "İadenin işlendiği vardiya",
  room_number: "Oda numarası",
  room_reference: "Oda kaydı",
  row_number: "Satır numarası",
  sessions_revoked: "Kapatılan oturumlar",
  setup: "Kurulum",
  size_bytes: "Dosya boyutu",
  slug: "Bağlantı kodu",
  sort_order: "Sıralama",
  source: "Kaynak",
  source_branch_id: "Kaynak şube",
  source_product_id: "Kaynak ürün",
  split_order_id: "Bölünen adisyon",
  state: "Durum",
  stock_copied: "Stok kopyalandı",
  table_id: "Masa",
  table_state: "Masa durumu",
  table_version: "Masa oturumu sürümü",
  target_branch_id: "Hedef şube",
  terms_accepted: "Kullanım koşulları kabulü",
  total: "Toplam",
  total_amount: "Toplam tutar",
  transfer_id: "Transfer kaydı",
  transport: "Bağlantı türü",
  trial_days: "Deneme süresi",
  trusted_device_id: "Güvenilir cihaz",
  type: "İşlem türü",
  unit: "Birim",
  username: "Kullanıcı adı",
  valid_until: "Geçerlilik sonu",
  verification_mode: "Doğrulama yöntemi",
  version: "Sürüm",
  width: "Görsel genişliği",
  zero_total_order_ids: "Sıfır tutarlı adisyonlar",
  cash_sales: "Nakit satış",
  card_sales: "Kart satış",
  cash_refunds: "Nakit iadeler",
  card_refunds: "Kart iadeleri",
  name: "Ad",
  display_name: "Çalışan adı",
  amount: "Tutar",
  method: "Ödeme yöntemi",
  status: "Durum",
  is_active: "Aktiflik",
  quantity: "Adet",
  selling_price: "Satış fiyatı",
  purchase_price: "Alış fiyatı",
  opening_cash: "Açılış nakdi",
  closing_cash: "Sayılan nakit",
  expected_cash: "Beklenen kasa",
  cash_variance: "Kasa farkı",
  card_variance: "POS farkı",
  permissions: "Yetkiler",
  role: "Rol",
  panel: "Panel",
  mode: "Çalışma modu",
  reason: "Gerekçe",
  note: "Not",
  local_printer_name: "Yerel yazıcı",
  operator_confirmed: "Operatör onayı",
  branch_ids: "Şube erişimleri",
  operational_profile: "Çalışma profili",
  result: "Sonuç",
};
const secret =
  /password|passwd|credential|authorization|cookie|secret|token|auth_session|api[_-]?key|(^|_)pin($|_)|customer|email|phone|address/i;
export function redactAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAudit);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      secret.test(key) ? "[Gizlendi]" : redactAudit(item),
    ]),
  );
}
function text(value: unknown): string {
  if (value == null) return "Kayıt yok";
  if (value === true) return "Evet";
  if (value === false) return "Hayır";
  if (Array.isArray(value)) return value.map(text).join("; ");
  if (typeof value === "object")
    return Object.entries(value)
      .filter(([key]) => !secret.test(key))
      .map(
        ([key, item]) =>
          `${fieldLabels[key] ?? key.replaceAll("_", " ")}: ${text(item)}`,
      )
      .join(" · ");
  return (
    (
      {
        CASH: "Nakit",
        CARD: "Kart",
        OPEN: "Açık",
        CLOSED: "Kapalı",
        COMPLETED: "Tamamlandı",
        REFUNDED: "İade edildi",
        PENDING: "Bekliyor",
        ACCEPTED: "Kabul edildi",
        REJECTED: "Reddedildi",
        CANCELLED: "İptal edildi",
        PREPARING: "Hazırlanıyor",
        READY: "Hazır",
        PAID: "Ödendi",
        UNPAID: "Ödenmedi",
        TAKEAWAY: "Gel-Al",
        OWN_DELIVERY: "Paket Servis",
        PHONE: "Telefon",
        WAITER: "Garson",
        CASHIER: "Kasiyer",
        MANAGEMENT: "Yönetim",
        BACKOFFICE: "Ofis",
        BUSINESS_OWNER: "İşletme sahibi",
        BUSINESS_ADMIN: "Yönetici",
        BUSINESS_MANAGER: "Müdür",
        support: "Destek",
        waiter: "Garson",
        cashier: "Kasiyer",
      } as Record<string, string>
    )[String(value)] ??
    permissionLabels[String(value)] ??
    String(value)
  );
}
export function AuditChanges({
  previous,
  next,
}: {
  previous: unknown;
  next: unknown;
}) {
  const old = (redactAudit(previous) ?? {}) as Record<string, unknown>;
  const current = (redactAudit(next) ?? {}) as Record<string, unknown>;
  const keys = [
    ...new Set([...Object.keys(old), ...Object.keys(current)]),
  ].filter(
    (key) =>
      !secret.test(key) &&
      JSON.stringify(old[key]) !== JSON.stringify(current[key]),
  );
  if (!keys.length)
    return (
      <p className="text-sm text-muted-foreground">
        Alan değişikliği kaydedilmemiş.
      </p>
    );
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="p-3">Alan</th>
            <th className="p-3">Önceki değer</th>
            <th className="p-3">Yeni değer</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key} className="border-t align-top">
              <th scope="row" className="p-3 font-medium">
                {fieldLabels[key] ?? key.replaceAll("_", " ")}
              </th>
              <td className="max-w-64 break-words p-3 text-muted-foreground">
                {text(old[key])}
              </td>
              <td className="max-w-64 break-words p-3">{text(current[key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
