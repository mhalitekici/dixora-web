import {
  BadgeCheck,
  BookOpenCheck,
  ChefHat,
  ClipboardList,
  CookingPot,
  LayoutGrid,
  PackageCheck,
  QrCode,
  ReceiptText,
  ShieldCheck,
  UserRoundCheck,
  WalletCards,
} from "lucide-react";

import styles from "./landing.module.css";

const salonFeatures = [
  { icon: LayoutGrid, label: "Masa planı ve anlık durum" },
  { icon: ClipboardList, label: "Garson sipariş akışı" },
  { icon: QrCode, label: "QR menü ve sipariş" },
  { icon: WalletCards, label: "Kasa ve ödeme yönetimi" },
] as const;

const preparationFeatures = [
  { icon: ChefHat, label: "Mutfak ekranı" },
  { icon: CookingPot, label: "Hazırlık istasyonları" },
  { icon: ReceiptText, label: "Bilet ve yazdırma akışı" },
  { icon: BadgeCheck, label: "Hazır / servis durumu" },
] as const;

const controlFeatures = [
  { icon: BookOpenCheck, label: "Ürün, reçete ve katalog" },
  { icon: PackageCheck, label: "Stok hareketleri" },
  { icon: UserRoundCheck, label: "Ekip rolleri ve yetkiler" },
  { icon: ShieldCheck, label: "Rapor ve işlem geçmişi" },
] as const;

export function FeatureStories() {
  return (
    <section
      id="urun"
      className={styles.featuresSection}
      aria-labelledby="features-title"
    >
      <div className={styles.sectionShell}>
        <div className={styles.featuresHeading}>
          <p className={styles.sectionIndex}>02 / Çalışma alanları</p>
          <h2 id="features-title" className={styles.sectionTitle}>
            Operasyonun üç yüzü.
            <span>Birbirinden kopmadan.</span>
          </h2>
          <p>
            Her ekip kendi işine odaklanır. Dixora, masadaki ilk dokunuştan
            yönetim kararına kadar aradaki bağlantıyı korur.
          </p>
        </div>

        <article className={styles.featureChapter}>
          <div className={styles.chapterCopy}>
            <p className={styles.chapterNumber}>A / SALON</p>
            <h3>Masayı değil, servisin tamamını görün.</h3>
            <p>
              Hangi masa boş, hangi sipariş hazırlanıyor, hangisi hesap bekliyor;
              salon ekibi aynı güncel görünüm üzerinden ilerler.
            </p>
            <FeatureList items={salonFeatures} />
          </div>
          <SalonScene />
        </article>

        <article
          className={[styles.featureChapter, styles.featureChapterDark].join(" ")}
        >
          <PreparationScene />
          <div className={styles.chapterCopy}>
            <p className={styles.chapterNumber}>B / HAZIRLIK</p>
            <h3>Doğru ürün, doğru istasyona düşsün.</h3>
            <p>
              Mutfak ve bar ekipleri kendi biletlerini, notlarını ve geçen
              süreyi görür. Hazır bilgisi salona tek dokunuşla ulaşır.
            </p>
            <FeatureList items={preparationFeatures} />
          </div>
        </article>

        <article className={styles.featureChapter}>
          <div className={styles.chapterCopy}>
            <p className={styles.chapterNumber}>C / KONTROL</p>
            <h3>Günün sonunda tabloyu birleştirmeyin.</h3>
            <p>
              Satış, ürün, ödeme, stok ve ekip hareketleri zaten aynı kayıtta
              ilerler. İşletmenizi tutarlı veriden yönetin.
            </p>
            <FeatureList items={controlFeatures} />
          </div>
          <ControlScene />
        </article>
      </div>
    </section>
  );
}

