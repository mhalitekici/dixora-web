import type { LegalDocument } from "@/components/legal/legal-document";

export const PRIVACY_POLICY_VERSION = "2026-09-06-v1";

/**
 * User-facing companion to the KVKK Aydınlatma Metni.
 *
 * The KVKK notice is the formal legal disclosure required by law; this page
 * explains the same facts in plainer terms — what is collected, why, and what
 * choices exist — without restating the statutory rights list.
 */
export const PRIVACY_POLICY: LegalDocument = {
  title: "Gizlilik Politikası",
  version: PRIVACY_POLICY_VERSION,
  effectiveDate: "6 Eylül 2026",
  sections: [
    {
      heading: "1. Bu Politika Ne Hakkında",
      paragraphs: [
        "Bu Gizlilik Politikası, Dixora'yı kullanan işletmelerin ve çalışanlarının bilgilerini nasıl kullandığımızı, güvenliğini nasıl sağladığımızı ve hangi tercihlere sahip olduğunuzu anlaşılır bir dille açıklar.",
        "Kişisel verilerin hangi hukuki sebeple ve hangi kapsamda işlendiğine dair ayrıntılı ve bağlayıcı metin, KVKK Aydınlatma Metni'dir; bu iki metin çelişirse KVKK Aydınlatma Metni esas alınır.",
      ],
    },
    {
      heading: "2. Hangi Bilgileri Neden Kullanıyoruz",
      paragraphs: [
        "Hesap oluştururken verdiğiniz işletme adı, yetkili adı, e-posta ve telefon bilgilerini işletmenizi tanımlamak, sizinle iletişim kurmak ve hesabınızı güvenli tutmak için kullanırız.",
        "İşletme Paneli üzerinden oluşturduğunuz şube, çalışan, ürün, sipariş ve fatura kayıtlarını, tam olarak sizin talep ettiğiniz hizmeti (masa/sipariş yönetimi, QR menü, raporlama vb.) sunmak için işleriz; bu veriler işletmenize aittir.",
        "Oturum açma zamanı, IP adresi ve cihaz bilgisi gibi teknik kayıtları, hesabınızı yetkisiz erişime karşı korumak ve olası kötüye kullanımı tespit etmek için tutarız.",
      ],
    },
    {
      heading: "3. Hesap Güvenliği",
      paragraphs: [
        "Parolanız geri döndürülemez biçimde (hash) saklanır; Dixora çalışanları dahi parolanızı düz metin olarak göremez.",
        "Şüpheli bir oturum fark ederseniz İşletme Paneli üzerinden tüm oturumları sonlandırabilir veya parolanızı değiştirebilirsiniz.",
      ],
    },
    {
      heading: "4. Hizmet Sağlayıcılarımız",
      paragraphs: [
        "Hizmet'i çalıştırabilmek için bazı işlevleri güvendiğimiz üçüncü taraf sağlayıcılar üzerinden yürütürüz: e-posta gönderimi (kayıt doğrulama kodu, sadakat bildirimleri), etkinleştirildiğinde kısa mesaj/OTP doğrulaması ve bulut sunucu/nesne depolama altyapısı.",
        "Bu sağlayıcılara yalnızca ilgili işlevi yerine getirebilmeleri için gerekli olan asgari veri aktarılır; sağlayıcılar verilerinizi kendi pazarlama amaçları için kullanamaz.",
      ],
    },
    {
      heading: "5. Kullanım Verileri",
      paragraphs: [
        "Dixora bugün itibarıyla herhangi bir üçüncü taraf analitik, reklam veya izleme aracı (ör. Google Analytics, Meta Pixel, Hotjar) kullanmamaktadır. Toplanan teknik kullanım kayıtları, yalnızca Hizmet'in güvenliği ve arıza tespiti amacıyla, birinci taraf (Dixora'nın kendi sunucuları) tarafından tutulur.",
        "Tarayıcınızda tutulan tercihler (tema, dil, ses bildirimi gibi) ve bunların çerez/yerel depolama ile ilişkisi ayrıca Çerez Politikası'nda açıklanır.",
      ],
    },
    {
      heading: "6. Tercihleriniz",
      paragraphs: [
        "Ticari elektronik ileti almak isteyip istemediğinizi kayıt sırasında ayrı ve isteğe bağlı bir onay kutusuyla belirlersiniz; bu tercihi istediğiniz zaman bizimle iletişime geçerek değiştirebilirsiniz.",
        "Tarayıcı bazlı çerez/analitik tercihlerinizi Çerez Politikası sayfasındaki \"Çerez Tercihleri\" aracıyla yönetebilirsiniz.",
      ],
    },
    {
      heading: "7. Hesap Silme",
      paragraphs: [
        "İşletme hesabınızın kalıcı olarak silinmesini talep edebilirsiniz. Kalıcı silme, işletmenize ait şube, çalışan, ürün, sipariş, QR menü ve kampanya kayıtları dâhil verilerin geri döndürülemez şekilde kaldırılması anlamına gelir; yasal saklama yükümlülüğü bulunan fatura kayıtları hariçtir.",
        "Silme talebi, kimlik doğrulaması yapılarak ve yalnızca yetkili platform yöneticisi tarafından uygulanır.",
      ],
    },
    {
      heading: "8. İletişim",
      paragraphs: [
        "Bu politika veya verilerinizin işlenmesi hakkında sorularınız için KVKK Aydınlatma Metni'nde yer alan iletişim bilgilerini kullanabilirsiniz.",
      ],
    },
  ],
};
