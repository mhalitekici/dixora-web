# Panel kullanım ve entegrasyon incelemesi

İnceleme tarihi: 14 Ekim 2026. Kapsam: işletme sahibi, yönetici, müdür, kasiyer,
garson, muhasebe ve süper admin panelleri; sadakat, kampanyalar, QR menü, yazıcı
bağlantısı ve kurulum/destek akışları.

## Kullanım hedefi ve tasarım kararı

Garson servis sırasında doğru masayı ve müşterinin isteğini bulmalı; kasiyer
hesabı, ödülü ve vardiyayı hatasız tamamlamalı; müdür kendi şubesindeki sorunu
çözebilmeli; yönetici kurulum ve ekip yetkilerini anlaşılır adımlarla
tamamlamalı; süper admin işletme, abonelik ve servis sorunlarını ayırt edebilmeli.

Mevcut Dixora görünümü bu kapsamda korunur. Alan dili: masa, adisyon, hazırlık
istasyonu, vardiya, ikram, şube ve baskı kuyruğu. Renk dünyası mevcut sıcak
beyaz yüzeyler, kömür rengi gezinme, turuncu işlem vurgusu, yeşil tamamlanma
ve kırmızı hatadan oluşur. Ürüne özgü yapı, masa → sipariş → baskı → tahsilat
→ vardiya zincirini bağlam kaybetmeden izletmektir.

İşlevsiz filtre düğmeleri yerine çalışan arama/sıfırlama, teknik kodlar yerine
anlaşılır adlar, tek uzun kurulum açıklaması yerine gerçek duruma bağlı
sonraki adımlar kullanılır.

## İnceleme yöntemi

- Tüm panel sayfaları, ilgili veri çağrıları ve rol yetkileri kaynak kodundan incelendi.
- Demo işletmede rol bazında gerçek tarayıcı ziyaretleri, hatalı yanıtlar,
  mobil taşmalar ve çalışma zamanı hataları kaydedildi.
- Formlar, boş/hata durumları, menüler, fiziksel baskıya yol açmadan entegrasyon
  akışları ve geri bildirim metinleri kontrol edildi.
- Para, fiziksel baskı veya gerçek müşteriye ileti gönderen işlemler,
  otomatik testlerde sahte sağlayıcılar ve ayrı test verileriyle doğrulandı.
- Bulunan problemler düzeltildi; ilgili testler, tip/lint kontrolleri, derleme
  ve dağıtım sonrası tarayıcı ziyaretleri çalıştırıldı.

## İlk tarayıcı incelemesindeki sorunlar

İlk sürümde yedi rol için 58 sayfa ziyareti yapıldı. Yönetici rolünün denenen
altı ekranı giriş sayfasına dönüyordu. Müdürün yazıcı ve sadakat ekranlarındaki
veri çağrıları 403 alıyordu. Muhasebenin rapor ekranındaki vardiya çağrısı ve
envanterdeki ürün çağrısı da 403 alıyordu. Envanter sekmeleri işletme sahibi,
müdür ve muhasebe için mobil genişlikte sayfayı taşırıyordu.

Ekran içindeki sonraki kontrolde kasa özetinin kapanmış siparişleri açık hesap
saydığı görüldü. Demo şubesindeki 200 hesap sayısının nedeni, geçmiş siparişlerin
operasyon listesine karışmasıydı.

## Uygulanan değişiklikler

### Ortak kullanım ve erişim

- Yönetici (`BUSINESS_ADMIN`) artık yönetim, servis ve kasa sayfalarına rolüne
  uygun biçimde girebiliyor. Menüdeki bağlantılar hem rol hem gerçek izinle
  süzülüyor. Platform, operasyon ve muhasebe kapsamları birbirinden ayrılıyor.
- Ctrl/Cmd+K ile ekran araması eklendi. Ok tuşları ve Enter ile seçim yapılabiliyor.
  Hesap, destek ve kasiyerin yazıcı bağlantıları da bu aramayla bulunabiliyor.
- Yönetimden servis/kasaya geçiş ve operasyon ekranından yönetime dönüş eklendi.
- Tüm aktif roller için kendi profilini görme ve parola değiştirme ekranı eklendi.
- Seçim alanları kapalıyken UUID veya `FREE_ITEM` yerine insan tarafından
  okunabilir ürün, şube, rol ve ödül adını gösteriyor.
- Uzun pencereler ekran yüksekliğine sığıyor ve içeride kaydırılabiliyor.
  Sekmeler mobilde kendi içinde kayıyor; sayfanın genişliğini büyütmüyor.
- İşlevsiz filtre/görünüm düğmeleri kaldırıldı; aramayı temizleme eklendi.
- Klavyeyle ana içeriğe atlama, aktif sayfa işareti, simge düğmelerinin adları,
  destek sayfasının ana içerik bölgesi ve azaltılmış hareket tercihi düzenlendi.

### Garson

