# Dixora production readiness raporu — 27 Ekim 2026

**Karar: İlk 10 işletmede gerçek satış pilotu için henüz onay verilmemeli.**
Güvenle uygulanabilen P0 düzeltmeleri ve test altyapısı hazırlandı. Fiziksel
yazıcı, mali cihaz entegrasyonu, gerçek offsite kurtarma ve operatöre alarm
teslimatı hâlâ kabul kapılarıdır. Kısa yerel test, 30 işletmelik production
kapasitesini veya hukuki uygunluğu kanıtlamaz.

## İncelenen sürüm ve mevcut mimari

- Başlangıç dalı: `feat/ci-backup-business-day-validation`.
- İncelenen PR #10 head: `96209869d136f4a65f6b494b8030d68b844522bc`.
- Main / PR base: `a76dbbb1f88d49b19417fe4068be8cdd047bdd8b`.
- Çalışma dalı: `feat/production-reliability-p0`, PR #10 head'inden açıldı.
- [PR #10](https://github.com/mhalitekici/dixora-web/pull/10) açık ve taslak;
  main'e göre 36 dosya, 2.066 ekleme ve 167 silme. Kasa iadesi, net POS mutabakatı,
  PostgreSQL+MinIO paketi, yeni hedefe restore, restic ve systemd backup zaten vardı.
- [PR CI 39134810571](https://github.com/mhalitekici/dixora-web/actions/runs/39134810571)
  GitHub connector ile doğrulandı: API, Web, migrations, deployment configuration
  ve business-day/backup restore işlerinin beşi de `success`.
- FastAPI modüler monolit, Next.js, PostgreSQL, Redis fan-out, MinIO ve yerel
  bridge korundu. Tenant ve şube server context'inden gelir; Decimal finansal
  hesaplar, kalıcı baskı işleri ve mevcut UI/domain modülleri yeniden yazılmadı.
- Kullanıcının önceden bulunan `skills-lock.json`, video/ürün klasörleri,
  `brag-output/` ve `docs/system-analysis-2026-10-23.md` değişiklikleri korunmuştur.

Bu dalın değişiklikleri main'e push edilmedi, PR merge edilmedi, canlı deployment
yapılmadı. Production secret veya gerçek harici ödeme/bildirim servisi kullanılmadı.

## Doğrulanan kritik sorunlar ve düzeltmeler

| Önem | Bulgu                                                                                                                                               | Uygulanan düzeltme ve kanıt                                                                                                                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0   | Sipariş ve baskı tekrar anahtarları farklı şube kaydını döndürebiliyordu. QR tekrarı farklı masa bağlamını kontrol etmiyordu.                       | Replay öncesi şube/masa kontrolü; yeni komutlarda kalıcı SHA-256 istek özeti, farklı içerikte 409. API regresyonları.                                                                                                                     |
| P0   | Ödeme anahtarı başka sipariş/yöntem/tutar/reference için başarı gibi yanıt verebiliyordu.                                                           | Aynı sipariş, şube, yöntem, Decimal tutar ve reference eşleşmesi zorunlu. Aynı anahtarın farklı tahsilata kullanımı 409.                                                                                                                  |
| P0   | `POST /orders` mevcut adisyona eklenen komutu, hesap kapandıktan sonra yeni sipariş olarak işleyebiliyordu.                                         | `OrderOperation` içindeki yaratma isteği özetiyle özgün adisyon tekrar döndürülür; yeni kalem/sipariş oluşmaz.                                                                                                                            |
| P0   | Kasa ağ hatası sonrası yeniden tıklamada yeni anahtar üretip tekrar kalem/ödeme yazabiliyordu.                                                      | Başarılı yanıt alınana kadar özgün endpoint, body ve anahtar bellekte tutulur. Ekran yenilemesi create → append değiştirse bile özgün komut kullanılır.                                                                                   |
| P0   | Eşzamanlı API worker'ları aynı anahtarda yarışabiliyordu.                                                                                           | PostgreSQL transaction advisory lock + mevcut unique constraint'ler. İki worker üzerinde sipariş, ödeme ve baskı için 20'şer paralel tekrar tek kayıt verdi.                                                                              |
| P0   | Bridge bozuk günlüğü boş sayıyor; seri alınan beş işin lease'i baskıdan önce dolabiliyordu.                                                         | Günlük doğrulama başarısızsa baskı durur; dosya fsync + atomik rename. Aynı journal için süreç kilidi; runtime bir seferde bir iş alır, heartbeat baskıdan bağımsızdır.                                                                   |
| P0   | Lease süresi bitince sonucu belirsiz fiziksel iş yeniden otomatik gönderilebiliyordu. Beş deneme sonrası sayaç sıfırlanıp eski ACK ile çakışıyordu. | Lease expiry → manuel kontrol; sahip/attempt korunarak geç PRINTED onayı mümkün. Attempt monoton kalır. Ağ dönünce journal onayı süreç yeniden başlamadan tekrarlanır; fiziksel gönderim tekrarlanmaz.                                    |
| P0   | macOS `lp` kabulünü doğrudan PRINTED sayıyordu.                                                                                                     | Yerel CUPS iş ID'si saklanır; IPP durumunda yalnız 9 tamamlanmadır. İptal/abort/durma ve okunamayan durum belirsiz hata olur; otomatik yeni kağıt üretilmez.                                                                              |
| P0   | Yazıcı yokken oluşan hiç denenmemiş istasyon işi sonradan da cihaz alamıyordu.                                                                      | Yapılandırma düzeldiğinde yalnız aynı tenant/şubede, hiç denenmemiş PENDING istasyon işi doğru hazırlık yazıcısına bağlanır; iş ID'si korunur. KDS ile kabul davranışı korunur.                                                           |
| P0   | Tarayıcı interneti var diye canlı bağlantı açık gösteriliyordu; eski socket kapanışı yeni branch bağlantısını etkileyebiliyordu.                    | WS durumu ayrı gösterilir, tüm operasyon ekranlarında erişilebilir bağlantı uyarısı vardır; dönüşte yeni tek kullanımlık ticket alınır, aktif veriler refetch edilir, eski socket olayları yok sayılır.                                   |
| P0   | Readiness yalnız DB'yi görüyordu; frontend hatası merkezileşmemişti. Ham reporter/erişim logları hassas veri taşıyabiliyordu.                       | DB/Redis/MinIO bounded-parallel probe; özel baskı health endpoint'i; sabit şemalı, auth/rate-limit korumalı frontend hata kanalı. Body/query/cookie/PII/Sentry locals temizliği, route şablonu ve UUID request ID, sade Nginx access log. |
| P0   | Türkiye restoran/kafe akışında yeni siparişe otomatik servis/kuver eklenebiliyordu.                                                                 | Yeni sipariş snapshot'ı sıfır; enable isteği 422; UI etkinleştirmesi kapalı. Eski kayıtlar/mali toplamlar migration ile yeniden hesaplanmaz. Tarihsel snapshot regresyonu korunur.                                                        |
| P0   | Backup başarısızlığı için izlenebilir başarı zamanı/alarm bağlantısı eksikti.                                                                       | Başarılı akıştan sonra atomik last-success receipt; freshness/offsite/quiesce kontrolü, salt okunur monitor ve systemd OnFailure/journal alarm şablonları. Hata sonrası writer restart ve başarısız restore testleri.                     |

`0040_command_fingerprints` üç nullable kolon ekler; eski finansal veriyi veya
anahtarları değiştirmez. İlk migration güncel metadata kullandığından kolonların
zaten bulunduğu bootstrap yolunu da kabul eder. Hem bu yol hem mevcut tabloya
artımlı ekleme test edildi; PostgreSQL boş kurulum head'e ulaştı. Eski, hash'i
olmayan kayıtlarda geçmiş isteğin tam gövdesi yeniden kurulamaz; bu kayıtlar için
tam içerik eşleşmesi garantisi ileri sürülmez, mevcut erişim kontrolleri uygulanır.

## Değişen dosyalar

| Grup                     | Dosyalar / kök                                                                                                                                                                                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API komut bütünlüğü      | `apps/api/app/services/idempotency.py`, `services/orders.py`, `api/qr.py`, `api/printing.py`, `models/orders.py`, `models/printing.py`, `models/qr.py`, `alembic/versions/0040_command_fingerprints.py`                                                                                                               |
| API sağlık/hata/politika | `apps/api/app/api/{system,diagnostics,organization,router}.py`, `app/{main,logging,errors,observability}.py`, `services/media_storage.py`                                                                                                                                                                             |
| Backend regresyonları    | `apps/api/tests/test_{production_reliability,command_migration,observability,orders,print_bridge_hardening,branch_management}.py`                                                                                                                                                                                     |
| Bridge                   | `apps/print-bridge/src/{agent-runtime,api-client,bridge,journal,macos-printer,process-exec}.ts`, yeni `cups-job.ts`, `runtime-lock.ts` ve ilgili testler                                                                                                                                                              |
| Frontend                 | `cashier/cashier-workspace.tsx`, `admin/branch-settings.tsx`, `layout/operational-shell.tsx`, `providers/{realtime-sync,app-providers,error-reporting}.tsx`, `hooks/use-websocket.ts`, `stores/connection-store.ts`, `lib/{pending-command,report-incident}.ts`, `app/error.tsx` ve testler (`apps/web/src/` altında) |
| Operasyon / CI           | `.github/workflows/ci.yml`, `docker-compose.prod.yml`, `infrastructure/{docker-compose.validation.yml,docker/api.Dockerfile,nginx/templates/dixora.conf.template}`, `ops/{backup.py,monitor.py,validate_idempotency.py,install-backup-timer.sh,test_backup.py,test_monitor.py}`, `ops/systemd/`                       |
| Yük testi / belgeler     | `apps/api/loadtest/{seed_pilot,pilot_load,audit_pilot,sample_resources}.py`, README ve sonuç JSON'u; bu rapor, `docs/observability.md`, `docs/printing-hardware-acceptance.md`, `docs/p1-p2-backlog.md`                                                                                                               |

## Test sonuçları

**Son Linux API tam taraması: 431 test geçti (704 saniye).** Güncel API kodu,
migration ve test dosyaları izole validation container'ına kopyalanarak
çalıştırıldı. API Ruff ve mypy de geçti.

- İlk Windows API tam taraması: **421 geçti, 2 başarısız**. İki test eski otomatik
  servis ücretini bekliyordu; yeni siparişin sıfır ücretli olması ve tarihsel
  snapshot'ın korunması şeklinde düzeltildi. Ardından **17 sipariş/migration** ve
  **45 P0/bridge-protokol/observability** testi geçti.
- Web son tam tarama: **412 test / 82 dosya geçti**. TypeScript ve production
  build geçti; ESLint 0 hata, önceden bulunan iki kullanılmayan test parametresi uyarısı.
- Print Bridge: **77 geçti**, typecheck ve build geçti. Bunlar OS çağrıları/CUPS
  cevaplarını simüle eder; gerçek Windows veya macOS yazıcı kabulü değildir.
- Backup/offsite/monitor güvenlik testleri: **19 geçti**.
- PostgreSQL, Redis ve MinIO yalnız izole validation ortamında tek tek `docker pause`
  ile duraklatıldı: her durumda readiness 503 ve ilgili bağımlılık false, liveness
  200 döndü. Unpause sonrası readiness 200 oldu; depolama silinmedi.
- İzole iki worker'lı PostgreSQL HTTP iş günü: oluşturma, tekrar, split ödeme,
  nakit/kart iadesi, tekrar iade, masa kapatma, devir, vardiya/gün sonu mutabakatı
  ve fazla tahsilat reddi geçti.
- Her komuta 20 paralel istek: **1 sipariş, 1 ödeme, 1 baskı işi**; değişen gövde 409. `ops/validate_idempotency.py` yeniden çalıştırılabilir.
- Gerçek yerel DB+MinIO backup/restore: quiesce edilmiş paket doğrulandı; **yeni
  DB/bucket'ta 85 tablo ve 2 medya nesnesi** doğrulandı. Eski hedefler silinmedi.
  Restic kodu PR #10 CI'da başarılıydı; bu turda gerçek offsite veya yeni şifreli
  uzak kurtarma yapılmadı. Yerel receipt `offsite_verified=false` olarak kalır.
- Local/prod Compose, production Settings (yalnız geçici test değerleri), Nginx
  TLS yapılandırması ve API production image build geçti. Nginx testinde tek
  günlük test sertifikası nedeniyle stapling uyarısı vardı; syntax başarılı.
- Backup shell syntax ve systemd unit doğrulaması geçti. Unit'ler geçici Linux
  container'ında kontrol edildi; host Docker servisi için yalnız doğrulama stub'ı
  kullanıldı, gerçek unit başlatılmadı.
- Root `npm run format:check`, bu çalışmada değiştirilmeyen **22 dosyadaki** mevcut
  biçimlendirme borcu nedeniyle başarısız. Değişen, bu kontrole dahil dosyalar ayrı
  Prettier kontrolünden geçiyor; toplu ilgisiz format değişikliği yapılmadı.
- Yeni CI'a Windows/macOS/Linux bridge typecheck/test/build ve yük aracı smoke +
  veri denetimi eklendi. Bu dal push edilmediği için yeni GitHub matrisi henüz
  çalışmış sayılmaz; PR #10'un beş başarılı işiyle karıştırılmamalı.

## 30 işletme ölçümü

[Yeniden çalıştırma talimatı](../apps/api/loadtest/README.md),
[paylaşılabilir ölçüm JSON'u](../apps/api/loadtest/results/pilot-2026-10-27.json).

Windows Docker Desktop üzerinde, ayrı `dixora-p0-validation` projesi,
PostgreSQL/Redis/MinIO ve iki API worker'ı. 30 farklı tenant/şube, 150 farklı
personel oturumu, 60 simüle yazıcı. Hedef 900 sipariş/saat; **120 saniye** boyunca
24 personel ve 6 QR siparişi oluşturuldu. 30 tahsilat ve 60 simüle iş üretildi;
aynı anahtarlar tekrarlandı. Son DB denetimi sipariş, ödeme ve istasyon işlerini
tek tek doğruladı; HTTP/scenario hata kaydı yok, mükerrer simüle dispatch yok.

| Ölçüm                            |    p50 |    p95 |    p99 |
| -------------------------------- | -----: | -----: | -----: |
| Personel sipariş oluşturma, n=24 | 164 ms | 476 ms | 820 ms |
| QR sipariş oluşturma, n=6        | 133 ms | 990 ms | 990 ms |
| Tahsilat, n=30                   |  54 ms | 438 ms | 458 ms |
| Yazıcı claim, n=3572             |  38 ms | 306 ms | 862 ms |

Ölçüm aralığındaki 10 kaynak örneğinde API tepe CPU **%180,84** (bir mantıksal
çekirdek = %100), RAM **303,3 MiB**; PostgreSQL **216,4 MiB**, Redis **6,7 MiB**,
MinIO **132,2 MiB**. Örneklenen en yüksek DB bağlantısı **22**. Anlık gerçek pikler
örnekler arasında daha yüksek olabilir; makinede başka geliştirme işleri de vardı.

İlk deneme 18 sipariş/36 iş ve iki `RemoteProtocolError` ile başarısız oldu;
startup/SSL context hazırlığı ölçüm aracını geciktiriyordu. Başlangıç hazırlığı
ölçümden ayrıldı ve SSL context ortak kullanıldı. Ardından iki 30 siparişlik kısa
deneme hatasız tamamlandı; ilk başarısız sonuç gizlenmedi. Ham dosyalar ignored
`artifacts/p0-validation/` altında tutuluyor; fixture manifesti test credential
içerdiğinden paylaşılmamalı.

Bu, saatlik/uzun süreli kapasite kanıtı değildir. QR örneği azdır ve p95 önerilen
500 ms hedefinin üzerindedir. Ürünler sentetiktir ve stok takibi kapalıdır;
geniş tarihsel rapor, kalıcı WebSocket yükü, medya ve gerçek donanım ölçülmedi.
JSON'daki `capacity_validated` özellikle `false` bırakılmıştır.

## Mevzuat ve ödeme kapsamı

Ticaret Bakanlığının **30 Ocak 2026** açıklaması restoran/kafe benzeri yerlerde
zorunlu servis, masa ve kuver ödemelerinin istenemeyeceğini; gönüllü ilavenin farklı
olduğunu bildiriyor. Yeni otomatik ücret bu doğrulanmış kurala dayanarak kapatıldı.
Ürün/müşteri talebi olmadan bir kuver ürünü sepete ekleyen yeni davranış eklenmedi;
otomatik ücreti “bahşiş” diye yeniden adlandırma yapılmadı.
[Ticaret Bakanlığı açıklaması](https://tuketici.ticaret.gov.tr/haberler/ticaret-bakanligi-tarafindan-fiyat-etiketi-yonetmeliginde-degisiklik-yapildi).

Uygulamada ülke bazlı hukuki politika modeli olmadığından yeni otomatik ücret
şu anda ürün genelinde kapalıdır; başka ülkeler için uygunluk varsayılmadı.
Geçişte hâlen açık, eski ücret snapshot'ı taşıyan adisyonlar operatör ve mali
müşavirce incelenmelidir. Kapalı tarihsel finansal kayıtları otomatik düzeltmek
veya mevzuat istisnası yorumlayarak yeni tutar yazmak bu çalışmanın parçası değildir.

Restoran adisyonuna `CARD` ödeme/iade kaydetmek banka terminalinde çekim/iade
yapıldığını kanıtlamaz. Mevcut iyzico kodu platform abonelikleri içindir; etkin
merchant hesabı/production işlem kabulü yapılmadı. ÖKC, terminal ve mali belge
bağlantısı doğrulanmış değildir. Yazdırılan hesap adisyonunun mali ÖKC belgesi
olduğu ileri sürülemez.

GİB'in açıklamaları restoran harici satış yazılımları ile ÖKC bağlantısı için
üretici/protokol şartları bulunduğunu gösteriyor. İşletmenin mükellefiyetine ve
istisnalara uygulanacak kesin karar mali müşavir/ÖKC üreticisi ile alınmalıdır.
“POS'tan ayrı fiş kesilir” yaklaşımının tek başına yeterli olduğu varsayılmadı.
[GİB SSS](https://ynokc.gib.gov.tr/Home/SSS),
[GİB YN ÖKC rehber duyurusu](https://ynokc.gib.gov.tr/Home/DuyuruDetay/11135).

## Kalan production riskleri ve canlıda gerekenler

1. [Donanım kabul matrisi](printing-hardware-acceptance.md) gerçek Windows/macOS,
   kullanılan sürücüler, USB/ağ, kağıt bitmesi, spool beklemesi ve elektrik
   kesintisiyle tamamlanmalı. Installer'lar bu source ile yeniden üretilip sürüm
   eşliği doğrulanmalı. Bu turda yeni exe/dmg dağıtılmadı.
2. Kontrolsüz kapanış sonrası journal `.lock` dosyası operatör incelemesi ister;
   kör otomatik lock çalma yoktur. Manuel retry eski OS kuyruğundaki kağıdı
   ortadan kaldıramaz. Geç lease onayı ve çok uzun baskı sahada sınanmalı.
3. Kasa pending komutları bellek içindedir. Browser reload/cihaz değişiminde
   kaybolur. Ağ hatası sonrası yeni işlemden önce kayıt sonucu kontrol edilmeli;
   tam offline POS veya sınırsız exactly-once garantisi yoktur.
4. Realtime event commit sonrası yayınlanır; tüm olaylar için transaction outbox
   yoktur. Reconnect refetch/periyodik sorgular azaltıcı önlemdir. Açık WebSocket
   oturumunun iptal/rol değişimini periyodik doğrulaması ayrıca yapılmalı.
5. Şifreli bağımsız backup hedefi, encryption password'ın ayrı muhafazası,
   scheduler ve gerçek uzak restore tatbikatı production'da henüz doğrulanmadı.
   Bu ortamdan bunlar etkinleştirilmedi. Yerel restore kanıtı offsite kanıtı değildir.
6. [İzleme](observability.md) toplayıcıya bağlanmalı; alarmın gerçek operatöre
   teslimi test edilmeli. Monitor için token yenileme/salt okunur servis kimliği
   gerekir. DSN/alert credential'ları yapılandırılmadı. Nginx error log ve dış
   ajanlarda veri redaksiyonu ayrıca denetlenmeli.
7. En az bir saatlik profil ve uzun soak, gerçek veri hacmi, stok kilitleri,
   WebSocket ve bağlantı arızalarıyla tamamlanmalı. CPU pikleri/QR gecikmesi
   iyileştirme ve ayrı hedef sunucuda ölçüm gerektirir.
8. ÖKC/banka POS/mali belge kabulü ve ücret geçiş politikası pilot öncesi
   karara bağlanmalı; gerçek harici bağlantı yokken ticari sunumda var denmemeli.
9. Sertifika yenilenince Nginx'in yeni sertifikayı yüklemesi, alarm yetkileri ve
   platform bazında least-privilege erişimi canlı runbook ile kanıtlanmalı.

Validation projesi ve test dosyaları geliştirme bilgisayarında ayrıdır; mevcut
`dixora` geliştirme projesi/canlı sunucu verileri üzerinde reset/silme yapılmadı.
Canlı geçişte önce doğrulanmış yedek, sonra migration ve uygulama sürümü birlikte
planlanmalı; geri dönüşte yeni kayıtları kaybettirecek downgrade yapılmamalı.

## İlk yapılacak beş iş

1. Bir pilot şubede gerçek iki istasyon + kasa donanım matrisini ve güncel
   imzalı/sürümü doğrulanmış installer kabulünü tamamla.
2. Mali müşavir ve ÖKC üreticisiyle gerçek satış/mali belge akışını belirle;
   zorunlu entegrasyonlar, açık eski hesaplar ve gönüllü bahşiş için kabul al.
3. Yetkili sunucu operatörü bağımsız şifreli offsite backup/timer kurup yeni
   hedeflere restore tatbikatını tarih/RPO/RTO kaydıyla tamamlasın.
4. Readiness, baskı kuyruğu ve backup alarmlarını gerçek nöbet/iletişim kanalına
   bağla; sahte değil gerçek hata enjeksiyonunda teslim/eskalasyonu kanıtla.
5. Bu dalın yeni CI matrisi ve staging'de 1 saat/soak + arıza testlerini tamamla;
   ölçüm kapıları kapandıktan sonra 1 → 3 → 10 işletmelik kontrollü pilot kararı ver.

Sekiz ürün başlığının mevcut modüllerle örtüşmesi, bağımlılıkları, dosya planı ve
kabul ölçütleri [P1/P2 backlog'unda](p1-p2-backlog.md) yer alır.
