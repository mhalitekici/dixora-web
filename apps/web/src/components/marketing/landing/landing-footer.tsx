import Link from "next/link";

import { BrandLogo } from "@/components/brand/brand-logo";

import styles from "./landing.module.css";

export function LandingFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <Link href="/" aria-label="Dixora ana sayfa">
          <BrandLogo theme="dark" />
        </Link>
        <nav aria-label="Alt menü">
          <a href="#urun">Ürün</a>
          <a href="#akis">Akış</a>
          <a href="#fiyatlandirma">Fiyatlandırma</a>
          <Link href="/login">İşletme girişi</Link>
          <Link href="/login?mode=staff">Çalışan girişi</Link>
        </nav>
        <p>© 2026 Dixora · İşletme operasyon platformu</p>
      </div>
    </footer>
  );
}
