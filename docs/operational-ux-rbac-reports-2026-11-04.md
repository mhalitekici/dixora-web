# Operasyon, UX, RBAC ve rapor çalışması — 4–5 Kasım 2026

## Başlangıç ve çalışma sınırları

GitHub `main`, `git ls-remote origin refs/heads/main` ve fetch ile doğrulandı:
`6b56397ccbfa86938f7a73a4ab3a8a78bdb0445d`. Yerel başlangıç:
`984df104fbadafb4b93ca947035b5f35b449a251`, `feat/production-reliability-p0`.
Yeni dal: `feat/dixora-operational-ux-rbac-reports`.
5 Kasım devam kontrolünde GitHub main SHA'sının aynı kaldığı yeniden doğrulandı.

Başlangıçtaki `skills-lock.json`, `.agents/skills/brag/`, `Dixora Ürünler/`,
`Youtube Videosu/`, `brag-output/` ve `docs/system-analysis-2026-10-23.md`
kullanıcıya ait; bu çalışmanın commit'lerine dahil edilmeyecek.
Production deploy, veri silme, secret okuma ve main'e push kapsam dışı.

## Kodlama öncesi teknik envanter

| Alan          | Doğrulanan mevcut davranış / değişiklik                                                                                            | Dosyalar ve sözleşme                                                              | Risk / kabul ölçütü                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Şube          | HTTP yalnız ana şubeyi kabul ediyor; switch ek üyeliği kabul ediyor; refresh ana şubeyi seçiyor; can_switch ek üyelikleri saymıyor | dependencies.py, security.py, api/auth.py; ortak aktif şube çözümleyici           | İptal edilen üyelik ve pasif şube her yolda reddedilmeli; başka tenant asla açılamaz                 |
| WebSocket     | Açılışta session kontrolü var; yaşam döngüsünde yok; şube üyeliği kontrol edilmiyor                                                | api/websocket.py, realtime.py; gönderim öncesi ve periyodik kontrol               | Redis fan-out korunmalı; iptalden sonra olay iletilmemeli                                            |
| RBAC          | Özel rol DB modeli var; API create/update sabit 409; çalışan ataması yalnız preset                                                 | rbac.py, models/identity.py, schemas.py, api/organization.py, role-management.tsx | Sistem ve owner korunmalı; caller sahip olmadığı yetkiyi veremez; custom CASHIER vardiyayı atlayamaz |
| Yetkili panel | Yönetim rolleri doğrudan operasyon URL'lerine girebiliyor                                                                          | auth/dependencies, BFF, layout, yeni Paneller sayfası; sınırlı operasyon grant    | Kendi hesabıyla reauth; session/tenant/branch/panel bağlı; destek kasa gözlem modunda                |
| Vardiya       | Tarihsel rapor ve kapatma akışları mevcut                                                                                          | api/shifts.py, shift-history.tsx, cashier-shift-page.tsx                          | Decimal ve immutable kapanış korunmalı; filtre ve sayfalama sunucuda                                 |
| Medya         | Nesne sahibi tam public URL eşitliğiyle bulunuyor; domain değişimi eski URL'yi geçersiz kılabilir                                  | api/media.py, product_images.py, ortak görsel bileşeni                            | Nesne anahtarıyla güvenli eşleme; upload/update/delete ve erişim negatif testleri                    |
| Paket         | PHONE geriye uyumlu kalmalı; il ve kararlı işlem anahtarı incelenecek                                                              | delivery model/schema/service/form, receipt-text.ts                               | Nullable city migration; retry aynı anahtarı kullanmalı; tek orijinal fiş                            |
| PDF           | Aynı yetkili rapor filtreleri ve backend Decimal verileri kullanılacak                                                             | api/reports.py, rapor servisi, report-dashboard.tsx                               | A4, Türkçe font/logo, tutar/şube/yetki testleri; gerçek PDF                                          |
| Yazıcı        | Revoke ve belirsiz baskı kurtarması korunacak                                                                                      | api/printing.py, printer-management/setup-guide                                   | Soft revoke, eşleme çözme, geçmişi koruma; fiziksel kabul ayrı                                       |
| Audit         | Görüntüleme katmanında Türkçe etiket, fark ve hassas veri temizliği                                                                | api/audit.py, services/audit.py, audit-labels/viewer                              | Tarihsel loglar değiştirilmez; bilinmeyen eylemler görünür kalır                                     |
| Admin UX      | Sadakat akışı, çalışan açıklamaları ve yinelenen parola arayüzü                                                                    | loyalty/*, employee-management, business-settings                                 | Mevcut API ve güvenlik korunur; erişilebilir gerçek kontroller                                       |
| Operasyon UX  | Kasa kare masa listesi; garson telefon akışlarının düzenlenmesi                                                                    | cashier-workspace, operational-shell, waiter/*                                    | Kısayol ve sipariş kuralları; 320–1440 px, safe-area, hata/bağlantı                                  |
| SSL/ops       | Certbot sonrası Nginx reload ve sertifika doğrulama eklenecek                                                                      | ops, nginx, compose, systemd                                                      | Test sertifikalarıyla dry-run/failure; gerçek restore/alarm/donanım ayrıca kabul ister               |

Migration planı: rolün güvenilir operasyon profili, operasyon grant tablosu ve
nullable teslimat `city`. Mevcut finansal tutarlar yeniden hesaplanmayacak.
Her migration hem eski şema hem metadata-bootstrap yolunu desteklemeli.

Tasarım: restoran sahibi vardiya ve raporu tarar; kasiyer yoğun serviste tahsilat
yapar; garson tek elle telefondan sipariş gönderir. Terminoloji: masa, adisyon,
vardiya, kasa, mutfak, bar, gün sonu. Mevcut turuncu marka, sıcak nötr yüzeyler,
fiş beyazı, koyu mürekkep, anlamsal yeşil/kırmızı korunur. Dixora'ya özgü imza,
masa–adisyon–vardiya bağlamının işlem yanında görünmesidir. Büyük dekoratif
kartlar yerine kompakt kayıtlar; gizemli ikonlar yerine açıklamalar; karma
kapatma işlemleri yerine ayrı vardiya ve işletme günü akışları kullanılacak.
Kullanıcının açık tasarım kararı ve onay istememe talimatı esas alınmıştır.

## Uygulanan davranışlar

### Oturum, şube ve özel roller

`services/branch_access.py` HTTP, parola/PIN girişi, refresh, şube değiştirme ve
WebSocket için aynı aktif şube politikasını sağlar. Ana şube ile aktif ek
üyelikler birlikte çözülür; seçilen ek şube refresh sırasında korunur.
Yetkisi kaldırılan şube ve pasif rol sonraki istekte reddedilir. `can_switch`
gerçek erişilebilir şube sayısından hesaplanır.

WebSocket ticket tek kullanımlı ve şubeye bağlıdır. Kullanıcı, rol/yetki kümesi,
oturum ailesi ve şube erişimi her olay gönderiminden önce yeniden doğrulanır;
sessiz bağlantılar da en geç 15 saniyede kontrol edilir. Reddedilen bağlantı
4401 ile kapatılır. Redis fan-out ve yeniden ticket alma korunur. Mobil ağ
kesintisinde browser API'sinin kabul etmediği `close(1001)` kullanımı 1000 ile
düzeltildi; bağlantı geri gelince gerçek veri yeniden alınır.

Özel rol oluşturma, şablondan kopyalama, ad/yetki güncelleme, çalışana atama ve
kullanılmayan rolü pasifleştirme gerçektir. Sistem rolleri değiştirilemez;
owner hesabı sıradan yönetici tarafından düzenlenemez. Bilinmeyen, wildcard,
platform ve çağıranın sahip olmadığı izinler reddedilir. Özel roller başka
özel roller yönetme yetkisi dağıtamaz. Atanmış rol pasifleştirilemez; kendi
rolünü değiştirerek kendine yetki verme engellenir. Yetkiler canlı okunur;
çalışanın rol/şube/istasyon değişikliği mevcut oturumlarını iptal eder.

Özel rolün `operational_profile` alanı WAITER, CASHIER, MANAGEMENT veya
BACKOFFICE olabilir. Ödeme izni verilen özel rol, profilini MANAGEMENT seçerek
kasiyer vardiyası zorunluluğunu aşamaz. JWT'deki profil navigasyon ipucudur;
yetki kaynağı backend'deki güncel kullanıcı/rol kaydıdır.
Mevcut üründe emekliye ayrılmış KITCHEN profili özel rol yoluyla yeniden
açılamaz; API 422 verir. Eski kullanıcı kayıtları değiştirilmez.
Şube belirtilmeyen giriş/refresh için katalog kaynak şubesi kopya şubeden
önceliklidir. Saat alanları aynı veya ters sıralı olduğunda da bu tercih
ortaktır; aktif erişim kümesi dışındaki şube seçilemez. Böylece aralıklı
varsayılan şube seçimi hatası deterministik regresyon testiyle kapatıldı.

### Paneller ve vardiya bütünlüğü

Admin menüsünde **Paneller** vardır. Yönetici kendi mevcut kullanıcı adı ve
parolasıyla Garson/Kasiyer panelini seçer; başka çalışan kimliğine geçmez.
Grant 10 dakika geçerli, kullanıcı/tenant/şube/panel/mevcut session/token family
ve rol-yetki imzasına bağlıdır. Başarısız girişler hız sınırına ve audit'e;
giriş, değişim ve çıkış audit'e yazılır. Aynı session'daki grant üretimi satır
kilidiyle sıralanır. Şube/rol/oturum değişimi veya süre dolması erişimi keser.

Kasiyer destek modunda yalnız masalar ve son 100 adisyon görüntülenir. Başka
kasiyerin vardiyası alınmaz; ödeme, vardiya açma/kapatma ve gün sonu API'leri
bu grant kapsamında 403 verir. Normal garson/kasiyer kendi hesabı/PIN akışını
kullanır. Garson destek işlemleri gerçek yönetici aktörüyle kaydedilir.
HttpOnly/SameSite cookie ve mevcut same-origin BFF mutasyon kontrolü korunur.
Parola ve PIN formları hydration tamamlanana kadar kapalıdır; varsayılan GET
submit yoluyla parolanın URL'ye yazılması engellenmiştir.

Vardiya ekranı geçmiş/açık vardiyalar/gün sonu kayıtları olarak ayrıldı.
Çalışan adı, tarih ve durum backend'de filtrelenir; 50'lik sayfalama 100 kayıt
sınırını aşar. Kapatılacak vardiya açıkça seçilir; vardiya kapatma ile iş günü
kapatma ayrı akışlardır. Açılış, satış, iadeler, beklenen/sayılan kasa, POS/Z
ve farklar backend Decimal değerlerinden gösterilir; eksik değer sıfırmış gibi
sunulmaz. Kapalı vardiyaların tutarları yeniden hesaplanmaz.

### Medya ve paket servis

Görsel sorunu birden fazla kök nedene sahipti: nesne sahibinin mutlak eski
URL ile aranması, aynı görseli paylaşan ürünlerde tek satır varsayımı, eski
nesneyi başka referans varken silme ve BFF'nin 304 cevabını hata sayması.
Bunlar giderildi. Eski domain altında kaydedilmiş yönetilen görseller mevcut
origin'e yönlenir. UUID içeren eski nesne anahtarları DB/MinIO taşımadan opak
public alias üzerinden okunur; tenant kimliği public yanıtta açılmaz.
Nesne sahipliği ve tenant/branch eşleşmesi yine backend'de doğrulanır.

Ortak `MediaImage`, admin ürün listesi/düzenleme, QR yükleme önizlemesi ve QR ürün/header alanlarında gerçek
yükleme hatasını tutarlı fallback ile gösterir; URL değişince tekrar yükler.
Yönetilen API görselleri Next optimizer'ın ayrı negatif cache/domain kontrolünü
atlayarak mevcut ETag/cache yolunu kullanır. Yeni upload yeni nesne URL'si üretir.

Manuel formda yalnız Gel-Al ve Paket Servis vardır. PHONE enum'u ve geçmiş
okuma desteği korunur. Paket servis için il, ilçe ve açık adres API'de de
zorunludur; şehir/ilçe boşluk veya tek karakter olamaz. Mahalle, adres tarifi,
sipariş notu ve ödeme yöntemi taşınır. Marketplace/tarihsel city nullable kalır.
Belirsiz ağ hatasında aynı niyetin gövdesi ve idempotency key'i sabit tutulur;
farklı içerikle aynı anahtar 409 verir. Başarıdan sonra yeni niyet anahtarı üretilir.

Mevcut COURIER motorunda **PAKET SERVİS** / **GEL-AL** başlığı, şehir/ilçe/mahalle,
adres tarifi, aktör/kurye ve mevcut ürün/not/ödeme/toplam bilgileri kullanılır.
Aynı orijinal baskı isteği tek print job döndürür. 32/42/48 sütun uzun Türkçe
adres testleri vardır; journal ve belirsiz baskı için otomatik tekrar kuralı
değiştirilmemiştir.

### Rapor, yazıcı ve admin deneyimi

Gerçek A4 PDF, backend rapor snapshot'ından ReportLab ile üretilir. Noto Sans
Türkçe fontları, Dixora logosu, başlık/şube/tarih, sayfa numarası, tekrar eden
tablo başlıkları, satış/tahsilat/iade/net tahsilat, vardiya ve gün sonu verileri
vardır. Resmi mali fiş olarak sunulmaz. Ekran ve PDF aynı uygulanan filtreleri
ve Decimal veri tanımını kullanır. İade kendi tarihinde, satış kendi mevcut
rapor tanımında sayılır; önceki tarihli satışın bugünkü iadesi testi eklendi.
Şube saat diliminde kapsayıcı gün aralığı UTC yarı açık aralığa çevrilir;
aralık en fazla 366 gündür. Eksik kapanış/POS verisi **Veri yok** gösterilir.

Yazdırma rehberi gerçek backend verisinden dört adımı, yüzde ilerlemeyi ve
sıradaki işi gösterir. Yazılım PRINTED sonucu fiziksel kağıt onayı sayılmaz.
Operatör yalnız güncel eşleşmedeki PRINTED TEST işi için fiziksel kabulü audit'e
yazabilir. Bilgisayar kaldırma token'ı iptal eder, aktif eşlemeleri çözer,
geçmiş bridge ve print job kayıtlarını korur. Kaldırılanlar ayrı görünür;
aynı isimle yeni aktif bilgisayar eklenebilir. Belirsiz işler yeniden basılmaz.

Sadakat ekranında genel bakış/program/müşteriler/ödüller bölümleri, gerçek
istatistikler, arama/durum filtreleri, hazır model/önizleme ve gizli gelişmiş
ayarlar vardır. Kritik kural değişikliği onay ister; ödül hesaplama motoru
değiştirilmemiştir. Audit görüntülemesi Türkçe eylem/alan ve önce-sonra farkı,
tenant kapsamındaki aktör/şube/kaynak adlarını kullanır. Hassas alanlar backend
ve görünümde temizlenir; eski audit satırları güncellenmez. Açılış nakdi gibi
finansal alanlar gizlenmez. Bilinmeyen eylem kodu kaybolmaz.

İşletme ayarlarındaki yinelenen parola kartı kaldırıldı; profil akışı ve API
korundu. Çalışan ikonlarında hover/focus tooltip, mevcut aria-label ve dokunmatik
cihazda metin alternatifi vardır. Kasa masaları ortalı kare grid, seçimde sol
bağlam/ana adisyon ve Masalar'a dönüş kullanır; F2/F3/F4 işlevleri korunur.

Garson masa kartları normal akışta yerleşir; uzun adlar ve durum/işlem metni
üst üste gelmez. Sipariş/modifier/sepet kontrolleri, alt navigasyon, safe-area,
odak ve yaklaşık 44 px hedefler iyileştirildi. Mevcut sipariş, iptal, geçmiş ve
bildirim iş kuralları korunmuştur.

## Migration ve API sözleşmeleri

| Revision                         | Değişiklik                                     | Geçmiş veriye etkisi                                                         |
| -------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `0041_role_operational_profile`  | Nullable rol profili                           | Var olan finansal satırlar değişmez; eski özel rol güvenli fallback kullanır |
| `0042_operation_grants`          | Kısa ömürlü, session'a bağlı grant tablosu     | Eski oturum/parola/finansal kayıtlar taşınmaz                                |
| `0043_delivery_city_fingerprint` | Nullable city ve request_hash                  | Eski PHONE/marketplace adresleri ve tutarlar korunur                         |
| `0044_active_bridge_names`       | Yalnız aktif bridge adına partial unique index | Retired kayıt silinmez/yeniden adlandırılmaz                                 |

0044 downgrade sırasında aynı isimde birden fazla retired kayıt varsa eski
unique constraint bilinçli olarak reddeder; operatör çözümü gerekir. Otomatik
silme yapılmaz. Boş metadata-bootstrap ve 0040'tan gerçek PostgreSQL upgrade
yolları doğrulandı. Eski kodla oluşturulan PAID siparişin `123.45` tutarı ve
durumu upgrade sonrasında aynen kaldı.

Tüm yollar `/api/v1` altındadır; web mevcut `/api/backend` BFF'sini kullanır.

| Yol                                                | Sözleşme / kapsam                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| POST/PATCH `/roles`, GET `/permissions`            | Gerçek özel rol, devredilebilir izin listesi, operasyon profili                  |
| POST `/auth/operation-grant`                       | Kendi username/password + panel; 10 dakikalık grant                              |
| GET `/auth/operation-access?panel=…`               | `staff` veya `support`; izinsiz 403                                              |
| DELETE `/auth/operation-grant`                     | Mevcut oturumdaki destek grant'ını iptal                                         |
| GET `/reports/financial-summary`                   | Şube kapsamı ve branch-local tarih; ortak finansal snapshot                      |
| GET `/reports/export.pdf`                          | Aynı tarih/izin ile `application/pdf` attachment                                 |
| GET `/printing/physical-acceptance`                | Güncel eşlemeler için kanıtlı cihaz ID'leri                                      |
| POST `/printing/jobs/{id}/physical-confirmation`   | PRINTED TEST + güncel mapping + audit                                            |
| GET `/shifts/history`, `/shifts/day-close/history` | Offset/limit; vardiyada employee/status/date filtreleri                          |
| POST `/delivery`                                   | Nullable saklama city; yeni OWN_DELIVERY için il/ilçe/adres zorunlu; fingerprint |
| GET `/audit`                                       | Salt okunur hassas veri temizliği ve tenant kapsamındaki adlar                   |

## Doğrulama ortamı ve sonuçlar

Kullanıcının mevcut 3000/8000 portlu geliştirme stack'i değiştirilmedi. Ayrı
Compose projelerinde gerçek PostgreSQL/Redis/MinIO/API, 18000 ve 18001 API
portları, yerel web 13000 kullanıldı. Veritabanları/medya validation projesine
aittir. Production verisi veya secret'ı okunmadı; deployment/push/merge yapılmadı.

Pytest'in mevcut API fixture'ları bellek içi SQLite kullanır. PostgreSQL advisory
lock, migration ve gerçek HTTP/BFF davranışı ayrıca izole PostgreSQL/Redis/MinIO
ortamında iş günü, eşzamanlı tekrar ve tarayıcı senaryolarıyla doğrulanmıştır.

Başlangıç: API **431 geçti**, web **412 geçti / 82 dosya**, Bridge **77 geçti**.
Son tam sonuçlar 5 Kasım koşularının gerçek çıktılarıdır.

| Kontrol                        | Gerçek sonuç                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| API tam pytest                 | **464 geçti**, 772,73 saniye; `pytest -q --maxfail=1` tüm testleri tamamladı                              |
| Ruff / mypy                    | Geçti; 115 kaynak dosyasında mypy hatası yok                                                              |
| Web Vitest                     | 418 geçti / 85 dosya                                                                                      |
| Web TypeScript                 | Geçti                                                                                                     |
| Web ESLint                     | 0 hata, 2 mevcut uyarı: kullanılmayan test parametresi ve location.assign navigasyonu                     |
| Next production build          | Next 16.4.5 ile geçti                                                                                     |
| Print Bridge                   | 80 geçti; Windows üzerinde TypeScript ve build geçti                                                      |
| Ops unittest                   | 25 geçti; TLS mekanizması için 6 yeni test dahil                                                          |
| Migration                      | Boş DB head 0044 ve eski kodla doldurulmuş 0040 → 0044 geçti                                              |
| Gerçek PostgreSQL HTTP iş günü | 9 kontrol geçti: ödeme/iade tekrarları, net POS, vardiya, devir, gün sonu                                 |
| 20 eşzamanlı tekrar            | 1 sipariş, 1 ödeme, 1 print job; farklı gövde 409                                                         |
| Playwright                     | **11 geçti** (3,7 dakika); genişletilen gerçek dosya seçme/kırpma/görsel güncelleme kontrolü ayrıca geçti |

[Makine okunur sonuç özeti](evidence/operational-2026-11-04/validation-results.json)
aynı sayıları, ortamı ve yapılmayan kabul kontrollerini içerir. API dizininde
`pytest -q --maxfail=1`, `ruff check .` ve `mypy app`; depo kökünde aşağıdaki
komutlar kullanılır. Tarayıcı koşusu için izole API 18000, web 13000 ve kurulu
Chromium/WebKit gerekir; production verisine yönlendirilmemelidir.

```sh
npm run test --workspace web
npm run typecheck --workspace web
npm run lint --workspace web
npm run build --workspace web
npm run test:e2e --workspace web
npm run test --workspace @dixora/print-bridge
npm run typecheck --workspace @dixora/print-bridge
npm run build --workspace @dixora/print-bridge
python -m unittest discover -s ops -p 'test_*.py'
```

İlk tam regresyonda eski kurye başlığı testi başarısız oldu; orijinal ve
yeniden baskı beklentileri PAKET SERVİS başlığına, fixture il alanına güncellendi. İade tarihi testinin
ortaya çıkardığı naive/aware datetime karşılaştırması UTC normalizasyonuyla
düzeltildi. Typecheck, bir test mock'unun çağrı tipi daraldığı için bir kez
başarısız oldu; fetch tipini koruyarak düzeltildi. Bunlar gizlenmiş/skipped
testler değildir; son doğrulamalar yeniden çalıştırıldı.
Tam koşuda görülen aralıklı merkez şube seçimi hatası yalnız tekrar deneyerek
geçiştirilmedi: ortak kaynak-şube tercihi ve ters tarihli kayıt testi eklendi.
Bu düzeltmeden sonraki şube/rol/çoklu şube hedefli suite'i **31 geçti**.
Baskı regresyonundaki yeni işi zaman damgasından seçme varsayımı da kaldırıldı;
yeni işin kimliğiyle yalnız bekleyen kalemin gönderildiği doğrulanır. Son tam
suite'te başarısız veya atlanan test yoktur. İlk denemelerden kalan başarısızlıklar
sonuç tablosundaki temiz koşuyla karıştırılmamıştır.

### A–H kabul kanıtları

| Senaryo | Kanıt ve sınır                                                                                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A       | Playwright gerçek BFF/API: doğrudan URL reddi, kendi reauth, kasa gözlem, vardiya API 403, çıkış                                                                                       |
| B       | UI ile kendi PIN'iyle vardiya açma/kapatma, gerçek ödeme/retry API, yönetici geçmişi ve sıfır fark geçti; iş günü script'i ayrıca iade/devir/gün sonunu doğrular                       |
| C       | UI özel rol ve çalışan oluşturma/atama; yeni hesapla gerçek sipariş 201, ödeme 403                                                                                                     |
| D       | Gerçek MinIO upload/update/delete; admin liste/düzenleme ve QR'de doğru yeni URL/naturalWidth kontrolü; UI'da dosya seçme, kırpma ve kaydetme; component fallback testi                |
| E       | UI il/ilçe/adres tarifiyle paket siparişi; gerçek COURIER job payload ve tek orijinal kontrolü; fiziksel çıktı yok                                                                     |
| F       | Uygulanan tarih filtresiyle gerçek PDF indirme; API/PDF metin/tutar mutabakat testi. Son örnekte satış/tahsilat 140 TL, beklenen/sayılan nakit 240 TL, fark 0 TL                       |
| G       | UI bağlantı kaldırma; eski bridge token 401; DB testinde tarihsel print job korunur                                                                                                    |
| H       | Pixel 7 Chromium: masa, Extra Cheese, not, sipariş, offline/reconnect, yeniden açılmış socket, backend'den kalıcı not ve hesap isteği bildirimi; WebKit iPhone gezinme/odak/yatay/dark |

Tarayıcı testlerinde API mock'u yoktur. Test verisi seed hesabı ve yerel validation
tenant'ıdır. Görsel testi gerçek HTTP upload/update/delete ile birlikte tarayıcı
dosya seçme/kırpma/kaydetme akışını da çalıştırır; yeni görselin yalnız yüklenmesi
değil, admin ve QR'deki kaynak URL'sinin gerçekten değişmesi doğrulanır.
Ekran görüntüleri geliştirme sunucusundan alınmıştır; yalnız geliştirici araç
düğmeleri screenshot sırasında gizlenir. Production build başarılı olsa da
yerel production sunucusu başlatma komutu otomatik onay denetimi tarafından
`blocked by policy` gerekçesiyle reddedildi; bu çalışma zamanı kontrolü yapılmadı.

Kanıtlar: [rapor](evidence/operational-2026-11-04/reports.png),
[indirilen PDF](evidence/operational-2026-11-04/sample-report.pdf),
[kasa destek](evidence/operational-2026-11-04/cashier-support.png),
[özel rol/çalışan](evidence/operational-2026-11-04/custom-role-employee.png),
[garson telefon](evidence/operational-2026-11-04/waiter-tables-390.png),
[garson masaüstü](evidence/operational-2026-11-04/waiter-tables-1440.png),
[Android sipariş](evidence/operational-2026-11-04/waiter-order-android.png),
[Android bildirim](evidence/operational-2026-11-04/waiter-notifications-android.png),
[iOS koyu tema](evidence/operational-2026-11-04/waiter-ios-dark.png),
[paket adresi](evidence/operational-2026-11-04/courier-address.png),
[kaldırılan bağlantı](evidence/operational-2026-11-04/revoked-bridge.png),
[kasa kare masalar](evidence/operational-2026-11-04/cashier-square-tables.png),
[vardiya geçmişi](evidence/operational-2026-11-04/shift-history.png).
Ek kanıt: [okunabilir audit detayı](evidence/operational-2026-11-04/audit-readable.png).

### Cihaz matrisi

| Ortam                                              | Otomasyon                                                                                                                      | Manuel kabul                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Chromium: 320/360/375/390/412/430/768/1024/1440 px | Masalar, sipariş listesi/detayı, masa ürün seçimi, bildirimler ve profil: 54 ekran/genişlik kontrolü; uzun not; açık/koyu tema | Fiziksel dokunma ve uzun servis denemesi yapılmadı               |
| Pixel 7 / Chromium                                 | Modifier, not, gönderme, offline ve reconnect                                                                                  | Gerçek Android Chrome/klavye yapılmadı                           |
| iPhone 13 / WebKit                                 | Masalar/siparişler/bildirimler/profil, odak, dark, yatay viewport                                                              | Gerçek iOS Safari/soft keyboard/safe-area cihaz kabulü yapılmadı |
| Windows Print Bridge                               | 80 unit, TS build/typecheck, spooler/journal sözleşmeleri                                                                      | Gerçek 80 mm termal kağıt yok                                    |
| macOS / Linux                                      | Platform kodlarının mock regresyon testleri                                                                                    | Native macOS paket/CUPS/hardware build ve kabul yapılmadı        |

Gerçek cihazda dikey/yatay geçiş, klavye açıkken modifier/not ve gönderme,
uzun ürün/adres, zoom, VoiceOver/TalkBack, bağlantı kopması/yeniden bağlanma ve
aynı niyetin tek gönderimi pilot öncesi işletme temsilcisiyle doğrulanmalıdır.

## SSL, yedekleme ve pilot öncesi işlemler

`ops/reload_tls.py` mounted public leaf ile loopback'te gerçekten sunulan TLS
leaf hash'ini karşılaştırır. Değişmişse önce `nginx -t`, sonra reload, ardından
yeni hash'i yeniden okur. Aynı sertifikada no-op; yanlış config ve eski sertifika
sunulmaya devam ederse hata döner. Dry-run hiçbir Docker/TLS çağrısı yapmaz.
Timer 5 dakikada bir çalışır, hata mevcut `dixora-alert@` servisine gider.
Certbot'a Docker socket verilmemiştir. Unit testlerde no-op, dry-run, bozuk
config, stale sertifika ve geçersiz domain doğrulandı; gerçek ACME yenileme
ve production TLS kabulü yapılmadı.

Yetkili operasyon sorumlusu, bakım penceresinde ve gerçek ortamda:

1. Yedek aldıktan sonra 0041–0044 migration'larını ve normal deploy prosedürünü uygular.
2. `/srv/dixora` checkout'u, Docker erişimli `dixora` kullanıcısı, production
   Compose env'i ve `/etc/dixora/monitor.env` içindeki `DIXORA_DOMAIN` ayarını
   doğrular. Secret dosyalarını repoya koymaz.
3. `ops/systemd/dixora-tls-reload.service` ve `.timer` dosyalarını systemd dizinine
   kurar; `systemctl daemon-reload`, ardından `systemctl enable --now dixora-tls-reload.timer`
   çalıştırır. Önce `python3 ops/reload_tls.py --domain DOMAIN --dry-run`, sonra
   service ve journal üzerinden gerçek mounted/served eşleşmesini doğrular.
4. Certbot staging/dry-run ve uygun yenileme denemesiyle Nginx'in yeni sertifikayı
   gerçekten sunduğunu ve başarısız service alarmının teslim edildiğini sınar.
5. [Mevcut operations rehberine](operations.md) göre şifreli uzak restic hedefini,
   retention/timer/monitor ayarlarını kurar; yeni izole DB ve bucket'a offsite
   restore yapıp checksum/row-count ve geri dönüş süresini kaydeder.
6. Windows/macOS yazıcı, mutfak/bar/kasa yönlendirmesi ve 80 mm Türkçe fişi fiziksel
   olarak kontrol eder; yalnız gerçek kağıt alındıktan sonra fiziksel kabul verir.
7. Yukarıdaki gerçek telefon/erişilebilirlik ve yerel production runtime kontrollerini tamamlar.

Mevcut offsite preflight/şifreleme/checksum, güvenli fresh restore, monitor ve
alarm kodları incelendi; ilgili 25 ops testi geçti. Uzak restore, gerçek alarm
teslimatı veya fiziksel donanım doğrulanmış sayılmaz. Bu nedenle bu rapor tek
başına 10 işletmelik pilot için koşulsuz production onayı değildir.

## Bağımlılıklar ve kalan riskler

Next 16.2.12, aynı major'daki 16.4.5'e yükseltildi; root/web sürümleri ve lock
eşitlendi. [Resmi sürüm kaydı](https://github.com/vercel/next.js/releases/tag/v16.4.5)
ve [Windows RCE advisory'si](https://github.com/advisories/GHSA-p293-qw3h-jr36)
kontrol edildi. Mevcut sharp override 0.35.5'e ve CLI zincirindeki proxy-addr
2.0.8'e güncellendi ([sharp](https://github.com/lovell/sharp/releases/tag/v0.35.5),
[proxy-addr güvenlik düzeltmesi](https://github.com/jshttp/proxy-addr/releases/tag/v2.0.8)).
Playwright yalnız geliştirme bağımlılığıdır; ReportLab PDF ve pypdf test içindir.
Font lisansı asset'lerle birlikte saklanır.

Son `npm audit`: **53 bulgu — 0 kritik, 12 yüksek, 40 orta, 1 düşük**.
Next/sharp/proxy-addr bulguları kaldırıldı. Kalanlar arasında Zod 3'ün yeni
major gerektiren collection sınırı, Electron 44.2.0, shadcn/MCP araç zinciri,
Vite/undici ve transitive paketler vardır. Kör `audit fix --force` ile Zod,
Electron veya araç major'ları değiştirilmedi. Bunlar giderilmiş değildir;
özellikle dağıtılacak Print Bridge Electron sürümü ve Zod geçişi pilot öncesi
ayrı uyumluluk/regresyon çalışması ister. BFF login gövde boyutu sınırı korunur.

Diğer sınırlar: PDF senkron DB snapshot ve worker-thread render kullanır,
asenkron rapor kuyruğu eklenmemiştir. Destek kasa listesi açıkça son 100
adisyonla sınırlıdır. Fiziksel kabul operatör beyanıdır; donanımdan otomatik
sensör doğrulaması değildir. Gerçek cihaz/emülasyon ve yazılım/fiziksel baskı
ayrımları kasıtlı olarak korunur.

## Commit kaydı ve teslim durumu

Kod sonuç SHA: `93a337b1ee817cf7ae61ffd2539ba69bf3738584`.
Başlangıç main ve yerel SHA'ları belgenin başındadır. Kod bu çalışma dalında
commit'lidir; kullanıcıya ait başlangıç değişiklikleri staging'e alınmamıştır.

| Commit    | İncelenebilir kapsam                                                     |
| --------- | ------------------------------------------------------------------------ |
| `97ad789` | Next güvenlik güncellemeleri ve tarayıcı test bağımlılıkları             |
| `8351b81` | Güvenli TLS reload/gerçek sunulan sertifika kontrolü ve testleri         |
| `0595cc5` | Oturum/şube/RBAC, operasyon grant, medya, PDF, teslimat ve migration'lar |
| `9ef3e54` | Admin/kasa/garson arayüzleri ve tarayıcı senaryoları                     |
| `ca56494` | Ortak varsayılan şube tercihi ve emekli profil koruması                  |
| `6edd222` | Baskı regresyonunu iş kimliğine bağlayan kontrol                         |
| `4c55486` | Standart audit eylemleri/alanları, iç içe farklar ve testler             |
| `93a337b` | Ortak medya önizlemeleri ve gerçek tarayıcı kırpma akışı                 |

Yazılım uygulaması ve erişilebilir otomatik kontroller tamamlandı. Gerçek donanım,
offsite restore/alarm teslimatı, native macOS/CUPS ve engellenen production runtime
kabulü yukarıda açıkça ayrılmıştır. Bu rapor ve kanıtları taşıyan son dokümantasyon
commit'i teslim mesajında ayrıca bildirilir. Production deploy veya main'e push/merge
yapılmamıştır.
