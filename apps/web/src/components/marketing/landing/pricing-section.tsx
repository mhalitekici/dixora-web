import { ArrowRight, Check } from "lucide-react";

import styles from "./landing.module.css";

const planFeatures = [
  "Masa ve sipariş yönetimi",
  "Mutfak ekranı ve istasyonlar",
  "Kasa ve ödeme akışı",
  "QR menü ve sipariş",
  "Stok ve reçete takibi",
  "Raporlama ve işlem geçmişi",
  "Rol ve yetki yönetimi",
  "1 şube · 50 kullanıcıya kadar",
] as const;

export function PricingSection() {
  return (
    <section
      id="fiyatlandirma"
      className={styles.pricingSection}
      aria-labelledby="pricing-title"
    >
      <div className={styles.pricingShell}>
        <div className={styles.trialStatement}>
          <p className={styles.sectionIndex}>03 / Fiyatlandırma</p>
          <span className={styles.trialNumber}>30</span>
          <span className={styles.trialUnit}>GÜN</span>
          <h2 id="pricing-title">İşletmenizde ücretsiz deneyin.</h2>
          <p>
            Kredi kartı vermeden tüm Standard modüllerini kullanın. Deneme
            sonunda devam edip etmeyeceğinize siz karar verin.
          </p>
        </div>

        <article className={styles.priceReceipt}>
          <div className={styles.receiptCut} aria-hidden="true" />
          <header>
            <div>
              <span>PLAN / 001</span>
              <strong>Dixora Standard</strong>
            </div>
            <span className={styles.receiptTrial}>İLK 30 GÜN · ₺0</span>
          </header>

          <div className={styles.receiptPrice}>
            <span>Deneme sonrasında</span>
            <p>
              <strong>₺1.499,99</strong>
              <small>/ ay</small>
            </p>
          </div>

          <ul>
            {planFeatures.map((feature) => (
              <li key={feature}>
                <Check aria-hidden="true" />
                {feature}
              </li>
            ))}
          </ul>

          <div className={styles.receiptTotal}>
            <span>Aylık toplam</span>
            <strong>₺1.499,99</strong>
          </div>
          <p className={styles.receiptNote}>
            Deneme sonunda devam etmek isterseniz Standard paket aylık olarak
            sunulur.
          </p>
          <a className={styles.receiptCta} href="#kayit">
            Ücretsiz kullanmaya başla
            <ArrowRight aria-hidden="true" />
          </a>
        </article>
      </div>
    </section>
  );
}
