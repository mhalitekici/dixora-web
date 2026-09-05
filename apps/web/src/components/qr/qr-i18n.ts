"use client"

import { useCallback, useSyncExternalStore } from "react"

export type QrLocale = "tr" | "en" | "ru"

export const QR_LOCALES: { code: QrLocale; label: string }[] = [
  { code: "tr", label: "TR" },
  { code: "en", label: "EN" },
  { code: "ru", label: "RU" },
]

const STORAGE_KEY = "dixora:qr-menu-locale"

type QrTranslationKey =
  | "search_placeholder"
  | "all_categories"
  | "products_showing"
  | "view_mode_title"
  | "view_mode_no_table"
  | "view_mode_scan_qr"
  | "menu_unreachable_title"
  | "menu_generic_error"
  | "retry"
  | "view_cart"
  | "product_added"
  | "order_request_sent"
  | "order_request_failed"
  | "order_request_failed_desc"
  | "tagline"
  | "product_not_found"
  | "product_not_found_desc"
  | "options_count"
  | "tap_for_details"
  | "allergen_label"
  | "product_note_label"
  | "product_note_placeholder"
  | "required"
  | "optional"
  | "max_selection"
  | "min_selection_error"
  | "default_product_desc"
  | "item_count_label"
  | "decrease"
  | "increase"
  | "add_to_cart"
  | "cart_title"
  | "cart_desc_table"
  | "cart_desc_no_table"
  | "cart_empty"
  | "cart_empty_desc"
  | "order_note_label"
  | "order_note_placeholder"
  | "estimated_total"
  | "sending"
  | "send_order_request"
  | "confirm_order_title"
  | "confirm_order_desc"
  | "back_to_cart"
  | "confirm_and_send"
  | "order_disabled_note"
  | "selected_table_fallback"
  | "request_status_approved_title"
  | "request_status_rejected_title"
  | "request_status_pending_title"
  | "request_status_approved_desc"
  | "request_status_rejected_desc"
  | "request_status_pending_desc"
  | "request_number_label"
  | "request_status_footer"
  | "back_to_menu"
  | "active_check_title"
  | "active_check_desc"
  | "active_check_total"
  | "active_check_remaining"
  | "request_bill"
  | "request_bill_pending"
  | "request_bill_success"
  | "request_bill_failed"
  | "request_bill_failed_desc"
  | "bill_already_requested"
  | "bill_request_no_active_order"
  | "campaigns_title"
  | "campaign_members_only"
  | "campaign_label"

