# Yerel Yazdırma Mimarisi

Dixora fiziksel yazıcıya merkezi API veya Docker konteyneri üzerinden erişmez.
Her şubede, yazıcının kurulu olduğu Windows ya da macOS bilgisayarında bir
**Dixora Print Bridge** çalışır. Bridge yalnızca dışarıya doğru Dixora API'ye
HTTPS istekleri açar; internetten şube bilgisayarına açılmış bir yazdırma portu
gerekmez.

Bu sınır, buluttaki bir hata veya başka bir şubenin hesabının yerel spooler'a
erişmesini engeller. Super Admin ekranı da bilgisayara sağlık isteği atmaz;
bridge'in API'ye gönderdiği son heartbeat kaydını gösterir.

## Siparişten istasyona

QR menü onayı, garson siparişi ve kasiyer siparişi aynı `accept_order` akışını
kullanır. Sipariş satırları ürünün hazırlık istasyonuna göre ayrılır ve her
istasyon için kalıcı bir baskı işi oluşturulur. Örneğin burger `Mutfak`, limonata
`Bar` cihazına gider. Fiş yeniden basımları da aynı job kaydı ve denetim izi
üzerinden ilerler.

Kasa/garson hesap fişleri ve sipariş hareketi detayındaki fiş önizlemesi bu
hazırlık fişlerinden ayrıdır. İşletme adı, masa, garson, tarih, içerik ve toplam
tutarı gösteren müşteri bilgi fişi, ilgili ekranın açık yazıcısına normal iş
akışıyla gönderilir.

## Güvenli teslimat

1. Bridge yalnız kendi şubesine ve sunucuda kendisine eşlenmiş cihazlara ait
   işleri claim eder. Yerel OS yazıcı adı, claim yanıtında sunucudan gelir.
2. Sunucu bir lease ve deneme numarası verir. `SENT`, `PRINTED` ve `FAILED`
   geçişleri bridge kimliği, deneme numarası ve idempotency key ile doğrulanır.
3. Bridge, OS spooler'a vermeden önce diske `DISPATCHING` kaydı yazar; başarılı
   spool sonucunu API'ye bildirmeden önce `PRINTED` sonucunu yine diske yazar.
4. Ağ, spool sonrası koparsa bridge yeniden açıldığında yalnızca API
   acknowledgement'ını tekrarlar. Aynı belge fiziksel yazıcıya ikinci kez
   gönderilmez.
5. Spool sonucu belirsiz kaldıysa iş `FAILED` ve `manual_retry_required` olur.
   Otomatik tekrar baskı yapılmaz. Şube yöneticisi, Yazıcı yönetimi ekranındaki
   **Operatör olarak yeniden dene** eylemiyle yeni bir deneme başlatır.

Bu düzen, fiziksel baskıda mutlak exactly-once garantisi verilemeyen noktayı
açıkça ele alır: OS spooler işi kabul ettikten sonra yazıcının gerçekten kağıdı
kestiğini tüm sürücülerde programatik olarak doğrulamak mümkün değildir. Bridge
bu durumda sessizce tekrar basmak yerine operatör kararını ister.

## Windows masaüstü uygulaması

Windows kullanıcısı için Print Bridge bir PowerShell dosyası ya da terminal
komutu değildir. **Dixora Print Bridge Setup** adıyla kurulan masaüstü/tray
uygulamasıdır. Setup, Node.js çalışma zamanını içerir; şube bilgisayarına Node
kurulması gerekmez.

Yayın paketi geliştirme veya CI makinesinde şu komutla üretilir:

```bash
npm run package:print-bridge:windows
```

Bu komut şunları yapar:

1. `release/dixora-print-bridge-desktop/Dixora-Print-Bridge-Setup.exe`
   dosyasını üretir.
2. Dosyayı `apps/web/public/downloads` altına kopyalar.
3. Web imajı yeniden üretildiğinde Yazıcı Yönetimi ekranındaki **Windows
   uygulamasını indir** düğmesi gerçek `.exe` dosyasını indirir.

