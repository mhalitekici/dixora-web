"use client"

import {
  ChevronDown,
  LifeBuoy,
  Mail,
  MessageSquareText,
  Search,
} from "lucide-react"
import { useState } from "react"
import Link from "next/link"

import { PageHeader } from "@/components/shared/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const SUPPORT_EMAIL = "support@dixoratech.com"
export const INFO_EMAIL = "info@dixoratech.com"

type Faq = { question: string; answer: string }

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
    question: "Sadakat ve kampanya nasıl çalışır?",
    answer:
      "Kampanyalar ve Sadakat başlığından teklif veya ödül kuralı tanımlayın. Müşteri e-postasını doğrulayarak üye olur. Üyelik kodu siparişe bağlanır; ilerleme uygun siparişin ödemesi tamamlanınca artar. Kazanılan ikram e-postayla bildirilir; kasiyer bu e-postadaki 6 haneli ödül koduyla ikramı uygular. Kampanya duyuruları yalnız e-posta izni veren üyelere gönderilir.",
  },
  {
    question: "Şube nasıl değiştiririm?",
    answer:
      "Birden fazla şubeye yetkiniz varsa üst çubuktaki işletme ve şube adına basıp şubeyi seçin. Masalar, siparişler, stok ve raporlar seçili şubeye göre yenilenir. Yazıcı ekranı da bağlantıları bu şube kapsamında gösterir.",
  },
  {
    question: "Teknik destek nasıl alırım?",
    answer:
      "support@dixoratech.com adresine yazın. Sorunu daha hızlı çözebilmemiz için işletme adınızı, hangi ekranda karşılaştığınızı ve mümkünse ekran görüntüsünü paylaşın. Faturalama ve üyelik konuları için info@dixoratech.com adresini kullanabilirsiniz.",
  },
  {
    question: "Yazıcı entegrasyonuna nasıl başlarım?",
    answer:
      "Yazıcılar ekranında doğru şubeyi seçin. Yazıcının kurulu olduğu bilgisayara Dixora Print Bridge uygulamasını indirin. Bilgisayar bağla ile oluşturulan kodu ve ekranda gösterilen API adresini uygulamaya girin. Bilgisayar çevrimiçi göründüğünde mutfak, bar ve kasa cihazlarını yerel yazıcılarla eşleştirin. Son olarak test çıktısını ve kağıdı kontrol edin.",
  },
  {
    question: "Vardiyamı nasıl devrederim veya kapatırım?",
    answer:
      "Kasa › Vardiya ekranında mevcut kasiyeri ve bakiyeyi kontrol edin. Devirde teslim alan kasiyerin bilgilerini ve doğrulama PIN'ini girin. Kapanışta sayılan nakit ve istenen ödeme toplamlarını kaydedin. Açık vardiya varken kullanıcı değiştirdiğinizde uygulama devir veya kapanış konusunda sizi yönlendirir.",
  },
  {
    question: "Ödül e-postası gelmedi, ne yapmalıyım?",
    answer:
      "Önce uygun siparişin tamamen ödendiğini ve müşterinin doğrulanmış e-posta adresini kontrol edin. Yönetici Bildirimler ekranında gönderim durumunu ve yeniden deneme zamanını görebilir. Spam klasörünü de kontrol edin. Kullanılmış veya geri alınmış ödüller için yeni bir hazır ödül bildirimi gönderilmez.",
  },
]

export function SupportCenter() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)
  const [search, setSearch] = useState("")
  const term = search.trim().toLocaleLowerCase("tr")

  return (
    <main
      id="dixora-main"
      tabIndex={-1}
      className="mx-auto min-h-dvh w-full max-w-5xl bg-muted/20 p-4 sm:p-6"
    >
      <PageHeader
        eyebrow="Yardım"
        title="Destek Merkezi"
        description="Sık karşılaşılan durumlar için hızlı çözümler ve Dixora destek ekibine ulaşma yolları."
        icon={LifeBuoy}
        actions={
          <Button variant="outline" render={<Link href="/login" />}>
            Panele dön
          </Button>
        }
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
            <div className="relative mt-3">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                aria-label="Yardım konularında ara"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Yazıcı, ödül, vardiya…"
                className="pl-9"
                type="search"
              />
            </div>
          </div>
          <div className="divide-y">
            {faqs.map((faq, index) => {
              if (
                term &&
                !`${faq.question} ${faq.answer}`
                  .toLocaleLowerCase("tr")
                  .includes(term)
              )
                return null
              const open = openIndex === index
              return (
                <div key={faq.question}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`faq-answer-${index}`}
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
                    <p
                      id={`faq-answer-${index}`}
                      className="px-4 pb-4 text-sm leading-6 text-muted-foreground"
                    >
                      {faq.answer}
                    </p>
                  ) : null}
                </div>
              )
            })}
            {!faqs.some((faq) =>
              `${faq.question} ${faq.answer}`
                .toLocaleLowerCase("tr")
                .includes(term),
            ) ? (
              <p role="status" className="p-4 text-sm text-muted-foreground">
                Bu aramaya uygun yardım konusu bulunamadı. Farklı bir kelime
                deneyin.
              </p>
            ) : null}
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
    </main>
  )
}

function SupportChannel({
  icon: Icon,
  title,
  description,
  email,
}: {
  icon: typeof Mail
  title: string
  description: string
  email: string
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
        <span className="block text-sm text-muted-foreground">
          {description}
        </span>
        <span className="mt-1 block truncate text-sm font-medium text-brand">
          {email}
        </span>
      </span>
    </a>
  )
}