const STRINGS: Record<QrLocale, Record<QrTranslationKey, string>> = {
  tr: {
    search_placeholder: "Menüde ara",
    all_categories: "Tümü",
    products_showing: "{n} ürün gösteriliyor",
    view_mode_title: "Menü görüntüleme modu",
    view_mode_no_table: "İşletme şu anda QR üzerinden sipariş almıyor.",
    view_mode_scan_qr: "Sipariş vermek için masanızdaki QR kodunu okutun.",
    menu_unreachable_title: "Menüye ulaşılamadı",
    menu_generic_error: "Menü şu anda görüntülenemiyor.",
    retry: "Tekrar dene",
    view_cart: "Sepeti görüntüle",
    product_added: "Ürün sepete eklendi",
    order_request_sent: "Sipariş talebiniz gönderildi",
    order_request_failed: "Sipariş gönderilemedi",
    order_request_failed_desc: "Lütfen bağlantınızı kontrol edip tekrar deneyin.",
    tagline: "{business} mutfağından güncel lezzetler ve masa servisi.",
    product_not_found: "Ürün bulunamadı",
    product_not_found_desc: "Aramanızı veya kategori filtrenizi değiştirin.",
    options_count: "{n} seçenek",
    tap_for_details: "Detaylar ve seçenekler için dokunun.",
    allergen_label: "Alerjen",
    product_note_label: "Ürün notu",
    product_note_placeholder: "Örn. sos ayrı gelsin",
    required: "Zorunlu",
    optional: "İsteğe bağlı",
    max_selection: "en fazla {n}",
    min_selection_error: "{group} için en az {n} seçim yapın.",
    default_product_desc: "Ürün detaylarını seçerek sepetinize ekleyin.",
    item_count_label: "Ürün adedi",
    decrease: "Adedi azalt",
    increase: "Adedi artır",
    add_to_cart: "Sepete ekle · {amount}",
    cart_title: "Sepetiniz",
    cart_desc_table: "{table} için sipariş talebi",
    cart_desc_no_table: "Sipariş vermek için masanızdaki QR kodunu okutun.",
    cart_empty: "Sepetiniz boş",
    cart_empty_desc: "Menüden bir ürün seçerek başlayın.",
    order_note_label: "Sipariş notu",
    order_note_placeholder: "Tüm sipariş için eklemek istediğiniz not",
    estimated_total: "Tahmini toplam",
    sending: "Gönderiliyor…",
    send_order_request: "Sipariş talebini gönder",
    confirm_order_title: "Sipariş talebini onaylıyor musunuz?",
    confirm_order_desc:
      "{count} kalem ürün {table} için personele gönderilecek. Gönderimden sonra değişiklik yapılamaz.",
    back_to_cart: "Sepete dön",
    confirm_and_send: "Onayla ve gönder",
    order_disabled_note:
      "Sipariş yalnız masa QR koduyla ve işletme sipariş alımını açtığında gönderilebilir.",
    selected_table_fallback: "seçili masa",
    request_status_approved_title: "Siparişiniz alındı",
    request_status_rejected_title: "Talebiniz kabul edilmedi",
    request_status_pending_title: "Talebiniz personele ulaştı",
    request_status_approved_desc:
      "Siparişiniz otomatik olarak onaylandı ve hazırlık akışına aktarıldı.",
    request_status_rejected_desc:
      "Detaylı bilgi için servis personelinden destek isteyebilirsiniz.",
    request_status_pending_desc:
      "Servis ekibi siparişinizi kontrol ediyor. Onaylandığında hazırlık başlayacak.",
    request_number_label: "Talep numarası",
    request_status_footer:
      "Bu ekran sunucunun son onaylı durumunu gösterir. Güncel bilgi için servis personeline başvurabilirsiniz.",
    back_to_menu: "Menüye dön",
    active_check_title: "Masanızın açık hesabı",
    active_check_desc: "Siparişiniz bu masaya bağlı kaldığı sürece hesabı buradan isteyebilirsiniz.",
    active_check_total: "Toplam",
    active_check_remaining: "Kalan",
    request_bill: "Hesap iste",
    request_bill_pending: "Hesap isteniyor…",
    request_bill_success: "Hesap talebiniz kasaya iletildi",
    request_bill_failed: "Hesap talebi gönderilemedi",
    request_bill_failed_desc: "Lütfen bağlantınızı kontrol edip tekrar deneyin.",
    bill_already_requested: "Hesap talebiniz alındı. Personel ödemeniz için fişi hazırlıyor.",
    bill_request_no_active_order: "Hesap isteyebilmek için bu masada aktif bir sipariş olmalıdır.",
    campaigns_title: "Kampanyalar",
    campaign_members_only: "Üyelere özel",
    campaign_label: "Kampanya",
  },
  en: {
    search_placeholder: "Search the menu",
    all_categories: "All",
    products_showing: "{n} items shown",
    view_mode_title: "Menu display mode",
    view_mode_no_table: "This venue isn't taking QR orders right now.",
    view_mode_scan_qr: "Scan the QR code on your table to place an order.",
    menu_unreachable_title: "Menu unavailable",
    menu_generic_error: "The menu can't be shown right now.",
    retry: "Try again",
    view_cart: "View cart",
    product_added: "Item added to cart",
    order_request_sent: "Your order request was sent",
    order_request_failed: "Order couldn't be sent",
    order_request_failed_desc: "Please check your connection and try again.",
    tagline: "Fresh flavors from {business}'s kitchen, served at your table.",
    product_not_found: "No items found",
    product_not_found_desc: "Try a different search or category.",
    options_count: "{n} options",
    tap_for_details: "Tap for details and options.",
    allergen_label: "Allergens",
    product_note_label: "Item note",
    product_note_placeholder: "E.g. sauce on the side",
    required: "Required",
    optional: "Optional",
    max_selection: "up to {n}",
    min_selection_error: "Pick at least {n} for {group}.",
    default_product_desc: "Choose your options and add it to the cart.",
    item_count_label: "Quantity",
    decrease: "Decrease quantity",
    increase: "Increase quantity",
    add_to_cart: "Add to cart · {amount}",
    cart_title: "Your cart",
    cart_desc_table: "Order request for {table}",
    cart_desc_no_table: "Scan the QR code on your table to place an order.",
    cart_empty: "Your cart is empty",
    cart_empty_desc: "Pick something from the menu to get started.",
    order_note_label: "Order note",
    order_note_placeholder: "Anything you'd like to add for the whole order",
    estimated_total: "Estimated total",
    sending: "Sending…",
    send_order_request: "Send order request",
    confirm_order_title: "Confirm this order request?",
    confirm_order_desc:
      "{count} item(s) will be sent to staff for {table}. It can't be changed after sending.",
    back_to_cart: "Back to cart",
    confirm_and_send: "Confirm and send",
    order_disabled_note:
      "Orders can only be sent from a table QR code while the venue has ordering open.",
    selected_table_fallback: "the selected table",
    request_status_approved_title: "Your order was received",
    request_status_rejected_title: "Your request wasn't accepted",
    request_status_pending_title: "Your request reached staff",
    request_status_approved_desc:
      "Your order was approved automatically and sent to be prepared.",
    request_status_rejected_desc: "Ask a staff member for more details.",
    request_status_pending_desc:
      "Staff are reviewing your order. Preparation starts once it's approved.",
    request_number_label: "Request number",
    request_status_footer:
      "This screen shows the last confirmed status from the server. Ask staff for the latest update.",
    back_to_menu: "Back to menu",
    active_check_title: "Open check for your table",
    active_check_desc: "As long as this table stays open, you can request the bill from here.",
    active_check_total: "Total",
    active_check_remaining: "Remaining",
    request_bill: "Request bill",
    request_bill_pending: "Requesting bill…",
    request_bill_success: "Your bill request was sent to the cashier",
    request_bill_failed: "Bill request couldn't be sent",
    request_bill_failed_desc: "Please check your connection and try again.",
    bill_already_requested: "Your bill request is already in progress. Staff are preparing it for payment.",
    bill_request_no_active_order: "An active order is required before you can request the bill.",
    campaigns_title: "Offers",
    campaign_members_only: "Members only",
    campaign_label: "Offer",
  },
  ru: {
    search_placeholder: "Поиск по меню",
    all_categories: "Все",
    products_showing: "Показано блюд: {n}",
    view_mode_title: "Режим просмотра меню",
    view_mode_no_table: "Заведение сейчас не принимает заказы через QR-код.",
    view_mode_scan_qr: "Отсканируйте QR-код на столе, чтобы сделать заказ.",
    menu_unreachable_title: "Меню недоступно",
    menu_generic_error: "Меню сейчас невозможно показать.",
    retry: "Повторить",
    view_cart: "Открыть корзину",
    product_added: "Товар добавлен в корзину",
    order_request_sent: "Ваш заказ отправлен",
    order_request_failed: "Не удалось отправить заказ",
    order_request_failed_desc: "Проверьте соединение и попробуйте снова.",
    tagline: "Свежие блюда от {business}, подаются прямо к вашему столу.",
    product_not_found: "Ничего не найдено",
    product_not_found_desc: "Измените поиск или категорию.",
    options_count: "Вариантов: {n}",
    tap_for_details: "Нажмите, чтобы увидеть детали и опции.",
    allergen_label: "Аллергены",
    product_note_label: "Комментарий к блюду",
    product_note_placeholder: "Напр. соус отдельно",
    required: "Обязательно",
    optional: "По желанию",
    max_selection: "не более {n}",
    min_selection_error: "Выберите минимум {n} в разделе «{group}».",
    default_product_desc: "Выберите опции и добавьте блюдо в корзину.",
    item_count_label: "Количество",
    decrease: "Уменьшить количество",
    increase: "Увеличить количество",
    add_to_cart: "В корзину · {amount}",
    cart_title: "Ваша корзина",
    cart_desc_table: "Заказ для стола {table}",
    cart_desc_no_table: "Отсканируйте QR-код на столе, чтобы сделать заказ.",
    cart_empty: "Корзина пуста",
    cart_empty_desc: "Выберите что-нибудь из меню, чтобы начать.",
    order_note_label: "Комментарий к заказу",
    order_note_placeholder: "Комментарий ко всему заказу",
    estimated_total: "Примерная сумма",
    sending: "Отправка…",
    send_order_request: "Отправить заказ",
    confirm_order_title: "Подтвердить отправку заказа?",
    confirm_order_desc:
      "Позиций: {count}. Заказ будет отправлен персоналу для стола {table}. После отправки изменить его нельзя.",
    back_to_cart: "Назад в корзину",
    confirm_and_send: "Подтвердить и отправить",
    order_disabled_note:
      "Заказ можно отправить только по QR-коду стола, пока заведение принимает заказы.",
    selected_table_fallback: "выбранного стола",
    request_status_approved_title: "Ваш заказ принят",
    request_status_rejected_title: "Ваш запрос не был принят",
    request_status_pending_title: "Ваш запрос передан персоналу",
    request_status_approved_desc:
      "Заказ был подтверждён автоматически и передан на приготовление.",
    request_status_rejected_desc:
      "За подробностями обратитесь к персоналу.",
    request_status_pending_desc:
      "Персонал проверяет ваш заказ. Приготовление начнётся после подтверждения.",
    request_number_label: "Номер запроса",
    request_status_footer:
      "Этот экран показывает последний подтверждённый статус с сервера. За актуальной информацией обратитесь к персоналу.",
    back_to_menu: "Назад в меню",
    active_check_title: "Открытый счёт вашего стола",
    active_check_desc: "Пока этот стол открыт, вы можете запросить счёт прямо отсюда.",
    active_check_total: "Итого",
    active_check_remaining: "Остаток",
    request_bill: "Запросить счёт",
    request_bill_pending: "Запрашиваем счёт…",
    request_bill_success: "Запрос на счёт отправлен кассе",
    request_bill_failed: "Не удалось отправить запрос на счёт",
    request_bill_failed_desc: "Проверьте соединение и попробуйте снова.",
    bill_already_requested: "Запрос на счёт уже принят. Персонал готовит чек к оплате.",
    bill_request_no_active_order: "Сначала нужно оформить активный заказ на этом столе.",
    campaigns_title: "Акции",
    campaign_members_only: "Только для участников",
    campaign_label: "Акция",
  },
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  )
}

export function translate(
  locale: QrLocale,
  key: QrTranslationKey,
  params?: Record<string, string | number>,
): string {
  return interpolate(STRINGS[locale][key], params)
}

const LOCALE_CHANGE_EVENT = "dixora:qr-locale-change"

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback)
  window.addEventListener(LOCALE_CHANGE_EVENT, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(LOCALE_CHANGE_EVENT, callback)
  }
}

function getSnapshot(): QrLocale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === "tr" || stored === "en" || stored === "ru") return stored
  } catch {
    // Storage can be unavailable in privacy modes; default locale stands.
  }
  return "tr"
}

function getServerSnapshot(): QrLocale {
  return "tr"
}

export function useQrLocale(): [QrLocale, (locale: QrLocale) => void] {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const setLocale = useCallback((next: QrLocale) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage can be unavailable in privacy modes; the choice just won't persist.
    }
    window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT))
  }, [])

  return [locale, setLocale]
}