Şube kullanıcısının akışı:

1. Yazıcı Yönetimi ekranından **Windows uygulamasını indir** düğmesine basın.
2. `Dixora-Print-Bridge-Setup.exe` dosyasını açıp kurulumu tamamlayın.
3. Açılan **Dixora Print Bridge** penceresinde API adresini, bilgisayar adını
   ve paneldeki **Yeni Bridge bağla** eylemiyle üretilen tek kullanımlık kodu
   girin.
4. Uygulama Windows yazıcılarını listeler ve arka planda çalışmaya başlar.
   Pencere kapatıldığında sistem tepsisinde kalır; sonraki Windows oturumunda
   otomatik başlar.
5. Web panelinde heartbeat geldikten sonra `MUTFAK` ve `BAR` cihazlarını
   görünen yerel yazıcı adlarıyla eşleyin, ardından **Test çıktısı al** ile
   gerçek fişi doğrulayın.

Yerel Docker testi için API adresi `http://localhost:8000` olabilir. Canlı
kullanımda uygulama HTTPS API adresi ister. Setup dosyası kod imzalı değilse
Windows SmartScreen yayıncı uyarısı gösterebilir; canlı dağıtımda bir Windows
code-signing sertifikasıyla imzalanmalıdır.

Windows taşıması `Get-Printer` ile yüklü yazıcıları keşfeder ve `Out-Printer`
ile Windows spooler'a UTF-8 metin işi verir. USB, ağ ve sürücüyle kurulmuş
yazıcılar, Windows'ta görünüyorsa desteklenir.

## macOS masaüstü uygulaması

macOS kullanıcısı için Print Bridge bir shell betiği değildir. **Dixora Print
Bridge** uygulaması, Intel Mac ve Apple Silicon bilgisayarlarda çalışan evrensel
bir `.dmg` paketi olarak dağıtılır. Node.js kurulması gerekmez.

DMG yalnız macOS üzerinde üretilebilir. Geliştirme Mac'inde veya GitHub
Actions'taki **Package macOS Print Bridge** işinde şu komutu çalıştırın:

```bash
npm run package:print-bridge:macos
```

Bu komut:

1. `release/dixora-print-bridge-desktop/Dixora-Print-Bridge.dmg` dosyasını
   üretir.
2. Dosyayı `apps/web/public/downloads` altına kopyalar.
3. Web imajı yeniden üretildiğinde Yazıcı Yönetimi ekranındaki **macOS
   uygulamasını indir** düğmesi gerçek `.dmg` dosyasını indirir.

Şube kullanıcısının akışı:

1. Yazıcı Yönetimi ekranından **macOS uygulamasını indir** düğmesine basın.
2. `Dixora-Print-Bridge.dmg` dosyasını açın ve Dixora Print Bridge uygulamasını
   Applications klasörüne taşıyın.
3. Uygulamayı açıp API adresini, bilgisayar adını ve **Yeni Bridge bağla** ile
   oluşturulan tek kullanımlık kodu girin.
4. Uygulama CUPS yazıcılarını listeler, arka planda çalışır ve sonraki macOS
   oturumunda otomatik başlar.
5. Web panelinde heartbeat geldikten sonra cihazları görünen yerel yazıcılarla
   eşleyip test çıktısı alın.

Yerel Docker testi için API adresi `http://localhost:8000` olabilir. Canlıda
HTTPS API adresi gerekir. Canlı dağıtım öncesi paket bir Apple Developer ID
sertifikasıyla imzalanmalı ve Apple'a notarize edilmelidir; aksi halde Gatekeeper
uyarısı görünür.

### Taşınabilir manuel kurulum

Node.js 22+ kullanan teknik destek senaryoları için taşınabilir paket korunur:

```bash
npm run package:print-bridge
```

