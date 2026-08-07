import { ArrowDown, ArrowRight, Check } from "lucide-react";

import { OperationsStage } from "./operations-stage";
import styles from "./landing.module.css";

export function HeroSection() {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.heroGrid}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <span aria-hidden="true" />
            Yeme-içme operasyonu · Tek çalışma alanı
          </p>
          <h1 id="hero-title" className={styles.heroTitle}>
            Salondan mutfağa,
            <span>tek servis akışı.</span>
          </h1>
          <p className={styles.heroLead}>
            Masa, sipariş, mutfak, kasa, QR menü, stok ve rapor aynı kayıtta
            ilerler. Ekibiniz görevini görür; siz işletmenin tamamını.
          </p>

          <div className={styles.heroActions}>
            <a className={styles.primaryCta} href="#kayit">
              30 gün ücretsiz başla
              <ArrowRight aria-hidden="true" />
            </a>
            <a className={styles.textCta} href="#akis">
              Akışı incele
              <ArrowDown aria-hidden="true" />
            </a>
          </div>

          <div className={styles.heroPromise} aria-label="Deneme koşulları">
            <span>
              <Check aria-hidden="true" /> Kredi kartı gerekmez
            </span>
            <span>
              <Check aria-hidden="true" /> Kurulum ücreti yok
            </span>
          </div>
          <p className={styles.heroPrice}>
            30 gün ücretsiz <span aria-hidden="true">·</span> Sonrasında{" "}
            <strong>₺1.499,99 / ay</strong>
          </p>
        </div>

        <OperationsStage />
      </div>

      <div className={styles.heroFooter} aria-label="Dixora modülleri">
        <span>01 / Salon</span>
        <span>02 / Mutfak</span>
        <span>03 / Kasa</span>
        <span>04 / Stok</span>
        <span>05 / Rapor</span>
      </div>
    </section>
  );
}
