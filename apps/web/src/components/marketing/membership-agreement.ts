import {
  ADDITIONAL_BRANCH_PRICE_LABEL,
  BASE_MONTHLY_PRICE_LABEL,
  INCLUDED_BRANCHES,
} from "@/lib/pricing";

// Bumped whenever the binding text changes — acceptances are stored against a
// version, so an older signature must never be read as consent to newer terms.
export const MEMBERSHIP_AGREEMENT_VERSION = "2026-08-09-v2";

export type AgreementSection = {
  heading: string;
  paragraphs: string[];
};

export const MEMBERSHIP_AGREEMENT_TITLE = "Dixora Üyelik ve Hizmet Sözleşmesi";

export const MEMBERSHIP_AGREEMENT_SECTIONS: AgreementSection[] = [
  {
    heading: "1. Taraflar",
    paragraphs: [
      "İşbu Sözleşme; bulut tabanlı restoran/kafe/bar/otel işletme yönetim yazılımı hizmetini sağlayan Dixora (\"Hizmet Sağlayıcı\") ile bu hizmete kayıt olarak erişim talep eden işletme yetkilisi (\"Üye\") arasında, Üye'nin kayıt formunu onaylaması anında elektronik ortamda kurulur.",
      "Üye, kayıt formuna girdiği bilgilerin (işletme unvanı, yetkili adı, e-posta ve benzeri) doğru ve güncel olduğunu kabul ve beyan eder.",
    ],
  },
  {
    heading: "2. Sözleşmenin Konusu",
    paragraphs: [
      "Sözleşme'nin konusu; Dixora'nın Üye'ye sunduğu masa/sipariş yönetimi, kasa, QR menü, envanter, raporlama ve ilgili yardımcı modüllerden oluşan yazılım hizmetinin ('Hizmet') kullanım şartlarının ve tarafların hak ve yükümlülüklerinin belirlenmesidir.",
      "Hizmet, 6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun ve ilgili mevzuat kapsamında elektronik ortamda, uzaktan erişimle sunulan bir bilişim hizmetidir.",
    ],
  },
  {
    heading: "3. Deneme Süresi ve Ücretlendirme",
    paragraphs: [
      "Yeni kayıt olan işletmelere 30 (otuz) takvim günü süreyle, herhangi bir ödeme talep edilmeksizin ücretsiz deneme süresi tanınır. Deneme süresi boyunca kredi kartı veya başka bir ödeme bilgisi istenmez.",
      `Deneme süresinin sonunda Hizmet'e kesintisiz devam etmek isteyen Üye, güncel Standart Paket aylık ücreti olan ${BASE_MONTHLY_PRICE_LABEL} (KDV hariç, ilan edilen fiyatlara yürürlükteki mevzuat gereği KDV ayrıca eklenir) üzerinden ödeme yapar. Bu ücrete ${INCLUDED_BRANCHES} (bir) şube dahildir.`,
      `Üye'nin birden fazla şube kullanması hâlinde, dahil olan şube sayısını aşan her bir aktif şube için aylık ${ADDITIONAL_BRANCH_PRICE_LABEL} (KDV hariç) ek ücret uygulanır. Aylık toplam ücret, temel paket ücretine aktif ek şube sayısı ile ek şube ücretinin çarpımının eklenmesiyle hesaplanır. Üye tarafından arşivlenen (pasife alınan) şubeler ücretlendirmeye dahil edilmez; ücretlendirme yalnızca aktif şubeler üzerinden yapılır.`,
      "Şube ekleme veya arşivleme işlemleri Üye'nin kendi işletme paneli üzerinden gerçekleştirilir ve aylık ücret bir sonraki fatura döneminde güncellenir. Üye, şube eklemeden önce panelde gösterilen güncel aylık tutarı görüntüleyebilir.",
      "Dixora, Üye'nin açık onayı ve ödemesi olmaksızın Üye'nin banka veya kredi kartından otomatik olarak tahsilat yapmaz. Deneme süresi sona eren hesaplar, ödeme sağlanana ve Dixora tarafından onaylanana kadar salt okunur/kısıtlı duruma alınabilir; veriler silinmez.",
      "Ödemenin banka havalesi/EFT (IBAN) yoluyla ya da ileride devreye alınacak sanal POS (online ödeme) altyapısı üzerinden yapılması hâlinde, ödemenin Dixora kayıtlarına yansımasını takiben hesap yeniden aktif hale getirilir. Güncel fiyat, kampanya ve ödeme yöntemleri Dixora tarafından işletme paneli veya resmi iletişim kanalları üzerinden duyurulur.",
    ],
  },
  {
    heading: "4. Hizmetin Kapsamı ve Kullanım Şartları",
    paragraphs: [
      "Üye, Hizmet'i yalnızca kendi işletmesinin meşru ticari faaliyetleri kapsamında kullanacağını; sisteme yüklediği ürün, fiyat, çalışan ve müşteri verilerinin doğruluğundan bizzat sorumlu olduğunu kabul eder.",
      "Dixora, Hizmet'in kesintisiz, hatasız veya belirli bir amaca uygun olacağını taahhüt etmez; ancak makul ticari özeni göstererek hizmet sürekliliğini sağlamak için gayret gösterir.",
      "Dixora, bakım, güncelleme veya mücbir sebepler nedeniyle Hizmet'e erişimi geçici olarak durdurabilir; bu durum mümkün olduğunca önceden Üye'ye bildirilir.",
    ],
  },
  {
    heading: "5. Fikri Mülkiyet",
    paragraphs: [
      "Yazılımın kaynak kodu, tasarımı, marka ve logoları dâhil tüm fikri mülkiyet hakları Dixora'ya aittir. Üye'ye yalnızca Hizmet'i sözleşme süresince kullanma hakkı (lisans) tanınır; bu hak devredilemez ve alt lisanslanamaz.",
      "Üye'nin sisteme yüklediği ürün görselleri, açıklamalar ve işletmeye özgü veriler Üye'ye aittir; Dixora bu verileri yalnızca Hizmet'in ifası amacıyla işler.",
    ],
  },
  {
    heading: "6. Kişisel Verilerin Korunması",
    paragraphs: [
      "Dixora, 6698 sayılı Kişisel Verilerin Korunması Kanunu ('KVKK') kapsamında, Üye ve Üye'nin çalışanlarına ait kimlik ve iletişim verilerini Hizmet'in sunulması amacıyla veri işleyen sıfatıyla işler.",
      "Üye, kendi müşterilerine ait (QR menü siparişi, sadakat programı vb. yoluyla elde edilen) kişisel verilerin işlenmesinden veri sorumlusu sıfatıyla bizzat sorumludur ve bu verilerin işlenmesinde KVKK'ya uygun hareket edeceğini kabul eder.",
    ],
  },
  {
    heading: "7. Sorumluluğun Sınırlandırılması",
    paragraphs: [
      "Dixora'nın işbu Sözleşme'den doğan toplam sorumluluğu, sorumluluğun doğduğu olay tarihinden önceki 3 (üç) ay içinde Üye tarafından ödenmiş toplam hizmet bedeli ile sınırlıdır.",
      "Dixora; Üye'nin veri girişi hatalarından, üçüncü taraf internet/elektrik kesintilerinden, Üye'nin kendi donanım/yazıcı/ağ altyapısından kaynaklanan aksaklıklardan ve dolaylı zararlardan (kâr kaybı, itibar kaybı vb.) sorumlu tutulamaz.",
    ],
  },
  {
    heading: "8. Cayma Hakkı",
    paragraphs: [
      "Deneme süresi ücretsiz olduğundan ve Hizmet'in ücretli döneme geçişi Üye'nin açık ödeme onayına bağlı olduğundan, ücretli dönem başlamadan herhangi bir bedel tahsil edilmez.",
      "Mesafeli Sözleşmeler Yönetmeliği'nin 15. maddesi uyarınca, Üye'nin onayı ile ifasına başlanan ve anında ifa edilen elektronik hizmetlerde cayma hakkı kullanılamayabilir. Ücretli dönem için ödeme yapan Üye, ödemeyi takip eden ve Hizmet'in fiilen kullanılmaya başlanmadığı 14 (on dört) gün içinde, hizmeti fiilen kullanmamış olması kaydıyla iadesini talep edebilir.",
    ],
  },
  {
    heading: "9. Sözleşmenin Feshi",
    paragraphs: [
      "Üye, hesabını dilediği zaman, işletme panelinden veya Dixora ile iletişime geçerek, herhangi bir gerekçe göstermeksizin kapatabilir; kapatma tarihine kadar tahakkuk etmiş ücretler geçerliliğini korur.",
      "Dixora; Üye'nin Sözleşme'yi, ilgili mevzuatı veya Hizmet'in olağan kullanım amacını ihlal etmesi (kötüye kullanım, yetkisiz erişim denemesi, ödeme yükümlülüğünün süresinde yerine getirilmemesi vb.) hâlinde, makul bir bildirim süresi tanıyarak hesabı askıya alma veya Sözleşme'yi feshetme hakkını saklı tutar.",
    ],
  },
  {
    heading: "10. Uyuşmazlıkların Çözümü",
    paragraphs: [
      "İşbu Sözleşme Türkiye Cumhuriyeti kanunlarına tabidir.",
      "Üye'nin 6502 sayılı Tüketicinin Korunması Hakkında Kanun kapsamında tüketici sayıldığı hâllerde, uyuşmazlıklarda Ticaret Bakanlığı'nca ilan edilen parasal sınırlar dâhilinde tüketici hakem heyetleri, bu sınırların üzerindeki uyuşmazlıklarda ise tüketici mahkemeleri yetkilidir.",
      "Üye'nin ticari amaçla hizmet aldığı ve tüketici sayılmadığı hâllerde, uyuşmazlıkların çözümünde İstanbul (Merkez) Mahkemeleri ve İcra Daireleri yetkilidir.",
    ],
  },
  {
    heading: "11. Yürürlük",
    paragraphs: [
      "Üye'nin kayıt formundaki \"Sözleşmeyi okudum, anladım ve kabul ediyorum\" onay kutusunu işaretleyip kaydı tamamlaması, işbu Sözleşme'nin tüm hükümleriyle birlikte elektronik ortamda kurulduğu ve karşılıklı olarak kabul edildiği anlamına gelir; bu onay 5070 sayılı Elektronik İmza Kanunu çerçevesinde yazılı şekil şartını sağlar.",
      "Dixora, Sözleşme metninde değişiklik yapma hakkını saklı tutar; önemli değişiklikler yürürlüğe girmeden önce Üye'ye bildirilir.",
    ],
  },
];