Bu komut `release/dixora-print-bridge` klasörünü üretir. macOS'ta paket
kökünden aşağıdaki betik çalıştırılabilir:

```bash
chmod +x scripts/install-macos.sh
./scripts/install-macos.sh \
  --api-url "https://api.ornek-isletme.com" \
  --code "XXXX-XXXX" \
  --name "Kasa Mac mini"
```

Bu yol yönetim panelinden indirilmez. Kurulum
`~/Library/Application Support/DixoraPrintBridge` dizinine kopyalar ve
`~/Library/LaunchAgents/com.dixora.print-bridge.plist` ile kullanıcıya ait bir
LaunchAgent oluşturur. macOS taşıması `lpstat` ile yazıcıları keşfeder ve `lp`
ile CUPS spooler'a gönderir.

## Yönetim ekranı

İşletme yöneticisi şube bazında **Yazıcı yönetimi** ekranından şunları yapar:

- Windows veya macOS masaüstü uygulamasını indirir; kullanıcıya terminal komutu göstermez.
- Bridge bağlantı kodu oluşturur veya aktif bridge'i iptal eder.
- Bridge heartbeat'inden gelen Windows/macOS yazıcı envanterini görür.
- Her Dixora cihazını bir hazırlık istasyonuna ve tek bir `bridge + yerel OS
yazıcısı` eşlemesine bağlar.
- Eşleme yoksa test baskısını çalıştıramaz; yanlış şubeye veya tanımsız bir
  yazıcıya job düşmez.
- Son baskı işlerini, deneme sayısını ve belirsiz baskı uyarılarını görür.

Bridge, 20 saniyede bir heartbeat gönderir. Son bağlantı zamanı yalnızca
gözlem verisidir; merkezden şube ağına health probe yapılmaz.

## Fiş biçimi

Fiziksel taşıma 80 mm termal fiş için 42 sütunluk UTF-8 düz metin üretir.
Başlıkta `toLocaleUpperCase("tr")` kullanılır; böylece `İ`, `ı`, `Ş`, `Ğ`, `Ç`
gibi Türkçe karakterler bozulmaz. Uzun ürün isimleri, notlar ve modifiyerler
kesilmek yerine satıra sarılır.

Windows'ta UTF-8 içerik geçici bir dosyadan `Out-Printer`'a okunur. macOS'ta
aynı UTF-8 dosya `lp` ile gönderilir. Sürücü veya yazıcı UTF-8 desteklemiyorsa
bu fiziksel sürücü kurulumunun sorunudur; Bridge metni kod sayfasına sessizce
dönüştürmez.

Taşıma OS spooler işinin kabulünü başarı sayar. Raw ESC/POS, programatik kesme,
çekmece açma ve donanım seviyesinde kağıt/bıçak durum geri bildirimi bu sürümde
desteklenmez.

## Geliştirme mock'u

Docker'daki mock bridge fiziksel yazdırma için kullanılmaz. Protokol testinde
gerekirse açıkça etkinleştirilir:

```bash
docker compose --profile mock-print-bridge up --build
```

Mock taşıması yalnız geliştirme ortamında çalışır. Normal `docker compose up`
komutu mock bridge'i başlatmaz. Elle çalıştırılan bir mock için `NODE_ENV`
değerini açıkça `development` veya `test` yapın.

## Doğrulama

```bash
npm run typecheck --workspace @dixora/print-bridge
npm test --workspace @dixora/print-bridge
python -m pytest apps/api/tests/test_printing.py apps/api/tests/test_print_bridge_hardening.py -q
docker compose config --quiet
```

Donanımlı kabul testi için Windows'ta bir test siparişini hedef spooler
kuyruğunda, macOS'ta ise CUPS kuyruğunda kontrol edin. Ardından Yazıcı yönetimi
ekranında işin `Yazdırıldı` olduğunu ve doğru istasyon cihazına düştüğünü
doğrulayın.