- “Siparişler” artık açık sipariş listesini açıyor; masa, durum, tutar ve zaman
  gösteriliyor. Hesap isteyen masalar öncelikli ve her kayıttan detaya geçilebiliyor.
- Bildirimler masa UUID'si yerine masa adını ve anlaşılır talep bilgisini gösteriyor.
- Bağlantı hatası “bildirim yok” gibi gösterilmiyor; hata ve yeniden deneme sunuluyor.
- Yenileme, arama, mobil gezinme ve hesap/destek erişimi ortak davranışa getirildi.
- Sipariş detayında masa adı gösteriliyor. Ürün taşıma yalnızca `tables.transfer`
  izni olan personelin açık adisyonunda sunuluyor; ödenmiş hesaplarda gizleniyor.
  Sunucu hatalarında yeniden deneme gösteriliyor, taşıma alanlarının adları
  ekran okuyucu tarafından anlaşılabiliyor.
- Uzun ürün adları mobil sipariş detayında kesilmiyor, gerektiğinde alt satıra geçiyor.

### Kasiyer

- F2 masa aramasına odaklanıyor, F3 ürün ekranını, F4 ödeme ekranını açıyor.
  Bu kısayollar tahsilatı kendiliğinden kaydetmiyor.
- Negatif, sıfır, kalan bakiyeyi aşan veya ikiden fazla ondalığı olan tutarlar
  gönderilemiyor. Kullanıcı nedenini ve ödeme sonrası kalacak tutarı görüyor.
- Yarısı, üçte biri ve tamamı seçenekleriyle kısmi ödeme kolaylaştırıldı.
- Operasyon sorgusu geçmiş kapanmış/iptal hesapları dışlıyor. Ödenmiş ama masa
  oturumu hâlâ açık hesaplar, kapatma ve fiş işlemleri için korunuyor.
- Yazıcı bağlantıları kasiyerin kendi panelinde açılabiliyor. Hazırlık istasyonu
  oluşturma gibi katalog yetkisi gerektiren işlemler kasiyere sunulmuyor.

### İşletme sahibi, yönetici ve müdür

- Kampanyalar, Sadakat Programı ve Bildirimler aynı menü başlığında toplandı.
- Müdür sadakat programını, müşteri ve ödülleri okuyabiliyor; program değiştirme
  yetkisi ayrıca korunuyor. Müşteri/ödül listesi erişilebilir şubelerle sınırlı.
- Yazıcı ekranı ayar yönetimi gerektiren şube servisi yerine kullanıcının
  erişebildiği şubeleri kullanıyor ve aktif şubeyi varsayılan seçiyor.
- Kontrol merkezindeki geçişler ve işlemler kullanıcının izinlerine uyuyor.
- QR kodlarının işletme ve şube bilgileri aktif oturumdan alınıyor. Mobil veya
  başka bilgisayardan açıldığında yanlış localhost adresine yönelme düzeltiliyor;
  yerel adres ile paylaşım adresi açıkça ayrılıyor.
- Yardım konuları sadakat doğrulaması, ödül bildirimi, yazıcı kurulumu, şube
  değiştirme ve vardiya teslimiyle güncellendi; arama ve sonuç yok mesajı eklendi.

### Muhasebe

- Vardiya geçmişi ve detayı rapor okuma izniyle açılıyor. Vardiya/gün kapatma
  API'leri kendi işlem izinlerini gerektirmeye devam ediyor.
- Envanter okuma, katalog okuma izni gerektiren ürün sorgusunu tetiklemiyor.
  Stok kartı, reçete, transfer ve düzeltme işlemleri yazma izniyle sınırlandırıldı.
- Menü, kontrol merkezi ve arama muhasebenin finansal kapsamına uyuyor.

### Yazıcı entegrasyonu

- Seçili şubenin verisinden dört adımlı kurulum durumu gösteriliyor: uygulamayı
  kurma, bilgisayarı bağlama, cihazları eşleme ve çıktı kontrolü.
- Yalnızca bağlantı kaydı/kodu oluşturulması kurulumu tamamlanmış göstermiyor;
  bilgisayarın en az bir kez bağlantı kurmuş olması gerekiyor.
- API adresi kopyalanabiliyor; bağlantı koduyla birlikte kullanılacağı açıklanıyor.
- Yazıcı ve istasyon kodu addan otomatik üretiliyor; gerekirse düzenlenebiliyor.
- Kasa fişi için kasa rolünde cihaz gerektiği açıkça belirtiliyor.
- Bağlantı kaldırma ve manuel baskı tekrarında sonuç açıklanarak onay isteniyor.
  Tekrar baskıda önceki çıktının kontrol edilmesi gerektiği belirtiliyor.
- İndirme paketi bulunmadığında kullanıcıya geliştirme/Docker talimatı yerine
  destek yönlendirmesi veriliyor.

### Süper admin

- İşletme, abonelik, denetim ve sistem ekranlarındaki teknik adapter açıklamaları
  anlaşılır durum ve kapsam açıklamalarına çevrildi.
