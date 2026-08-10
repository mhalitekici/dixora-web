import {
  Activity,
  BadgePercent,
  BarChart3,
  BedDouble,
  Blocks,
  Boxes,
  Building2,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileClock,
  Grid2X2,
  HandPlatter,
  HeartPulse,
  HeartHandshake,
  LayoutDashboard,
  ListChecks,
  Map,
  MonitorDot,
  PackageSearch,
  Printer,
  QrCode,
  ReceiptText,
  Settings2,
  ShieldCheck,
  ShoppingBasket,
  SlidersHorizontal,
  Sparkles,
  Store,
  TableProperties,
  Tags,
  UsersRound,
  UtensilsCrossed,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  exact?: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const adminNavigation: NavGroup[] = [
  {
    label: "Genel Bakış",
    items: [
      { label: "Kontrol Merkezi", href: "/admin", icon: LayoutDashboard, exact: true },
      { label: "Canlı Operasyon", href: "/admin/live", icon: Activity, badge: "canlı" },
      { label: "Onaylar", href: "/admin/approvals", icon: ClipboardCheck },
      { label: "Masalar", href: "/admin/tables", icon: Grid2X2 },
      { label: "Otel Odaları", href: "/admin/hotel-rooms", icon: BedDouble },
      { label: "Siparişler", href: "/admin/orders", icon: ReceiptText },
    ],
  },
  {
    label: "Menü ve Stok",
    items: [
      { label: "Ürünler", href: "/admin/products", icon: ShoppingBasket },
      { label: "Kategoriler", href: "/admin/categories", icon: Tags },
      { label: "Modifiyerler", href: "/admin/modifiers", icon: SlidersHorizontal },
      { label: "Envanter", href: "/admin/inventory", icon: Boxes },
      { label: "QR Menü", href: "/admin/qr-menu", icon: QrCode },
      { label: "Sadakat Programı", href: "/admin/loyalty", icon: HeartHandshake },
    ],
  },
  {
    label: "Operasyon Ayarları",
    items: [
      { label: "Yazıcılar", href: "/admin/printers", icon: Printer },
      { label: "Çalışanlar", href: "/admin/employees", icon: UsersRound },
      { label: "Roller ve Yetkiler", href: "/admin/roles", icon: ShieldCheck },
      { label: "Raporlar", href: "/admin/reports", icon: BarChart3 },
      { label: "Denetim Kayıtları", href: "/admin/audit-logs", icon: FileClock },
    ],
  },
  {
    label: "Yapılandırma",
    items: [
      { label: "İşletme Ayarları", href: "/admin/settings", icon: Settings2 },
      { label: "Şube Ayarları", href: "/admin/branch-settings", icon: Store },
      { label: "Üyelik ve Ödeme", href: "/admin/subscription", icon: CreditCard },
      { label: "Kurulum Sihirbazı", href: "/admin/onboarding", icon: Sparkles },
    ],
  },
];

export const superAdminNavigation: NavGroup[] = [
  {
    label: "Dixora Platformu",
    items: [
      { label: "İşletmeler", href: "/super-admin/businesses", icon: Building2 },
      { label: "Abonelikler", href: "/super-admin/subscriptions", icon: CreditCard },
      { label: "Sistem durumu", href: "/super-admin/system", icon: HeartPulse },
      { label: "Audit kayıtları", href: "/super-admin/audit-logs", icon: FileClock },
    ],
  },
];

export const qrNavigation: NavGroup[] = [
  {
    label: "QR Menü",
    items: [
      { label: "Genel Bakış", href: "/admin/qr-menu", icon: QrCode, exact: true },
      { label: "Görünüm ve Kurallar", href: "/admin/qr-menu/settings", icon: SlidersHorizontal },
      { label: "QR Kodları", href: "/admin/qr-menu/codes", icon: Blocks },
      { label: "Müşteri Talepleri", href: "/admin/qr-menu/orders", icon: ClipboardList },
    ],
  },
];

export const operationalLinks = {
  waiter: [
    { label: "Masalar", href: "/waiter/tables", icon: Map },
    { label: "Aktif Sipariş", href: "/waiter", icon: HandPlatter },
    { label: "Bildirimler", href: "/waiter/notifications", icon: ListChecks },
  ],
  cashier: [
    { label: "Kasa", href: "/cashier", icon: WalletCards },
    { label: "Kapananlar", href: "/cashier/closed-orders", icon: ReceiptText },
    { label: "Vardiya", href: "/cashier/shift", icon: MonitorDot },
  ],
};

export const placeholderIconMap = {
  tables: TableProperties,
  products: PackageSearch,
  menu: UtensilsCrossed,
  discounts: BadgePercent,
};
