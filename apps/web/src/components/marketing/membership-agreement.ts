import {
  ADDITIONAL_BRANCH_PRICE_LABEL_VAT_INCLUSIVE,
  BASE_MONTHLY_PRICE_LABEL_VAT_INCLUSIVE,
  INCLUDED_BRANCHES,
} from "@/lib/pricing";
import type { LegalDocument, LegalSection } from "@/components/legal/legal-document";

// Bumped whenever the binding text changes — acceptances are stored against a
// version, so an older signature must never be read as consent to newer terms.
export const MEMBERSHIP_AGREEMENT_VERSION = "2026-09-06-v4";
export const MEMBERSHIP_AGREEMENT_EFFECTIVE_DATE = "6 Eylül 2026";

export type AgreementSection = LegalSection;

export const MEMBERSHIP_AGREEMENT_TITLE = "Dixora Üyelik ve SaaS Hizmet Sözleşmesi";

export const MEMBERSHIP_AGREEMENT_SECTIONS: AgreementSection[] = [
  {
    heading: "1. Taraflar",
    paragraphs: [
      "İşbu Üyelik ve SaaS Hizmet Sözleşmesi (\"Sözleşme\"); bulut tabanlı restoran/kafe/bar/otel işletme operasyon yazılımı hizmetini sağlayan Dixora (\"Hizmet Sağlayıcı\", \"Dixora\") ile bu hizmete kayıt olarak erişim talep eden işletme yetkilisi (\"Üye\", \"İşletme\") arasında, Üye'nin kayıt formunu onaylaması anında elektronik ortamda kurulur.",
      "Hizmet, esas olarak işletmelerin kendi ticari veya mesleki faaliyetleri kapsamında kullanması için tasarlanmıştır; Üye, Hizmet'e ticari/mesleki amaçla kayıt olduğunu kabul eder. Üye'nin somut olayda 6502 sayılı Tüketicinin Korunması Hakkında Kanun anlamında tüketici sıfatını taşıdığı hâllerde, o kapsamdaki emredici tüketici hükümleri saklıdır (bkz. madde 30).",
      "Üye, kayıt formuna girdiği bilgilerin (işletme unvanı, yetkili adı, e-posta, telefon ve benzeri) doğru, güncel ve kendisine ait olduğunu kabul ve beyan eder. Yanlış veya yanıltıcı bilgi verilmesinden doğacak sonuçlardan Üye sorumludur.",
    ],
  },
  {
    heading: "2. Tanımlar",
    paragraphs: [
      "Aşağıdaki tanımlar işbu Sözleşme'nin tamamında aynı anlamda kullanılır.",
    ],
    list: [
      "Hizmet: Dixora'nın Üye'ye bulut üzerinden sunduğu masa/sipariş yönetimi, mutfak ekranı, kasa, QR menü, stok, raporlama, sadakat ve ilgili yardımcı modüllerden oluşan yazılım-hizmet (SaaS) bütünü.",
      "İşletme Paneli: Üye'nin ve yetkilendirdiği çalışanların Hizmet'i yönettiği web tabanlı yönetim arayüzü.",
      "Şube: Üye'nin İşletme Paneli üzerinden tanımladığı, kendi masa/sipariş/stok akışına sahip her bir fiziksel işletme birimi.",
      "Aktif Şube: Üye tarafından arşivlenmemiş (pasife alınmamış) ve ücretlendirmeye tabi olan şube.",
      "Çalışan Hesabı: Üye tarafından oluşturulan ve belirli bir role bağlı yetkilerle sınırlandırılan kullanıcı hesabı (garson, kasiyer, mutfak vb.).",
      "QR Menü: Üye'nin kendi ürün, fiyat ve kampanya bilgilerini son müşterilerine QR kod üzerinden dijital olarak sunduğu modül.",
      "Standart Paket: İşbu Sözleşme'de tanımlanan, tek bir aylık ücret karşılığında belirli sayıda şubeyi kapsayan temel abonelik paketi.",
      "İçerik: Üye'nin veya çalışanlarının Hizmet'e yüklediği her türlü metin, görsel, logo, ürün fotoğrafı, fiyat, açıklama ve benzeri veri.",
    ],
  },
  {
    heading: "3. Sözleşmenin Konusu",
    paragraphs: [
      "Sözleşme'nin konusu; Dixora'nın Üye'ye sunduğu Hizmet'in kullanım şartlarının, ücretlendirme esaslarının ve tarafların karşılıklı hak ve yükümlülüklerinin belirlenmesidir.",
      "Hizmet, 6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun ve ilgili mevzuat kapsamında elektronik ortamda, uzaktan erişimle sunulan bir bilişim hizmetidir.",
    ],
  },
  {
    heading: "4. Hizmetin Kapsamı",
    paragraphs: [
      "Hizmet; masa ve sipariş yönetimi, mutfak ekranı ve hazırlık istasyonları, kasa ve ödeme kaydı, QR menü ve QR üzerinden sipariş/hesap talebi, stok ve reçete takibi, raporlama, rol ve yetki yönetimi, sadakat programı, kampanya yönetimi, işletme türüne göre otel odası/konaklama takibi gibi modülleri, Üye'nin abone olduğu pakete ve etkinleştirdiği modüllere göre kapsar.",
      "Dixora, MVP (erken) sürümünde ödeme kaydedici cihaz (ÖKC) entegrasyonu, mali cihazla otomatik çalışma, resmi fiş/fatura kesme veya başka bir mali belge düzenleme hizmeti sunmaz; \"kasa\" modülü işletme içi ödeme kaydı ve raporlama amaçlıdır, yasal mali belge üretmez. Üye'nin resmi belge (fiş/fatura) düzenleme yükümlülüğü, kendi mali mevzuatına tabi ayrı araçlarla yerine getirilir.",
      "Dixora, Hizmet kapsamındaki modülleri ürün geliştirme sürecinin doğal bir parçası olarak genişletebilir, iyileştirebilir veya güncelleyebilir; temel işlevsellik korunmak kaydıyla arayüz ve akışlarda değişiklik yapma hakkını saklı tutar. İleride sunulabilecek ek özellikler (mali entegrasyonlar dâhil) ayrıca duyurulur ve o özelliğe özgü kullanım koşullarına tabi olabilir.",
    ],
  },
  {
    heading: "5. Hesap Oluşturma ve Kayıt",
    paragraphs: [
      "Hizmet'e kayıt, işletme adı, işletme türü, yetkili adı, e-posta, telefon ve parola bilgilerinin girilmesi ile başlar ve e-posta adresine gönderilen doğrulama kodunun onaylanmasıyla tamamlanır; işletme hesabı yalnızca doğrulama tamamlandıktan sonra oluşturulur.",
      "Doğrulanmamış veya yarım kalan kayıt denemeleri herhangi bir işletme hesabı, veri kaydı veya yükümlülük doğurmaz.",
    ],
  },
  {
    heading: "6. Kullanıcı ve Hesap Güvenliği",
    paragraphs: [
      "Üye, hesabına ait parola ve giriş bilgilerini gizli tutmakla, üçüncü kişilerle paylaşmamakla ve hesabı üzerinden gerçekleştirilen tüm işlemlerden sorumlu olduğunu kabul eder.",
      "Hesap güvenliğinin ihlal edildiğinden şüphelenilmesi hâlinde Üye, durumu gecikmeksizin Dixora'ya bildirir ve mevcut oturumları İşletme Paneli üzerinden sonlandırabilir. Dixora, şüpheli erişim tespit ettiğinde hesabı veya oturumu geçici olarak kısıtlayabilir.",
    ],
  },
  {
    heading: "7. İşletme, Şube ve Çalışan Hesapları",
    paragraphs: [
      "Kayıt sırasında oluşturulan hesap, işletmenin tüm şubeleri ve çalışan hesapları üzerinde tam yetkiye sahip \"işletme sahibi\" hesabıdır. Üye, ihtiyaç duyduğu kadar şube ve çalışan hesabı oluşturabilir; her çalışan hesabı yalnızca kendisine tanımlanan şube(ler) ve rol kapsamında Hizmet'e erişebilir.",
      "Üye, çalışan hesaplarının açılması, yetkilendirilmesi, pasife alınması ve silinmesinden bizzat sorumludur. İşten ayrılan bir çalışanın erişiminin kapatılmaması nedeniyle doğacak sonuçlardan Dixora sorumlu tutulamaz.",
    ],
  },
  {
    heading: "8. Yetkilendirme ve Rol Yönetimi",
    paragraphs: [
      "Hizmet, işletme sahibi, şube yöneticisi, kasiyer, garson ve benzeri önceden tanımlı roller ile bu rollere bağlı izin kümeleri üzerinden çalışır; Üye, rol atamalarını kendi organizasyon yapısına göre İşletme Paneli üzerinden yapar.",
      "Dixora personeli, Üye'nin hesabına ancak Üye'nin talebiyle başlatılan, süreli ve kayıt altına alınan bir destek oturumu (\"denetlenebilir destek modu\") kapsamında ve yalnızca talep edilen sorunu çözmek amacıyla erişebilir.",
    ],
  },
  {
    heading: "9. 30 Günlük Ücretsiz Deneme Süresi",
    paragraphs: [
      "Yeni kayıt olan işletmelere 30 (otuz) takvim günü süreyle, herhangi bir ücret talep edilmeksizin deneme süresi tanınır. Deneme süresi, işletme hesabının oluşturulduğu tarihte başlar.",
      "Deneme süresi boyunca Üye, Standart Paket kapsamındaki modülleri sınırlama olmaksızın kullanabilir. Deneme süresinin sona ermesinden önce Üye'nin açık onayı ve ödemesi olmaksızın herhangi bir tahsilat yapılmaz.",
    ],
  },
  {
    heading: "10. Standart Paket ve KDV Dahil Fiyatlandırma",
    paragraphs: [
      `Deneme süresinin sonunda Hizmet'e kesintisiz devam etmek isteyen Üye, güncel Standart Paket aylık ücreti olan ${BASE_MONTHLY_PRICE_LABEL_VAT_INCLUSIVE} üzerinden ödeme yapar. Bu ücrete ${INCLUDED_BRANCHES} (bir) Aktif Şube dahildir.`,
      "Dixora'nın ilan ettiği tüm fiyatlar Katma Değer Vergisi dahil (KDV dahil) olarak gösterilir; Üye'den ilan edilen tutarın üzerinde ayrıca KDV talep edilmez. Güncel fiyat, Dixora tarafından İşletme Paneli veya resmi iletişim kanalları üzerinden önceden duyurulmadıkça değiştirilmez.",
    ],
  },
  {
    heading: "11. Ek Aktif Şube Ücretlendirmesi",
    paragraphs: [
      `Üye'nin birden fazla şube kullanması hâlinde, pakete dahil olan şube sayısını aşan her bir Aktif Şube için aylık ${ADDITIONAL_BRANCH_PRICE_LABEL_VAT_INCLUSIVE} ek ücret uygulanır.`,
      "Aylık toplam ücret, temel paket ücretine aktif ek şube sayısı ile ek şube ücretinin çarpımının eklenmesiyle hesaplanır. Üye tarafından arşivlenen (pasife alınan) şubeler ücretlendirmeye dahil edilmez; ücretlendirme yalnızca o dönemde Aktif Şube olan şubeler üzerinden yapılır.",
      "Şube ekleme veya arşivleme işlemleri Üye'nin kendi İşletme Paneli üzerinden gerçekleştirilir ve güncel aylık tutar bir sonraki fatura döneminde yansıtılır. Üye, şube eklemeden önce panelde gösterilen güncel aylık tutarı görüntüleyebilir.",
    ],
  },
  {
    heading: "12. Faturalandırma ve Ödeme",
    paragraphs: [
      "Ücretli dönemde faturalandırma aylık dönemler hâlinde yapılır; her fatura döneminin tutarı, dönem başındaki Aktif Şube sayısına göre hesaplanır.",
      "Ücretli döneme geçiş ve her fatura dönemine ait ödeme, Dixora tarafından o sırada sunulan güncel ödeme kanalı üzerinden yürütülür; bu kanal hâlihazırda banka havalesi/EFT'dir. Dixora, Üye'ye ait kayıtlı bir kart bilgisi tutmaz ve Üye'nin banka veya kredi kartından otomatik tahsilat yapmaz; her ödeme Üye'nin kendi işlemiyle ve açık onayıyla gerçekleşir.",
      "Ödemenin Dixora kayıtlarına yansımasını takiben (banka havalesi/EFT'de dekontun doğrulanmasının ardından) hesap erişimi teyit edilir veya yeniden aktif hâle getirilir. Online kart ile ödeme (sanal POS) gibi ek bir kanal ileride devreye alınırsa, o kanala özgü şartlar (kart bilgisi işlenmesi, ödeme sağlayıcısı vb.) devreye alınmadan önce ayrıca duyurulur ve bu Sözleşme'ye eklenir; bu, güncel ödeme şeklinin bir parçası değildir.",
    ],
  },
  {
    heading: "13. Yenileme ve Abonelik Değişiklikleri",
    paragraphs: [
      "Ücretli abonelik, Üye tarafından iptal edilmediği sürece bir sonraki fatura dönemi için de devam etmesi esas alınır; ancak bu, kayıtlı bir ödeme aracından otomatik çekim yapılacağı anlamına gelmez. Her fatura dönemi için Dixora bir fatura/ödeme bildirimi iletir ve Üye ödemeyi güncel ödeme kanalı (hâlihazırda banka havalesi/EFT) üzerinden kendisi gerçekleştirir.",
      "İlgili dönemin ödemesi süresinde yapılmazsa hesap, 14. madde (Askıya Alma) hükümlerine göre kısıtlanabilir; bu durum kendiliğinden bir kart çekimini tetiklemez.",
      "Üye, şube sayısını artırarak veya azaltarak (arşivleyerek) abonelik kapsamını değiştirebilir; değişiklik bir sonraki fatura döneminden itibaren geçerli olur.",
    ],
  },
  {
    heading: "14. Askıya Alma",
    paragraphs: [
      "Dixora; ödeme yükümlülüğünün süresinde yerine getirilmemesi, deneme süresinin ödeme yapılmaksızın sona ermesi veya işbu Sözleşme'nin ihlal edilmesi hâllerinde, mümkün olduğunca önceden bildirimde bulunarak hesabı askıya alabilir.",
      "Askıya alınan hesaplarda veriler silinmez; hesap salt okunur veya kısıtlı duruma alınabilir. Askıya alma, yalnızca Dixora'nın platform yöneticileri tarafından ve gerekçesiyle birlikte kayıt altına alınarak uygulanır; ödeme sağlanması veya ihlalin giderilmesi hâlinde hesap yeniden etkinleştirilir.",
    ],
  },
  {
    heading: "15. Hesap Kapatma, İptal ve Kalıcı Silme",
    paragraphs: [
      "Üye, hesabını dilediği zaman, İşletme Paneli üzerinden veya Dixora ile iletişime geçerek, herhangi bir gerekçe göstermeksizin kapatabilir (iptal); kapatma tarihine kadar tahakkuk etmiş ücretler geçerliliğini korur.",
      "Hesap kapatma (iptal) tek başına verilerin silinmesi anlamına gelmez; kapatılan hesaba ait veriler, işbu Sözleşme'nin ve Gizlilik Politikası'nın öngördüğü süre boyunca saklanabilir.",
      "Kalıcı silme, Üye'nin açık talebi üzerine veya mevzuatın öngördüğü hâllerde, işletmeye ait tüm kayıtların (şube, çalışan, ürün, sipariş, QR menü, kampanya, fatura ve ilgili diğer veriler dâhil) geri döndürülemez şekilde silinmesidir ve yalnızca yetkili platform yöneticisi tarafından, kimlik doğrulaması yapılarak uygulanır. Kalıcı silme talebinin uygulanmasından sonra veriler geri getirilemez.",
    ],
  },
  {
    heading: "16. İade Koşulları ve Cayma Hakkı",
    paragraphs: [
      "Deneme süresi ücretsiz olduğundan ve ücretli döneme geçiş Üye'nin açık ödeme onayına bağlı olduğundan, ücretli dönem başlamadan herhangi bir bedel tahsil edilmez.",
      "Hizmet esas olarak ticari/mesleki amaçla kullanan işletmelere sunulur (bkz. madde 1); bu Üyeler bakımından iptal ve iade, 6502 sayılı Kanun'un tüketiciye tanıdığı cayma hakkına göre değil, işbu Sözleşme'nin ve ayrıca yayımlanan İptal ve İade Politikası'nın sözleşmesel kurallarına göre yürütülür.",
      "Üye'nin somut olayda 6502 sayılı Tüketicinin Korunması Hakkında Kanun anlamında tüketici sıfatını taşıdığı istisnai hâllerde: Mesafeli Sözleşmeler Yönetmeliği'nin 15. maddesi uyarınca, onayı ile ifasına başlanan ve anında ifa edilen elektronik hizmetlerde cayma hakkı kullanılamayabilir; buna rağmen ödemeyi takip eden ve Hizmet'in fiilen kullanılmaya başlanmadığı 14 (on dört) gün içinde, hizmeti fiilen kullanmamış olması kaydıyla iade talep edebilir. Bu istisnai koşul, Üye'nin diğer emredici tüketici haklarını da saklı tutar.",
      "Mükerrer tahsilat veya teknik hata sonucu yapılan ödemeler, Üye'nin sıfatından bağımsız olarak, tespit edilmesi hâlinde tam olarak iade edilir. Ayrıntılı süreç ve koşullar için ayrıca yayımlanan İptal ve İade Politikası geçerlidir.",
    ],
  },
  {
    heading: "17. QR Menü, Menü, Ürün ve Fiyat Yönetimi",
    paragraphs: [
      "QR Menü üzerinde görüntülenen ürün, kategori, açıklama, alerjen bilgisi, fiyat, stok durumu ve kampanya içerikleri münhasıran Üye tarafından İşletme Paneli üzerinden girilir, güncellenir ve yönetilir.",
      "Dixora, yalnızca bu içeriklerin teknik olarak barındırılmasını, işlenmesini ve son müşteriye görüntülenmesini sağlayan altyapı hizmeti sunar; menüdeki bilgilerin doğruluğu, güncelliği ve mevzuata (fiyat etiketi, alerjen beyanı, gıda mevzuatı vb.) uygunluğu tamamen Üye'nin sorumluluğundadır.",
    ],
  },
  {
    heading: "18. Garson/Çalışan Paneli ve Operasyon İşlevleri",
    paragraphs: [
      "Hizmet; garson ve kasiyer gibi çalışan rollerine özel, mobil uyumlu paneller üzerinden masa açma/kapama, sipariş oluşturma, mutfağa iletme, ödeme kaydı ve QR üzerinden gelen sipariş/hesap taleplerinin onaylanması gibi operasyonel işlevleri sunar.",
      "Bu panellerden gerçekleştirilen her işlem, ilgili çalışan hesabı ile ilişkilendirilerek kayıt altına alınır; işlem kayıtlarının doğruluğundan, işlemi gerçekleştiren çalışanı yetkilendiren Üye sorumludur.",
    ],
  },
  {
    heading: "19. İşletmenin Kendi Müşterilerine Karşı Sorumluluğu",
    paragraphs: [
      "Dixora, Üye'nin sattığı yiyecek, içecek veya sunduğu fiziksel hizmetin tarafı, satıcısı veya sağlayıcısı değildir; Dixora yalnızca Üye ile Üye'nin müşterileri arasındaki sipariş ve ödeme sürecini kolaylaştıran bir yazılım altyapısı sunar.",
      "Üye ile Üye'nin kendi müşterileri arasındaki satış, hizmet, gıda güvenliği, tüketici hakları ve benzeri konulardan doğan her türlü hukuki ve mali sorumluluk münhasıran Üye'ye aittir.",
    ],
  },
  {
    heading: "20. Kullanıcı Tarafından Yüklenen İçerikler ve Sınırlı Lisans",
    paragraphs: [
      "Üye, İçerik üzerinde gerekli hak ve yetkilere sahip olduğunu; İçerik'in üçüncü kişilerin marka, telif, kişilik veya diğer fikri mülkiyet haklarını ihlal etmediğini ve hukuka uygun olduğunu beyan ve taahhüt eder.",
      "Üye, Hizmet'in ifası için gerekli ölçüde İçerik'i barındırma, teknik olarak işleme, çoğaltma ve son müşterilere görüntüleme amacıyla Dixora'ya münhasır olmayan, dünya çapında geçerli, Sözleşme süresiyle sınırlı bir kullanım hakkı (lisans) tanır. Bu lisans, İçerik'in mülkiyetini Dixora'ya devretmez; İçerik'in tüm hakları Üye'de kalır.",
      "Dixora, İçerik'i yalnızca Hizmet'in sunulması amacıyla kullanır; İçerik'i Üye'nin açık izni olmaksızın reklam veya pazarlama materyali olarak kullanmaz.",
    ],
  },
  {
    heading: "21. Yasaklanan Kullanım ve Sisteme Zarar Verme",
    paragraphs: [
      "Üye ve çalışanları; Hizmet'i yalnızca kendi işletmesinin meşru ticari faaliyetleri kapsamında kullanacağını, sisteme yetkisiz erişim denemesinde bulunmayacağını, güvenlik açıklarını kötüye kullanmayacağını, Hizmet'in normal işleyişini bozacak (aşırı yük bindirme, otomatik kazıma, kötü amaçlı yazılım yükleme vb.) eylemlerde bulunmayacağını ve üçüncü kişilerin haklarını ihlal eden, hukuka aykırı, müstehcen veya yanıltıcı İçerik yüklemeyeceğini kabul eder.",
      "Bu maddenin ihlali hâlinde Dixora, ilgili hesabı derhâl askıya alma veya Sözleşme'yi feshetme hakkını saklı tutar; ihlalden doğan zararlardan Üye sorumludur.",
    ],
  },
  {
    heading: "22. Fikri Mülkiyet ve Dixora Yazılımının Mülkiyeti",
    paragraphs: [
      "Dixora yazılımının kaynak kodu, veri tabanı yapısı, tasarımı, arayüzü, marka ve logoları dâhil tüm fikri mülkiyet hakları münhasıran Dixora'ya aittir. Üye'ye yalnızca Sözleşme süresince, Sözleşme'de tanımlanan amaçla sınırlı, devredilemez ve alt lisanslanamaz bir kullanım hakkı tanınır.",
      "Üye, Dixora yazılımını tersine mühendislik yöntemleriyle çözümleyemez, kopyalayamaz veya türev çalışma oluşturamaz.",
    ],
  },
  {
    heading: "23. Üçüncü Taraf Servisler ve Entegrasyonlar",
    paragraphs: [
      "Dixora'nın sunucu, veritabanı ve dosya depolama altyapısı kendi kontrolündeki sistemlerde çalışır. Bunun dışında, etkinleştirildiğinde Hizmet e-posta gönderimi ve kısa mesaj (OTP/doğrulama) gibi işlevler için üçüncü taraf servis sağlayıcılardan yararlanabilir; hangi sağlayıcıların fiilen kullanıldığı KVKK Aydınlatma Metni ve Gizlilik Politikası'nda ayrıca açıklanır.",
      "Dixora, MVP sürümünde online kart ile ödeme (sanal POS), otomatik kart tahsilatı veya ödeme kaydedici cihaz (ÖKC) entegrasyonu sunmaz; herhangi bir ödeme sağlayıcısı bu amaçlarla aktif olarak kullanılmamaktadır. İleride böyle bir entegrasyon devreye alınırsa, ilgili sağlayıcıyla sözleşme ilişkisi kurulup test edildikten sonra, Üye'ye önceden bilgi verilerek ve bu Sözleşme ile KVKK Aydınlatma Metni güncellenerek yürürlüğe konur; bu, mevcut bir hizmet değil, gelecekte sunulabilecek bir olasılıktır.",
    ],
  },
  {
    heading: "24. Veri İşleme ve Kişisel Veriler",
    paragraphs: [
      "Dixora, 6698 sayılı Kişisel Verilerin Korunması Kanunu (\"KVKK\") kapsamında, Üye ve Üye'nin çalışanlarına ait kimlik ve iletişim verilerini Hizmet'in sunulması amacıyla işler. İşlenen veri kategorileri, amaçlar, hukuki sebepler ve haklar ayrıca yayımlanan KVKK Aydınlatma Metni'nde açıklanır.",
      "Üye, kendi müşterilerine ait (QR menü siparişi, sadakat programı vb. yoluyla elde edilen) kişisel verilerin işlenmesinden veri sorumlusu sıfatıyla bizzat sorumludur ve bu verilerin işlenmesinde KVKK'ya uygun hareket edeceğini kabul eder.",
    ],
  },
  {
    heading: "25. Güvenlik",
    paragraphs: [
      "Dixora, işlediği verilerin güvenliğini sağlamak amacıyla erişim kontrolü, şifreleme, oturum yönetimi ve düzenli güvenlik güncellemeleri gibi makul teknik ve idari tedbirleri uygular.",
      "Üye, kendi hesap güvenliğine ilişkin tedbirleri (güçlü parola kullanımı, yetkisiz paylaşımın önlenmesi vb.) almakla yükümlüdür; Üye'nin kendi ihmalinden kaynaklanan güvenlik ihlallerinden Dixora sorumlu tutulamaz.",
    ],
  },
  {
    heading: "26. Hizmet Sürekliliği, Bakım/Kesinti Durumları ve Mücbir Sebep",
    paragraphs: [
      "Dixora, Hizmet'in kesintisiz, hatasız veya belirli bir amaca uygun olacağını taahhüt etmez; ancak makul ticari özeni göstererek hizmet sürekliliğini sağlamak için gayret gösterir.",
      "Dixora, planlı bakım, güncelleme veya öngörülemeyen teknik arızalar nedeniyle Hizmet'e erişimi geçici olarak durdurabilir; planlı kesintiler mümkün olduğunca önceden Üye'ye bildirilir.",
      "Doğal afet, yangın, savaş, salgın hastalık, genel iletişim/enerji altyapısı kesintileri, mevzuat değişiklikleri veya tarafların makul kontrolü dışındaki benzer mücbir sebep hâllerinde, etkilenen tarafın yükümlülükleri mücbir sebebin devamı süresince askıya alınır.",
    ],
  },
  {
    heading: "27. Veri Kaybı ve Yedekleme",
    paragraphs: [
      "Dixora, veri kaybı riskini en aza indirmek amacıyla düzenli yedekleme uygular; ancak bu husus, Üye'nin kritik verilerini kendi imkânlarıyla da (rapor dışa aktarma vb.) yedeklemesi gerekliliğini ortadan kaldırmaz.",
      "Dixora'nın makul özen göstermesine rağmen ortaya çıkabilecek beklenmedik veri kaybı hâllerinde, Dixora elindeki en güncel yedekten geri yükleme için makul gayreti gösterir; bu husus 28. madde kapsamındaki sorumluluk sınırına tabidir.",
    ],
  },
  {
    heading: "28. Sorumluluğun Sınırlandırılması",
    paragraphs: [
      "Dixora'nın işbu Sözleşme'den doğan toplam sorumluluğu, sorumluluğun doğduğu olay tarihinden önceki 3 (üç) ay içinde Üye tarafından ödenmiş toplam hizmet bedeli ile sınırlıdır.",
      "Bu sınırlama; Dixora'nın kastından veya ağır kusurundan doğan sorumluluğu, emredici mevzuat hükümleri gereği sınırlandırılamayan sorumluluk hâllerini (özellikle kişisel veri ihlallerinde KVKK ve ilgili mevzuattan doğan sorumluluğu), Dixora'nın üçüncü kişinin fikri mülkiyet hakkını bilerek ihlal etmesinden doğan sorumluluğu ve tüketici sıfatını taşıyan Üye'nin madde 30 uyarınca saklı tutulan emredici haklarını kapsamaz.",
      "Dixora; Üye'nin veri girişi hatalarından, üçüncü taraf internet/elektrik kesintilerinden, Üye'nin kendi donanım/yazıcı/ağ altyapısından kaynaklanan aksaklıklardan ve dolaylı zararlardan (kâr kaybı, itibar kaybı vb.) makul özen göstermiş olması kaydıyla sorumlu tutulamaz.",
    ],
  },
  {
    heading: "29. Sözleşme Değişiklikleri ve Bildirimler",
    paragraphs: [
      "Dixora, Sözleşme metninde değişiklik yapma hakkını saklı tutar; Üye'nin mevcut kullanımını önemli ölçüde etkileyen değişiklikler, yürürlüğe girmeden önce İşletme Paneli veya kayıtlı e-posta adresi üzerinden Üye'ye bildirilir.",
      "İşbu Sözleşme kapsamındaki tüm bildirimler, taraflarca aksi kararlaştırılmadıkça, Üye'nin kayıt sırasında bildirdiği e-posta adresine veya İşletme Paneli üzerinden yapılır.",
    ],
  },
  {
    heading: "30. Uygulanacak Hukuk ve Uyuşmazlık Çözümü",
    paragraphs: [
      "İşbu Sözleşme Türkiye Cumhuriyeti kanunlarına tabidir.",
      "Üye'nin 6502 sayılı Tüketicinin Korunması Hakkında Kanun kapsamında tüketici sayıldığı hâllerde, uyuşmazlıklarda Ticaret Bakanlığı'nca ilan edilen parasal sınırlar dâhilinde tüketici hakem heyetleri, bu sınırların üzerindeki uyuşmazlıklarda ise tüketici mahkemeleri yetkilidir.",
      "Üye'nin ticari amaçla hizmet aldığı ve tüketici sayılmadığı hâllerde, uyuşmazlıkların çözümünde İstanbul (Merkez) Mahkemeleri ve İcra Daireleri yetkilidir.",
    ],
  },
  {
    heading: "31. Yürürlük",
    paragraphs: [
      "Üye'nin kayıt formundaki \"Üyelik ve SaaS Hizmet Sözleşmesi'ni okudum ve kabul ediyorum\" onay kutusunu işaretleyip kaydı tamamlaması, işbu Sözleşme'nin tüm hükümleriyle birlikte elektronik ortamda kurulduğu ve karşılıklı olarak kabul edildiği anlamına gelir; bu onay 5070 sayılı Elektronik İmza Kanunu çerçevesinde yazılı şekil şartını sağlar.",
      "İşbu Sözleşme, Üye'nin onayı ile birlikte yürürlüğe girer ve Üye'nin hesabı kalıcı olarak silininceye ya da taraflardan biri tarafından usulüne uygun olarak feshedilinceye kadar yürürlükte kalır.",
    ],
  },
];

export const MEMBERSHIP_AGREEMENT: LegalDocument = {
  title: MEMBERSHIP_AGREEMENT_TITLE,
  version: MEMBERSHIP_AGREEMENT_VERSION,
  effectiveDate: MEMBERSHIP_AGREEMENT_EFFECTIVE_DATE,
  sections: MEMBERSHIP_AGREEMENT_SECTIONS,
};
