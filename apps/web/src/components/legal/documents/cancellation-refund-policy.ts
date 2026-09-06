import type { LegalDocument } from "@/components/legal/legal-document";

export const CANCELLATION_REFUND_POLICY_VERSION = "2026-09-06-v2";

export const CANCELLATION_REFUND_POLICY: LegalDocument = {
  title: "İptal ve İade Politikası",
  version: CANCELLATION_REFUND_POLICY_VERSION,
  effectiveDate: "6 Eylül 2026",
  sections: [
    {
      heading: "1. 30 Günlük Deneme Süresi",
      paragraphs: [
        "Yeni açılan her işletme hesabı, herhangi bir ödeme yapılmaksızın 30 (otuz) takvim günü boyunca Standart Paket kapsamındaki modülleri kullanabilir. Deneme süresi boyunca herhangi bir ücret tahsil edilmez ve bu süre içinde vazgeçmeniz hâlinde herhangi bir yükümlülük doğmaz.",
      ],
    },
    {
      heading: "2. Ücretli Döneme Geçiş",
      paragraphs: [
        "Deneme süresinin sonunda Hizmet'e devam etmek isteyip istemediğinize siz karar verirsiniz. Ücretli döneme geçiş, yalnızca sizin açık onayınız ve ödemenizle gerçekleşir; onayınız olmadan otomatik bir tahsilat yapılmaz.",
        "Deneme süresi ödeme yapılmadan sona ererse hesabınız salt okunur/kısıtlı duruma alınabilir; verileriniz silinmez ve ödeme yapıldığında hesabınız yeniden etkinleştirilir.",
      ],
    },
    {
      heading: "3. Aboneliğin İptali",
      paragraphs: [
        "Ücretli aboneliğinizi, İşletme Paneli üzerinden veya bizimle iletişime geçerek, herhangi bir gerekçe göstermeksizin dilediğiniz zaman iptal edebilirsiniz.",
        "İptal talebiniz, mevcut fatura döneminin sonunda geçerli olur; iptal, o ana kadar tahakkuk etmiş ücretleri ortadan kaldırmaz.",
      ],
    },
    {
      heading: "4. İptal Sonrası Erişim",
      paragraphs: [
        "İptal ettiğiniz aboneliğiniz, ödemesi yapılmış mevcut fatura döneminin sonuna kadar tam kapsamıyla kullanılabilir durumda kalır. Dönem sona erdiğinde hesap, deneme süresi sonunda uygulanan aynı kısıtlı duruma alınır; verileriniz silinmez.",
      ],
    },
    {
      heading: "5. Mevcut Fatura Dönemi",
      paragraphs: [
        "Aylık fatura dönemi içinde yapılan iptal veya şube azaltma talepleri, cari dönemin ücretini geriye dönük olarak orantısal şekilde iade etmez; değişiklik bir sonraki fatura döneminden itibaren yansıtılır. Bu kural, aşağıdaki 7. ve 8. maddelerde tanımlanan istisnai iade hâllerini kapsamaz.",
      ],
    },
    {
      heading: "6. İşletme (B2B) ve Tüketici (B2C) Ayrımı",
      paragraphs: [
        "Dixora, esas olarak işletmelerin kendi ticari veya mesleki faaliyeti kapsamında kullandığı bir hizmettir. Bu şekilde kayıt olan işletmeler için iptal ve iade, 6502 sayılı Kanun'un tüketiciye tanıdığı cayma hakkına göre değil, işbu politikanın ve Üyelik ve SaaS Hizmet Sözleşmesi'nin sözleşmesel kurallarına göre yürütülür.",
        "Üye'nin somut olayda 6502 sayılı Tüketicinin Korunması Hakkında Kanun anlamında tüketici sıfatını taşıdığı istisnai hâllerde, o kapsamdaki emredici tüketici hakları (aşağıdaki 7. madde dâhil) saklıdır.",
      ],
    },
    {
      heading: "7. İade Koşulları ve Cayma Hakkı",
      paragraphs: [
        "Mesafeli Sözleşmeler Yönetmeliği'nin 15. maddesi uyarınca, onayınızla ifasına başlanan ve anında ifa edilen elektronik hizmetlerde cayma hakkı kullanılamayabilir. Tüketici sıfatını taşıdığınız istisnai hâllerde dahi bu istisna geçerli olur; buna rağmen, ücretli dönem için ödeme yaptığınız hâlde Hizmet'i fiilen kullanmaya başlamadıysanız, ödemeyi takip eden 14 (on dört) gün içinde iade talep edebilirsiniz.",
        "İade talepleri, KVKK Aydınlatma Metni'nde yer alan iletişim kanalı üzerinden yazılı olarak iletilir ve talebin gerekçesi ile ödeme kaydı birlikte değerlendirilir.",
      ],
    },
    {
      heading: "8. Yanlış veya Çift Tahsilat",
      paragraphs: [
        "Sistem hatası, mükerrer işlem veya benzeri bir teknik nedenle yanlış ya da çift tahsilat yapıldığının tespit edilmesi hâlinde, fazladan tahsil edilen tutar tam olarak ve gecikmeksizin iade edilir; bu, Üye'nin B2B veya tüketici sıfatından bağımsız olarak uygulanır.",
        "Böyle bir durumla karşılaştığınızı düşünüyorsanız dekont veya işlem kaydınızla birlikte KVKK Aydınlatma Metni'nde yer alan iletişim kanalından bize ulaşın; talebiniz en kısa sürede incelenir.",
      ],
    },
    {
      heading: "9. Ödeme Yöntemi",
      paragraphs: [
        "Ödemeleriniz şu anda yalnızca banka havalesi/EFT ile alınmaktadır; iadeler de aynı banka hesabına yapılır. Dixora, MVP sürümünde online kart ile ödeme (sanal POS) sunmamaktadır ve karttan otomatik tahsilat yapılmamaktadır.",
        "Online kart ile ödeme ileride devreye alınırsa, o kanala özgü iade süreci ve süreleri ayrıca duyurulur ve bu politika güncellenir.",
      ],
    },
    {
      heading: "10. Hesap Silmenin Abonelik ve Fatura İlişkisi",
      paragraphs: [
        "İşletme hesabınızın kalıcı olarak silinmesini talep etmeniz, aboneliğinizin iptal edilmiş olmasını gerektirir; aktif bir ücretli dönemde tahakkuk etmiş ancak ödenmemiş bakiye varsa, kalıcı silme talebi bu bakiyeyi ortadan kaldırmaz.",
        "Kalıcı silme, geri döndürülemez bir işlemdir ve gerçekleştirildikten sonra o işletmeye ait veriler üzerinden herhangi bir iade veya geri yükleme talebi karşılanamaz. Fatura kayıtları, yasal saklama yükümlülüğü gereği ayrıca muhafaza edilir.",
      ],
    },
  ],
};