function FeatureList({
  items,
}: {
  items: ReadonlyArray<{
    icon: typeof LayoutGrid;
    label: string;
  }>;
}) {
  return (
    <ul className={styles.chapterFeatureList}>
      {items.map((item) => (
        <li key={item.label}>
          <item.icon aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function SalonScene() {
  const tables = [
    { table: "M01", detail: "3 sipariş", state: "occupied" },
    { table: "M02", detail: "Servise hazır", state: "ready" },
    { table: "M03", detail: "Boş", state: "empty" },
    { table: "M04", detail: "Hesap", state: "bill" },
    { table: "M05", detail: "2 sipariş", state: "occupied" },
    { table: "M06", detail: "Boş", state: "empty" },
  ];

  return (
    <div className={styles.productScene} aria-label="Salon operasyon görünümü">
      <div className={styles.sceneToolbar}>
        <div>
          <span>Salon</span>
          <strong>Ana kat · 6 masa</strong>
        </div>
        <span className={styles.sceneTag}>SALON OPERASYONU</span>
      </div>
      <div className={styles.tableSceneBody}>
        <div className={styles.tableGrid}>
          {tables.map((item) => (
            <div
              key={item.table}
              className={[
                styles.tableItem,
                styles["table_" + item.state],
              ].join(" ")}
            >
              <strong>{item.table}</strong>
              <span>{item.detail}</span>
            </div>
          ))}
        </div>
        <div className={styles.sceneOrder}>
          <p>M01 / AÇIK SİPARİŞ</p>
          <strong>3 misafir</strong>
          <ul>
            <li>
              <span>2×</span> Burger
              <small>Hazırlanıyor</small>
            </li>
            <li>
              <span>1×</span> Salata
              <small>Hazır</small>
            </li>
            <li>
              <span>2×</span> İçecek
              <small>Barda</small>
            </li>
          </ul>
          <div>
            <span>Toplam</span>
            <b>₺1.840,00</b>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreparationScene() {
  const tickets = [
    {
      id: "#1048",
      table: "M12",
      time: "08:42",
      lines: ["2× Klasik Burger", "1× Patates"],
      state: "HAZIRLANIYOR",
    },
    {
      id: "#1049",
      table: "M05",
      time: "05:18",
      lines: ["1× Akdeniz Salata", "Sos ayrı"],
      state: "YENİ",
    },
    {
      id: "#1046",
      table: "M02",
      time: "12:03",
      lines: ["2× Izgara Tavuk", "1× Çocuk menü"],
      state: "HAZIR",
    },
  ];

  return (
    <div
      className={[styles.productScene, styles.kitchenScene].join(" ")}
      aria-label="Mutfak operasyon görünümü"
    >
      <div className={styles.sceneToolbar}>
        <div>
          <span>Mutfak ekranı</span>
          <strong>Sıcak istasyon</strong>
        </div>
        <span className={styles.sceneTag}>3 AKTİF BİLET</span>
      </div>
      <div className={styles.kitchenRail} aria-hidden="true" />
      <div className={styles.kitchenTickets}>
        {tickets.map((ticket, index) => (
          <article key={ticket.id} className={styles.kitchenTicket}>
            <header>
              <span>{ticket.id}</span>
              <strong>{ticket.table}</strong>
              <time>{ticket.time}</time>
            </header>
            <ul>
              {ticket.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className={index === 2 ? styles.ticketReady : undefined}>
              {ticket.state}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

function ControlScene() {
  const ledger = [
    ["Dana burger köftesi", "−2 porsiyon", "Sipariş #1048"],
    ["Akdeniz salata reçetesi", "−1 porsiyon", "Sipariş #1048"],
    ["Passion şurubu", "−120 ml", "Bar / #1048"],
    ["Güncel masa durumu", "Kapatıldı", "Kasa / M02"],
  ];

  return (
    <div className={styles.productScene} aria-label="Yönetim görünümü">
      <div className={styles.sceneToolbar}>
        <div>
          <span>Kontrol merkezi</span>
          <strong>İşlem günlüğü</strong>
        </div>
        <span className={styles.sceneTag}>TEK KAYIT</span>
      </div>
      <div className={styles.ledgerHead}>
        <span>Hareket</span>
        <span>Değişim</span>
        <span>Kaynak</span>
      </div>
      <div className={styles.ledgerRows}>
        {ledger.map(([name, change, source]) => (
          <div key={name}>
            <strong>{name}</strong>
            <span>{change}</span>
            <small>{source}</small>
          </div>
        ))}
      </div>
      <div className={styles.controlFooter}>
        <span>Satış</span>
        <i aria-hidden="true" />
        <span>Stok</span>
        <i aria-hidden="true" />
        <span>Rapor</span>
        <b>Aynı veri zinciri</b>
      </div>
    </div>
  );
}
