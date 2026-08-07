import { Check, ChefHat, CircleDot, ReceiptText } from "lucide-react";

import styles from "./landing.module.css";

export function OperationsStage() {
  return (
    <div className={styles.stageWrap}>
      <div className={styles.stageMark} aria-hidden="true">
        <span>D</span>
        <i />
      </div>
      <section className={styles.stage} aria-label="Sipariş akışı">
        <header className={styles.stageHeader}>
          <div>
            <span className={styles.stageKicker}>Sipariş akışı</span>
            <strong>Masa 12 · 3 misafir</strong>
          </div>
          <span className={styles.stageClock}>
            <CircleDot aria-hidden="true" /> Servis açık
          </span>
        </header>

        <div className={styles.serviceRail} aria-hidden="true">
          <span className={styles.railPulse} />
        </div>

        <div className={styles.stageGrid}>
          <article
            className={[styles.stageTicket, styles.stageTicketOrder].join(" ")}
          >
            <div className={styles.ticketTopline}>
              <span>01 / SALON</span>
              <span className={styles.ticketStatus}>YENİ</span>
            </div>
            <div className={styles.ticketIdentity}>
              <ReceiptText aria-hidden="true" />
              <div>
                <strong>Sipariş #1048</strong>
                <span>Garson · Deniz</span>
              </div>
            </div>
            <ul className={styles.orderLines}>
              <li>
                <span>2×</span> Klasik Burger
              </li>
              <li>
                <span>1×</span> Akdeniz Salata
              </li>
              <li>
                <span>2×</span> Passion Cooler
              </li>
            </ul>
          </article>

          <article
            className={[styles.stageTicket, styles.stageTicketKitchen].join(" ")}
          >
            <div className={styles.ticketTopline}>
              <span>02 / MUTFAK</span>
              <span className={styles.ticketTimer}>08:42</span>
            </div>
            <div className={styles.kitchenSignal}>
              <ChefHat aria-hidden="true" />
              <div>
                <strong>Sıcak istasyon</strong>
                <span>2 ürün hazırlanıyor</span>
              </div>
            </div>
            <div className={styles.prepRows}>
              <span>
                Burger <b>Hazırlanıyor</b>
              </span>
              <span>
                Salata <b>Hazır</b>
              </span>
            </div>
          </article>

          <article
            className={[styles.stageTicket, styles.stageTicketCash].join(" ")}
          >
            <div className={styles.ticketTopline}>
              <span>03 / KASA</span>
              <Check aria-hidden="true" />
            </div>
            <p>Salon, mutfak ve kasa aynı siparişi görür.</p>
            <div className={styles.cashTotal}>
              <span>Masa toplamı</span>
              <strong>₺1.840,00</strong>
            </div>
          </article>
        </div>

        <footer className={styles.stageFooter}>
          <span>Tek sipariş kaydı</span>
          <span aria-hidden="true">→</span>
          <span>Anlık görev durumu</span>
          <span aria-hidden="true">→</span>
          <span>Stok ve rapora hazır</span>
        </footer>
      </section>
    </div>
  );
}
