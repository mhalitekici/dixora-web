import { Check, Clock3, CreditCard, ShieldCheck } from "lucide-react";

import { TrialRegistrationForm } from "@/components/marketing/trial-registration-form";

import styles from "./landing.module.css";

const assurances = [
  { icon: CreditCard, label: "Kredi kartı gerekmez" },
  { icon: Clock3, label: "30 gün ücretsiz kullanım" },
  { icon: ShieldCheck, label: "İşletmenize özel güvenli alan" },
] as const;

export function RegistrationSection() {
  return (
    <section
      id="kayit"
      className={styles.registrationSection}
      aria-labelledby="registration-title"
    >
      <div className={styles.registrationShell}>
        <div className={styles.registrationCopy}>
          <p className={styles.sectionIndex}>04 / İşletme kaydı</p>
          <h2 id="registration-title" className={styles.sectionTitle}>
            İşletme hesabınızı
            <span>şimdi açın.</span>
          </h2>
          <p>
            Bilgilerinizi girin; işletmeniz, merkez şubeniz ve işletme sahibi
            hesabınız otomatik olarak oluşturulsun.
          </p>

          <ul className={styles.assuranceList}>
            {assurances.map((item) => (
              <li key={item.label}>
                <span>
                  <item.icon aria-hidden="true" />
                </span>
                {item.label}
                <Check aria-hidden="true" />
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.registrationForm}>
          <header>
            <span>KAYIT / 30 GÜNLÜK DENEME</span>
            <strong>Çalışma alanınızı oluşturun</strong>
          </header>
          <TrialRegistrationForm />
        </div>
      </div>
    </section>
  );
}
