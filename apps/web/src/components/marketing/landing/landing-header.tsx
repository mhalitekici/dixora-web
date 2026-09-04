import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { BrandLogo } from "@/components/brand/brand-logo";

import styles from "./landing.module.css";

export function LandingHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link className={styles.brand} href="/" aria-label="Dixora ana sayfa">
          <BrandLogo theme="dark" priority />
        </Link>

        <nav className={styles.primaryNav} aria-label="Ana menü">
          <a href="#urun">Ürün</a>
          <a href="#akis">Akış</a>
          <a href="#fiyatlandirma">Fiyat</a>
        </nav>

        <div className={styles.headerActions}>
          <Link
            className={styles.loginLink}
            href="/login"
            aria-label="İşletme girişi"
          >
            <span className={styles.loginLong}>İşletme girişi</span>
            <span className={styles.loginShort}>İşletme</span>
          </Link>
          <Link
            className={styles.loginLink}
            href="/login?mode=staff"
            aria-label="Çalışan girişi"
          >
            <span className={styles.loginLong}>Çalışan girişi</span>
            <span className={styles.loginShort}>Garson</span>
          </Link>
          <a className={styles.headerCta} href="#kayit">
            <span className={styles.ctaLong}>Ücretsiz başla</span>
            <span className={styles.ctaShort}>Başla</span>
            <ArrowUpRight aria-hidden="true" />
          </a>
        </div>
      </div>
    </header>
  );
}
