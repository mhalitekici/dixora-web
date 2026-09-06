"use client";

import Link from "next/link";

import { BrandLogo } from "@/components/brand/brand-logo";
import { useCookieConsentStore } from "@/stores/cookie-consent-store";

import styles from "./landing.module.css";

export function LandingFooter() {
  const openPreferences = useCookieConsentStore((state) => state.openPreferences);

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
      <div className={styles.footerLegal}>
        <nav aria-label="Yasal">
          <Link href="/uyelik-sozlesmesi">Üyelik ve SaaS Hizmet Sözleşmesi</Link>
          <Link href="/kvkk-aydinlatma-metni">KVKK Aydınlatma Metni</Link>
          <Link href="/gizlilik-politikasi">Gizlilik Politikası</Link>
          <Link href="/cerez-politikasi">Çerez Politikası</Link>
          <Link href="/iptal-iade-politikasi">İptal ve İade Politikası</Link>
          <button type="button" onClick={openPreferences}>
            Çerez Tercihleri
          </button>
        </nav>
      </div>
    </footer>
  );
}
