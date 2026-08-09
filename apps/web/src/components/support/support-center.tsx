"use client";

import {
  ChevronDown,
  LifeBuoy,
  Mail,
  MessageSquareText,
} from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const SUPPORT_EMAIL = "support@dixoratech.com";
export const INFO_EMAIL = "info@dixoratech.com";

type Faq = { question: string; answer: string };

const faqs: Faq[] = [
  {
    question: "Şifremi unuttum, ne yapmalıyım?",
    answer:
      "İşletme yöneticiniz Çalışanlar ekranından şifrenizi sıfırlayabilir. Yönetici hesabının şifresi unutulduysa support@dixoratech.com adresine işletme adınızla birlikte yazın; kimlik doğrulaması sonrası geçici bir şifre tanımlarız. Şifrenizi kendiniz değiştirmek için Ayarlar › Şifre değiştir bölümünü kullanabilirsiniz.",
  },
  {
    question: "QR menü açılmıyor",
    answer:
      "Önce Admin › QR Menü ekranından menünün açık olduğunu doğrulayın. Menü kapalıysa veya işletme aboneliği sona erdiyse müşteriler menüyü göremez. QR kodu okutulduğu hâlde masa bulunamıyorsa, ilgili masanın QR kodunu Admin › QR Menü › QR Kodları ekranından yenileyin.",
  },
  {
    question: "Yazıcı çalışmıyor",
    answer:
      "Yazdırma işleri sunucuda kuyruğa alınır ve Print Bridge tarafından yazıcıya gönderilir. Admin › Yazıcılar ekranından köprünün çevrimiçi olduğunu ve yazıcının eşleştiğini kontrol edin. Kuyrukta bekleyen veya hata alan işleri de aynı ekrandan görebilir, yeniden deneyebilirsiniz.",
  },
  {
    question: "Sipariş görünmüyor",
    answer:
      "Doğru şubede olduğunuzdan emin olun; siparişler şube bazlıdır. QR üzerinden gelen siparişler onay bekliyorsa Kasa ekranındaki QR sipariş kuyruğunda listelenir ve onaylanana kadar masaya işlenmez.",
  },
  {
    question: "Çalışan nasıl eklerim?",
    answer:
      "Admin › Çalışanlar ekranından yeni çalışan ekleyebilir, rol atayabilirsiniz. Roller yetkileri belirler: Yönetici, Müdür, Garson ve Kasiyer farklı ekranlara erişir. Çalışan ayrılırsa hesabı silmek yerine pasife almanız, geçmiş kayıtların bütünlüğü açısından önerilir.",
  },
  {
    question: "Sadakat programı nasıl çalışır?",
    answer:
      "Admin › Sadakat Programı ekranından kural tanımlarsınız (örn. belirli sayıda ziyaret veya ürün alımı sonrası ödül). Müşteri telefon numarasıyla kaydolur; kasiyer siparişe üyeliği bağladığında ilerleme otomatik işlenir ve ödül hak edildiğinde kullanılabilir hâle gelir.",
  },
  {
    question: "Şube nasıl değiştiririm?",
    answer:
      "Birden fazla şubeye yetkiniz varsa sağ üstteki hesap menüsünden şube değiştirebilirsiniz. Masalar, siparişler, stok ve raporlar seçili şubeye göre gösterilir.",
  },
  {
    question: "Teknik destek nasıl alırım?",
    answer:
      "support@dixoratech.com adresine yazın. Sorunu daha hızlı çözebilmemiz için işletme adınızı, hangi ekranda karşılaştığınızı ve mümkünse ekran görüntüsünü paylaşın. Faturalama ve üyelik konuları için info@dixoratech.com adresini kullanabilirsiniz.",
  },
];

export function SupportCenter() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="min-h-full bg-muted/20 p-4 sm:p-6">
      <PageHeader
        eyebrow="Yardım"
        title="Destek Merkezi"
        description="Sık karşılaşılan durumlar için hızlı çözümler ve Dixora destek ekibine ulaşma yolları."
        icon={LifeBuoy}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <SupportChannel
          icon={MessageSquareText}
          title="Teknik destek"
          description="Uygulama, yazıcı, QR menü ve operasyon sorunları"
          email={SUPPORT_EMAIL}
        />
        <SupportChannel
          icon={Mail}
          title="Üyelik ve faturalama"
          description="Abonelik, ödeme ve genel sorular"
          email={INFO_EMAIL}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-4 py-3.5">
            <h2 className="font-semibold">Sık sorulan sorular</h2>
          </div>
          <div className="divide-y">
            {faqs.map((faq, index) => {
              const open = openIndex === index;
              return (
                <div key={faq.question}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenIndex(open ? null : index)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/35"
                  >
                    <span className="text-sm font-medium">{faq.question}</span>
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                        open && "rotate-180",
                      )}
                    />
                  </button>
                  {open ? (
                    <p className="px-4 pb-4 text-sm leading-6 text-muted-foreground">
                      {faq.answer}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <p className="mt-5 text-center text-xs text-muted-foreground">
        Aradığınızı bulamadınız mı?{" "}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="font-semibold text-brand underline underline-offset-2"
        >
          {SUPPORT_EMAIL}
        </a>{" "}
        adresine yazın, en kısa sürede dönüş yapalım.
      </p>
    </div>
  );
}

function SupportChannel({
  icon: Icon,
  title,
  description,
  email,
}: {
  icon: typeof Mail;
  title: string;
  description: string;
  email: string;
}) {
  return (
    <a
      href={`mailto:${email}`}
      className="flex items-start gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-brand/30 hover:bg-brand-soft/25"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-brand/15 bg-brand-soft text-brand">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
        <span className="mt-1 block truncate text-sm font-medium text-brand">{email}</span>
      </span>
    </a>
  );
}
