import type { LegalDocument } from "@/components/legal/legal-document";

// Bumped whenever this notice's substance changes. The registration form
// records which version an applicant acknowledged, alongside the separate
// membership agreement version.
export const KVKK_NOTICE_VERSION = "2026-09-06-v2";

/**
 * 6698 sayılı KVKK m.10 uyarınca aydınlatma metni.
 *
 * İçerik, repo genelinde gerçekte toplanan/işlenen veri akışına göre
 * yazılmıştır: kayıt formu alanları, işletme/şube/çalışan hesap verileri,
 * IP/oturum/audit kayıtları, QR menü kullanım verileri (sipariş, hesap
 * isteği), destek talepleri ve fatura/ödeme dekontu bilgileri. Gerçekte
 * kullanılmayan bir veri kategorisi veya aktarım burada belirtilmez.
 */
export const KVKK_NOTICE: LegalDocument = {
  title: "KVKK Aydınlatma Metni",
  version: KVKK_NOTICE_VERSION,
  effectiveDate: "6 Eylül 2026",
  sections: [
    {
      heading: "1. Veri Sorumlusu",
      paragraphs: [
        "6698 sayılı Kişisel Verilerin Korunması Kanunu (\"KVKK\") uyarınca, aşağıda belirtilen kişisel verileriniz veri sorumlusu sıfatıyla [ŞİRKET TİCARİ UNVANI] (\"Dixora\") tarafından işbu aydınlatma metninde açıklanan kapsamda işlenmektedir.",
        "Veri sorumlusuna ilişkin iletişim ve sicil bilgileri: [ŞİRKET TİCARİ UNVANI], VKN: [VKN], MERSİS No: [MERSİS NO], Adres: [ADRES], KVKK başvuruları için: [KVKK İLETİŞİM E-POSTASI].",
      ],
    },
    {
      heading: "2. İşlenen Kişisel Veri Kategorileri",
      paragraphs: [
        "Dixora, Hizmet'in sunulması kapsamında aşağıdaki kişisel veri kategorilerini işler. Bu liste, sistemde gerçekten toplanan veri türlerini yansıtır; burada sayılmayan bir veri kategorisi işlenmez.",
      ],
      list: [
        "Kimlik bilgileri: işletme yetkilisi ve çalışan hesaplarının ad-soyad bilgisi.",
        "İletişim bilgileri: e-posta adresi, telefon numarası.",
        "İşletme bilgileri: işletme unvanı, işletme türü, şube adı/adresi, saat dilimi.",
        "Hesap ve kimlik doğrulama bilgileri: kullanıcı adı, şifrelenmiş parola (hash), oturum/erişim jetonları, güvenilir cihaz kaydı.",
        "İşlem güvenliği bilgileri: IP adresi, tarayıcı/cihaz bilgisi (user-agent), oturum ve giriş kayıtları, denetim (audit) kayıtları.",
        "Müşteri işlem bilgileri: QR menü üzerinden oluşturulan sipariş ve hesap talebi kayıtları, masa/oturum bilgisi.",
        "Sadakat programı verileri: işletmenin kendi müşterileri için topladığı ve Dixora'nın işletme adına barındırdığı ad, telefon/e-posta ve işlem geçmişi (bu veriler bakımından veri sorumlusu ilgili işletmedir; ayrıntı için 3. madde).",
        "Finansal bilgiler: fatura numarası, tutar, ödeme durumu ve banka havalesi/EFT dekontuna ilişkin bilgiler. Dixora şu anda (MVP aşamasında) kart bilgisi toplamaz veya saklamaz; ödemeler yalnızca banka havalesi/EFT yoluyla alınır. Online kart ile ödeme ileride devreye alınırsa, işlenecek yeni veri kategorileri ve ilgili ödeme sağlayıcısı bu metne eklenerek önceden duyurulur.",
        "Destek ve iletişim kayıtları: Dixora'ya iletilen destek talepleri ve yazışma içerikleri.",
      ],
    },
    {
      heading: "3. Sıfatınıza Göre Veri Sorumlusu Ayrımı",
      paragraphs: [
        "İşbu aydınlatma metni, Dixora'nın kendi veri sorumlusu sıfatıyla işlediği verileri (işletme yetkilisi ve çalışan hesap verileri, işlem güvenliği ve fatura verileri) kapsar.",
        "QR menü üzerinden sipariş veren veya sadakat programına kaydolan son müşterilere ait kişisel verilerin işlenmesinde veri sorumlusu, ilgili müşteriye hizmet sunan işletmedir (Üye); Dixora bu veriler bakımından yalnızca işletmenin talimatıyla hareket eden veri işleyen konumundadır. Bu kapsamdaki haklar için ilgili işletmeye başvurulması gerekir.",
      ],
    },
    {
      heading: "4. Kişisel Verilerin İşlenme Amaçları",
      paragraphs: [
        "Kişisel verileriniz; işletme hesabının oluşturulması ve yönetilmesi, Hizmet'in sunulması ve sürdürülmesi, kimlik doğrulama ve hesap güvenliğinin sağlanması, faturalandırma ve tahsilat süreçlerinin yürütülmesi, yasal yükümlülüklerin yerine getirilmesi, destek taleplerinin yanıtlanması, Hizmet'in ve altyapının güvenliğinin izlenmesi ile kötüye kullanımın önlenmesi, açık rıza verilmesi hâlinde tanıtım ve kampanya bilgilendirmesi amaçlarıyla işlenir.",
      ],
    },
    {
      heading: "5. Hukuki Sebepler",
      paragraphs: [
        "Kişisel verileriniz, KVKK'nın 5. ve 6. maddelerinde yer alan aşağıdaki hukuki sebeplere dayanılarak işlenir: bir sözleşmenin kurulması veya ifasıyla doğrudan ilgili olması (üyelik sözleşmesinin kurulması ve Hizmet'in sunulması), Dixora'nın hukuki yükümlülüğünü yerine getirmesi (fatura ve muhasebe kayıtlarının tutulması), bir hakkın tesisi, kullanılması veya korunması için zorunlu olması (güvenlik ve denetim kayıtları), Dixora'nın meşru menfaati için zorunlu olması (hizmet güvenliğinin sağlanması, dolandırıcılığın önlenmesi) ve açık rızanızın bulunması (opsiyonel ticari elektronik ileti izni).",
      ],
    },
    {
      heading: "6. Kişisel Verilerin Toplanma Yöntemi",
      paragraphs: [
        "Kişisel verileriniz; kayıt formu, İşletme Paneli üzerinden yapılan girişler, oturum açma işlemleri ve destek talepleri gibi kanallar üzerinden elektronik ortamda, doğrudan sizin tarafınızdan sağlanan bilgiler ile Hizmet'in kullanımı sırasında otomatik olarak (IP adresi, cihaz/tarayıcı bilgisi, işlem zaman damgası) toplanır.",
      ],
    },
    {
      heading: "7. Kişisel Verilerin Aktarımı",
      paragraphs: [
        "Dixora'nın sunucu, veritabanı ve dosya depolama altyapısı kendi kontrolündeki sistemlerde (self-hosted) çalışır; bu altyapı bileşenleri KVKK anlamında ayrı bir veri işleyene aktarım değil, Dixora'nın kendi teknik altyapısıdır.",
        "Bunun dışında, etkinleştirildiğinde kişisel verileriniz şu üçüncü taraf hizmet sağlayıcılarına, yalnızca belirtilen işlevi yerine getirebilmeleri için gerekli ölçüde aktarılabilir: e-posta gönderim sağlayıcısı (kayıt doğrulama kodu ve bildirimler için) ve kısa mesaj/OTP doğrulama sağlayıcısı. Bu sağlayıcılardan hangisinin fiilen etkin olduğu zaman içinde değişebilir; hiçbiri etkin değilse ilgili işlev (ör. SMS doğrulama) sunulmaz.",
        "Kişisel verileriniz, yetkili kamu kurum ve kuruluşlarının talebi hâlinde ve yalnızca mevzuatın öngördüğü sınırlar içinde ilgili mercilere aktarılır. Bunların dışında kişisel verileriniz üçüncü kişilerle pazarlama amacıyla paylaşılmaz veya satılmaz.",
        "Aktarım yapılan hizmet sağlayıcılar Türkiye içinde veya yurt dışında konumlanmış olabilir; yurt dışına aktarım söz konusu olduğunda KVKK'nın 9. maddesindeki şartlara uyulur.",
        "Dixora ileride online ödeme (sanal POS) gibi yeni bir hizmet sağlayıcı ile çalışmaya başlarsa, bu sağlayıcı ve aktarılacak veri kategorileri devreye alınmadan önce bu metne eklenerek duyurulur; bu potansiyel gelecek kullanım, yukarıdaki güncel aktarım listesinden ayrıdır.",
      ],
    },
    {
      heading: "8. Saklama Süresi",
      paragraphs: [
        "Kişisel verileriniz, işlenme amaçlarının gerektirdiği süre boyunca ve ilgili mevzuatta öngörülen zamanaşımı sürelerine (özellikle vergi ve ticaret mevzuatındaki saklama yükümlülüklerine) uygun olarak saklanır.",
        "Hesabınızın kalıcı olarak silinmesi talep edildiğinde, yasal saklama yükümlülüğü bulunan veriler (fatura kayıtları gibi) hariç olmak üzere kişisel verileriniz sistemlerden silinir, yok edilir veya anonim hâle getirilir.",
      ],
    },
    {
      heading: "9. Güvenlik",
      paragraphs: [
        "Dixora, kişisel verilerin hukuka aykırı olarak işlenmesini ve verilere hukuka aykırı erişimi önlemek amacıyla erişim kontrolü, şifreleme, oturum yönetimi ve düzenli güvenlik güncellemeleri gibi uygun teknik ve idari tedbirleri uygular.",
      ],
    },
    {
      heading: "10. İlgili Kişinin Hakları",
      paragraphs: [
        "KVKK'nın 11. maddesi uyarınca, Dixora'ya başvurarak kişisel verilerinizin işlenip işlenmediğini öğrenme, işlenmişse buna ilişkin bilgi talep etme, işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme, yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme, eksik veya yanlış işlenmişse düzeltilmesini isteme, işlenmesini gerektiren sebeplerin ortadan kalkması hâlinde silinmesini veya yok edilmesini isteme, düzeltme/silme işlemlerinin aktarılan üçüncü kişilere bildirilmesini isteme, işlenen verilerin münhasıran otomatik sistemler ile analiz edilmesi nedeniyle aleyhinize bir sonuç ortaya çıkmasına itiraz etme ve kanuna aykırı işleme sebebiyle zarara uğramanız hâlinde zararın giderilmesini talep etme haklarına sahipsiniz.",
      ],
    },
    {
      heading: "11. Başvuru Yöntemi",
      paragraphs: [
        "Yukarıda sayılan haklarınıza ilişkin taleplerinizi, kimliğinizi tevsik edici belgelerle birlikte [KVKK İLETİŞİM E-POSTASI] adresine e-posta yoluyla veya [ADRES] adresine yazılı olarak iletebilirsiniz.",
        "Talebiniz, niteliğine göre en kısa sürede ve en geç KVKK'da öngörülen süre içinde ücretsiz olarak sonuçlandırılır; işlemin ayrıca bir maliyet gerektirmesi hâlinde Kişisel Verileri Koruma Kurulu tarafından belirlenen tarifedeki ücret talep edilebilir.",
      ],
    },
  ],
};
