import {
  BarChart3,
  CheckCheck,
  ChefHat,
  CreditCard,
  QrCode,
  Utensils,
} from "lucide-react";

import styles from "./landing.module.css";

const flowSteps = [
  {
    number: "01",
    title: "Sipariş alınır",
    detail: "Garson, kasa veya QR menü",
    icon: QrCode,
  },
  {
    number: "02",
    title: "Akış onaylanır",
    detail: "Gerektiğinde ekip kontrolü",
    icon: CheckCheck,
  },
  {
    number: "03",
    title: "İstasyona düşer",
    detail: "Mutfak ve bar görevleri",
    icon: ChefHat,
  },
  {
    number: "04",
    title: "Hazır ve serviste",
    detail: "Ekip aynı durumu görür",
    icon: Utensils,
  },
  {
    number: "05",
    title: "Ödeme kapanır",
    detail: "Masa ve kasa güncellenir",
    icon: CreditCard,
  },
  {
    number: "06",
    title: "Kayda geçer",
    detail: "Stok ve rapora yansır",
    icon: BarChart3,
  },
] as const;

export function OperationFlowSection() {
  return (
    <section
      id="akis"
      className={styles.flowSection}
      aria-labelledby="flow-title"
    >
      <div className={styles.sectionShell}>
        <div className={styles.flowIntro}>
          <p className={styles.sectionIndex}>01 / Operasyon akışı</p>
          <div>
            <h2 id="flow-title" className={styles.sectionTitle}>
              Bir sipariş,
              <span>tek kayıt.</span>
            </h2>
            <p>
              Sipariş alındığı andan gün sonu raporuna kadar veri tekrar
              girilmez, durum aramak için ekranlar arasında dolaşılmaz.
            </p>
          </div>
        </div>

        <div className={styles.flowBoard}>
          <div className={styles.flowRail} aria-hidden="true">
            <span />
          </div>
          <ol className={styles.flowList}>
            {flowSteps.map((step) => (
              <li key={step.number} className={styles.flowStep}>
                <span className={styles.flowNode} aria-hidden="true">
                  <step.icon />
                </span>
                <span className={styles.flowNumber}>{step.number}</span>
                <strong>{step.title}</strong>
                <small>{step.detail}</small>
              </li>
            ))}
          </ol>
        </div>

        <p className={styles.flowNote}>
          <span aria-hidden="true" />
          Aynı sipariş; salon, hazırlık, ödeme, stok ve rapor ekranlarında kendi
          görevine göre görünür.
        </p>
      </div>
    </section>
  );
}
