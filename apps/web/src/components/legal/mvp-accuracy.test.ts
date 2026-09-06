import { describe, expect, it } from "vitest"

import { MEMBERSHIP_AGREEMENT_SECTIONS } from "@/components/marketing/membership-agreement"
import { KVKK_NOTICE } from "@/components/legal/documents/kvkk-notice"
import { CANCELLATION_REFUND_POLICY } from "@/components/legal/documents/cancellation-refund-policy"

/**
 * Guards the gap between what the legal text claims and what the product
 * actually does at MVP stage — see apps/api's `.env.production.example`:
 * `DIXORA_PAYMENT_PROVIDER=none`, email/SMS providers default to "disabled",
 * and there is no ÖKC/fiscal-device code anywhere in the repo.
 *
 * Bare keyword bans (e.g. forbidding the word "ÖKC") don't work here, because
 * the correct text *does* mention these things — in a negated sentence saying
 * Dixora does not offer them. These tests instead assert the actual sentences
 * a reader would see, so a future edit that flips a "sunmaz" into a "sunar"
 * is caught.
 */
function flatten(sections: typeof MEMBERSHIP_AGREEMENT_SECTIONS): string {
  return sections
    .flatMap((section) => [section.heading, ...section.paragraphs, ...(section.list ?? [])])
    .join(" ")
}

describe("membership agreement — MVP payment and fiscal-device accuracy", () => {
  const text = flatten(MEMBERSHIP_AGREEMENT_SECTIONS)

  it("states plainly that no fiscal device or official document service is offered", () => {
    expect(text).toContain(
      "ödeme kaydedici cihaz (ÖKC) entegrasyonu, mali cihazla otomatik çalışma, resmi fiş/fatura kesme veya başka bir mali belge düzenleme hizmeti sunmaz",
    )
  })

  it("never claims Dixora issues official fiscal documents", () => {
    // Loose enough to catch a rephrase that starts promising this again.
    expect(text).not.toMatch(/dixora['’]?(nın)?\s+(resmi\s+)?(fiş|fatura)\s+(keser|düzenler|üretir)/i)
    expect(text).not.toMatch(/ökc\s+(entegrasyonu\s+)?sunar/i)
  })

  it("never promises automatic card billing or a stored card", () => {
    expect(text).toContain("Dixora, Üye'ye ait kayıtlı bir kart bilgisi tutmaz")
    expect(text).toContain("kredi kartından otomatik tahsilat yapmaz")
    // The old renewal wording implied recurring billing needs no fresh
    // payment approval — false once no card is stored.
    expect(text).not.toContain("yeni bir tahsilat onayı gerektirmez")
  });

  it("names the currently active payment channel and marks card payment as future-only", () => {
    expect(text).toContain("hâlihazırda banka havalesi/EFT");
    expect(text).toContain(
      "online kart ile ödeme (sanal POS), otomatik kart tahsilatı veya ödeme kaydedici cihaz (ÖKC) entegrasyonu sunmaz",
    );
    expect(text).toContain("herhangi bir ödeme sağlayıcısı bu amaçlarla aktif olarak kullanılmamaktadır");
  });

  it("frames the withdrawal right as consumer-only, not a blanket B2B guarantee", () => {
    expect(text).toContain("esas olarak ticari/mesleki amaçla kullanan işletmelere sunulur");
    expect(text).toContain("tüketici sıfatını taşıdığı istisnai hâllerde");
    // The old text granted the 14-day right to any paying member outright.
    expect(text).not.toMatch(
      /ücretli dönem için ödeme yapan üye,[^.]*14 \(on dört\) gün içinde/i,
    );
  });

  it("carves out mandatory-law and bad-faith exceptions from the liability cap", () => {
    expect(text).toContain("emredici mevzuat hükümleri gereği sınırlandırılamayan sorumluluk");
    expect(text).toContain("kişisel veri ihlallerinde");
    expect(text).toContain("fikri mülkiyet hakkını bilerek ihlal etmesinden");
  });

  it("never states Dixora is not liable under any circumstance", () => {
    expect(text.toLocaleLowerCase("tr")).not.toContain("hiçbir koşulda");
    expect(text.toLocaleLowerCase("tr")).not.toContain("hiçbir durumda sorumlu değildir");
  });
});

describe("KVKK notice — MVP data accuracy", () => {
  const text = flatten(KVKK_NOTICE.sections);

  it("does not claim a payment provider holds card data today", () => {
    expect(text).not.toContain("ödeme sağlayıcısının altyapısında tutulur");
    expect(text).toContain("Dixora şu anda (MVP aşamasında) kart bilgisi toplamaz veya saklamaz");
  });

  it("treats self-hosted storage as infrastructure, not a third-party transfer", () => {
    expect(text).toContain("kendi kontrolündeki sistemlerde (self-hosted) çalışır");
  });

  it("conditions email/SMS providers rather than asserting them as always-on", () => {
    expect(text).toContain("etkinleştirildiğinde kişisel verileriniz şu üçüncü taraf hizmet sağlayıcılarına");
  });

  it("separates the current transfer list from a hypothetical future payment provider", () => {
    expect(text).toContain("bu potansiyel gelecek kullanım, yukarıdaki güncel aktarım listesinden ayrıdır");
  });
});

describe("cancellation & refund policy — MVP and B2B accuracy", () => {
  const text = flatten(CANCELLATION_REFUND_POLICY.sections);

  it("states the B2B/B2C distinction explicitly", () => {
    expect(text).toContain("İşletme (B2B) ve Tüketici (B2C)");
    expect(
      CANCELLATION_REFUND_POLICY.sections.some((section) =>
        section.heading.includes("B2B") ,
      ),
    ).toBe(true);
  });

  it("does not promise virtual POS chargeback/provisioning detail as if active", () => {
    expect(text).not.toMatch(/kartı veren bankanın işlem sürelerine tabi olacaktır/);
    expect(text).toContain("Dixora, MVP sürümünde online kart ile ödeme (sanal POS) sunmamaktadır");
  });

  it("keeps the mandatory consumer carve-out for the 14-day right", () => {
    expect(text).toContain("Tüketici sıfatını taşıdığınız istisnai hâllerde");
  });
});