- Arama, profil, destek ve mobil pencere davranışları ortak iyileştirmeleri kullanıyor.
- İşletme detayındaki süreli destek erişiminin mevcut durumu açıkça belirtiliyor.

### Kampanya ve sadakat bildirimleri

- Kampanya duyuruları izinli üyelere, kazanılan ödüller ilgili üyeye e-posta
  kuyruğundan gönderiliyor. Başarısız gönderimler sınırlı aralıklarla yeniden deneniyor.
- Aynı duyuru/ödül için tekrar gönderim önleniyor. İptal kampanya, kullanılmış
  ödül ve geri çekilmiş kampanya e-posta izni gönderimden önce yeniden kontrol ediliyor.
- Yönetimde bekleyen, gönderilen, başarısız ve iptal bildirimler izlenebiliyor.
  Alıcı adresleri maskeleniyor; ödül kullanımı doğrulama koduyla çalışıyor.

## Tarayıcı kapsamı

| Rol | Ziyaret | Ekran kapsamı |
| --- | ---: | --- |
| İşletme sahibi | 39 | 28 yönetim ekranı; 5 kasa, 4 servis; profil ve destek |
| Yönetici | 30 | 28 yönetim ekranı; profil ve destek |
| Müdür | 25 | İzinli 20 yönetim ekranı; kasa, yazıcı, masalar; profil ve destek |
| Kasiyer | 7 | Kasa, paket, kapanan sipariş, vardiya, yazıcı; profil ve destek |
| Garson | 6 | Masalar, giriş yönlendirmesi, siparişler, bildirimler; profil ve destek |
| Muhasebe | 7 | Kontrol merkezi, rapor, envanter, vardiya, sipariş hareketleri; profil ve destek |
| Süper admin | 8 | Giriş yönlendirmesi, işletmeler, abonelikler, faturalar, sistem, denetim; profil ve destek |

Toplam 122 rol/sayfa ziyareti, 1440 piksel masaüstü ve 390/320 piksel mobil
genişlikte kontrol edildi: başarısız API çağrısı, çalışma zamanı hatası ve
yatay taşma görülmedi. Ayrıca ekran içi arama, forma giriş, kısmi ödeme,
talep hatası, sipariş detayı ve işletme detayı akışları ayrı kontrol edildi.
`/waiter` ve `/super-admin` ana yollarındaki hedef sayfa yönlendirmeleri normaldir.

## Doğrulama sonuçları

- API'nin tam test paketi: 409 test geçti. Son eklenen operasyon filtresi,
  ödenmiş açık masa hesabını koruma ve rol/şube okuma sınırları ayrıca 4 testle
  doğrulandı.
- API tip kontrolü: 109 kaynak dosyasında hata yok. Ruff kontrolü geçti.
- Arayüzün tam test paketi: 78 dosyada 399 test geçti. API ile toplam 808 test.
- Arayüz TypeScript kontrolü ve Next.js üretim derlemesi geçti. ESLint'te hata
  yok; iki mevcut test yardımcı fonksiyonunda kullanılmayan `init` parametresi
  uyarısı bulunuyor.
- Yedi rol için 122 dağıtım sonrası sayfa ziyareti geçti. Ekran içindeki 13 ayrı
  kullanım/entegrasyon kontrolü de geçti: ekran araması, yazıcı formu, kampanya
  duyuru kontrolü, QR kodu bilgileri, mobil müşteri menüsü, yardım araması,
  ödeme formu ve kısayollar, kasiyer yazıcı yetkisi, mobil sipariş oluşturucu,
  garson sipariş detayı/yetkisi, bildirim hata durumu, personel profili,
  muhasebe okuma sınırı ve süper admin işletme detayı.
- Docker API ve web yeniden derlendi. API/web ile PostgreSQL, Redis ve MinIO
  sağlık kontrolleri başarılı; `/ready` veritabanı bağlantısını doğruladı.
- E-posta kuyruk çalışanının başladığı uygulama kaydından doğrulandı.

## Donanım ve mevcut ürün sınırları

- Fiziksel yazıcıya yeni iş gönderilmedi. Kurulum arayüzü, eşleme ve baskı
  davranışı testlerde kontrol edildi; kağıdın gerçek cihazdan çıkması ilgili
  bilgisayar ve yazıcı üzerinde doğrulanmalıdır.
- macOS kurulum paketi bulunabilirlik kontrolü korunuyor; bu çalışmada macOS
  bilgisayarda uygulama kurulumu yapılmadı.
- Bildirim kanalı e-postadır. Bu çalışma SMS veya mobil push sağlayıcısı eklemez.
- Süper admin için süreli işletme hesabına destek oturumu sunan backend henüz
  yoktur; ekran kullanılabilir olmayan bu işlemi açıkça açıklıyor.
- Çok yoğun şubelerde servis/kasa listesi son 200 açık siparişle sınırlıdır.
  Genel sipariş geçmişi ve rapor sorguları bu operasyon filtresinden etkilenmez.
