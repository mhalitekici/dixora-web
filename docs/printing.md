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

Kasa hesap fişleri hazırlık fişlerinden ayrıdır. `purpose=CASHIER` rolündeki
aktif cihaz, şubenin tek hesap fişi rotasıdır; yazıcı adı veya cihaz kodundan
tahmin yapılmaz. İşletme ve şube adı, masa, garson, tarih, ikram satırları,
kuver/servis ve backend toplamlarını gösteren hesap özeti bu rotaya normal iş
akışıyla gönderilir. Kasa rotası yoksa iş kuyruğa alınmaz ve panel kullanıcıyı
**Ayarlar > Yazıcılar** bölümüne yönlendirir.

Kasiyer yeni ürün eklediğinde veya basılmış bir ürünün adedini artırdığında ek
miktar bekleyen yeni kalem olarak tutulur. **Siparişi yazdır** düğmesi yeniden
aktif olur; basıldığında yalnız bu yeni kalemler istasyonlara gönderilir ve
stokları düşülür. Fişte `ADET ARTTIRILDI` yazmaz. İkram işaretleme veya ikramı
kaldırma yalnız hesabı günceller, hazırlık fişi oluşturmaz. Basılmış kalemlerin
adet azaltma ve açıklama değişiklikleri ilgili istasyona `COPY` düzeltme işi
gönderir. Garson da kendi panelinden ürün açıklaması ekleyip düzenleyebilir.

Hesap ve ödeme fişlerinde aynı ürün sonradan tekrar eklendiğinde adetleri ve
tutarları tek satırda toplanır: ayrı ayrı eklenen iki baklava `2 x Baklava`
olarak görünür. Aynı ürünün fiyatı, seçenekleri, açıklaması veya ikram durumu
farklıysa ayrı satırlar korunur. Bu gösterim tüm panellerin fiş önizlemesi,
hesap baskısı, kurye fişi ve yeniden baskıları için geçerlidir.

Kasiyer, garson ve QR menü yalnız tam adet sipariş kabul eder; yarım porsiyon
seçimi yoktur. Yeni sipariş ve ürün ekleme uçları kesirli miktarları reddeder. Kasa
fişindeki personel adı vardiyada seçilen kasiyerden gelir; yeniden baskıda ilk
fişi düzenleyen vardiyanın adı korunur. Admin sipariş ekranında fiş numarası ve
işletme günü ile tüm kayıtlar aranabilir.

## Güvenli teslimat

1. Bridge yalnız kendi şubesine ve sunucuda kendisine eşlenmiş cihazlara ait
   işleri claim eder. Yerel OS yazıcı adı, claim yanıtında sunucudan gelir.
2. Sunucu bir lease ve deneme numarası verir. `SENT`, `PRINTED` ve `FAILED`
   geçişleri bridge kimliği, deneme numarası ve idempotency key ile doğrulanır.
3. Bridge, OS spooler'a vermeden önce diske `DISPATCHING` kaydı yazar; başarılı
   spool sonucunu API'ye bildirmeden önce `PRINTED` sonucunu yine diske yazar.
4. Ağ, spool sonrası koparsa bridge ağ dönünce süreç yeniden açılmadan API
   acknowledgement'ını tekrarlar. Aynı belge fiziksel yazıcıya ikinci kez
   gönderilmez.
5. Spool sonucu belirsiz kaldıysa iş `FAILED` ve `manual_retry_required` olur.
   Otomatik tekrar baskı yapılmaz. Şube yöneticisi, Yazıcı yönetimi ekranındaki
   **Operatör olarak yeniden dene** eylemiyle yeni bir deneme başlatır.
6. Lease süresi dolan CLAIMED/SENT iş de fiziksel sonucu belirsiz sayılır;
   otomatik claim havuzuna dönmez. Geç journal onayı aynı sahip/attempt ile
   tamamlayabilir. Manuel retry attempt kimliğini sıfırlamaz.
7. Runtime bir seferde bir iş alır; heartbeat baskıdan bağımsızdır. Bozuk veya
   okunamayan journal baskıyı durdurur. Aynı journal için ikinci süreç kilitle
   engellenir. Kontrolsüz kapanıştan kalan `.lock`, eski süreç ve fiziksel/OS
   kuyruğu operatör tarafından kontrol edilmeden kaldırılmamalı; journal silinmemeli.

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
5. Web panelinde heartbeat geldikten sonra `MUTFAK`, `BAR` ve `KASA` cihazlarını
   görünen yerel yazıcı adlarıyla eşleyin, ardından **Test çıktısı al** ile
   gerçek fişi doğrulayın.

Yerel Docker testi için API adresi `http://localhost:8000` olabilir. Canlı
kullanımda uygulama HTTPS API adresi ister. Setup dosyası kod imzalı değilse
Windows SmartScreen yayıncı uyarısı gösterebilir; canlı dağıtımda bir Windows
code-signing sertifikasıyla imzalanmalıdır.

Windows taşıması `Get-Printer` ile yüklü yazıcıları keşfeder. Baskıda
`PrintDocument` kullanır; sürücünün gerçek yazdırılabilir alanını ölçer,
uygulama kenar boşluklarını sıfırlar ve metni sol yazdırılabilir kenardan
başlatır. Her kopyaya benzersiz bir spooler belge adı verir ve işi 30 saniyeye
kadar `Get-PrintJob` ile izler. Çevrimdışı, kağıt yok, engellenmiş veya kuyruktan
ayrılamayan iş `PRINTED` sayılmaz; operatör kontrollü tekrar için hata olarak
bildirilir. USB, ağ ve sürücüyle kurulmuş yazıcılar, Windows'ta görünüyorsa
desteklenir.

Windows yazıcı kuyruğunda **Use Printer Offline / Yazıcıyı çevrimdışı kullan**
seçiliyse Bridge işi göndermeden hata verir. Bu seçenek kapalı olmalı; yalnızca
`PrinterStatus=Normal` görünmesi çevrimdışı bayrağının kapalı olduğunu garanti
etmez.

`Microsoft Print to PDF` ve `Microsoft XPS Document Writer` arka planda çalışan
Print Bridge için güvenilir test yazıcısı değildir. Bu sürücüler dosya adı
seçmek için etkileşimli kaydetme penceresi ister; bridge tray/background
oturumunda bu pencereyi gösteremez. Bu yazıcılar seçilirse bridge işi fiziksel
spooler'a vermeden `FAILED` yapar ve hata mesajını masaüstü penceresinde
gösterir.

Gerçek yazıcı olmadan Windows kabul testi için `Generic / Text Only` sürücüsüyle
normal spooler'a giden geçici bir test yazıcısı oluşturun:

```powershell
Add-PrinterPort -Name "NUL:"
Add-PrinterDriver -Name "Generic / Text Only"
Add-Printer -Name "Dixora Test Printer" -DriverName "Generic / Text Only" -PortName "NUL:"
```

Alternatif olarak Windows **Printers & scanners** ekranından **Add manually** ile
`Generic / Text Only` sürücüsünü kurup yazıcıyı bir local test portuna bağlayın.
Canlı panelde Dixora cihaz eşlemesinin yerel yazıcı adını `Dixora Test Printer`
yapıp **Test çıktısı al** çalıştırın; iş `FAILED` yerine `Yazdırıldı` durumuna
geçmelidir.

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
- Her Dixora cihazına **Hazırlık fişi** veya **Kasa / hesap** rolü verir;
  hazırlık cihazını bir istasyona, her cihazı tek bir `bridge + yerel OS
yazıcısı` eşlemesine bağlar.
- Eşleme yoksa test baskısını çalıştıramaz; yanlış şubeye veya tanımsız bir
  yazıcıya job düşmez.
- Son baskı işlerini, deneme sayısını ve belirsiz baskı uyarılarını görür.

Bridge, 20 saniyede bir heartbeat gönderir. Son bağlantı zamanı yalnızca
gözlem verisidir; merkezden şube ağına health probe yapılmaz.

## Fiş biçimi

Fiziksel taşıma 80 mm termal fiş için UTF-8 düz metin üretir. Yazıcı
sürücüsünün gerçek yazdırılabilir alanına göre `PRINT_BRIDGE_RECEIPT_COLUMNS`
ayarlanır (varsayılan 42, izin verilen 32-64).

- Hazırlık fişi yalnız hedef istasyonun `MUTFAK FİŞİ` / `BAR FİŞİ` başlığı,
  sipariş-masa/personel veya kaynak bilgisi, tarih-saat ve sağda ürün adedi
  taşır. Fiyat ve sonradan üretilmiş basım zamanı içermez; açıklama ve
  seçenekler ürünün hemen altına yazılır.
- Hesap özeti işletme ve şubeyle başlar. Ürün, adet ve toplam fiyat
  ayrı sütunlardır; ikram satırının toplamında para yerine `İKRAM` görünür.
  İndirim, vergi, servis ve kuver yalnız veri kaynağında varsa ayrı gösterilir.
- Kurye fişi paket siparişindeki gerçek müşteri adı, telefon, adres, ödeme
  şekli, ürün/fiyatlar ve teslimat notlarını taşır. İlk baskı `ORIGINAL`, sonraki
  baskılar işaretli `REPRINT` işidir.

Türkçe başlıklarda yerel büyük harf dönüşümü kullanılır; böylece `İ`, `ı`, `Ş`,
`Ğ`, `Ç` gibi karakterler bozulmaz. Uzun ürün isimleri, adresler, notlar,
modifiyerler ve tutarlar kesilmek yerine güvenli biçimde satıra sarılır. Dar
sütun ayarında tutarlar sığmıyorsa ürünün altına etiketli satırlar olarak
indirilir. Hesap özeti birim fiyat sütunu içermez; kurye fişi birim ve toplam
fiyatı birlikte taşır.

Windows'ta UTF-8 içerik geçici bir dosyadan okunur ve `PrintDocument` ile
çizilir. Monospace punto, seçilen sütun sayısı sürücünün gerçek yazdırılabilir
genişliğini dolduracak şekilde hesaplanır; kağıt boyutu Windows yazıcı
tercihlerinde yine **80 mm** olarak seçilmelidir.
macOS'ta aynı UTF-8 dosya `lp` ile CUPS'a gönderilir; rulo uzunluğu sürücüye göre
değiştiği için 80 mm medya ve kenar boşlukları CUPS yazıcı varsayılanlarında
seçilmelidir. Sürücü veya yazıcı UTF-8 desteklemiyorsa
bu fiziksel sürücü kurulumunun sorunudur; Bridge metni kod sayfasına sessizce
dönüştürmez.

macOS taşıması yerel CUPS iş kimliğini saklar ve IPP `job-state=9` tamamlanmasını
bekler; `lp` kabulü veya iptal/abort başarı sayılmaz. Windows taşıması adlandırılmış
işin spooler kuyruğundan hatasız ayrılmasını başarı sayar. Bu kontroller kağıdın
fiziksel olarak kesildiğini kanıtlayamaz. Raw ESC/POS, programatik kesme,
çekmece açma ve donanım seviyesinde kağıt/bıçak durum geri bildirimi bu sürümde
desteklenmez.

### Fiziksel 80 mm kurulum kontrolü

- `Windows printer is set to offline mode` hatasında yazıcı için Windows'taki
  **Yazıcıyı çevrimdışı kullan** seçeneğini ve USB/ağ bağlantısını kontrol edin.
  `Get-Printer` durumunun `Normal` olması `Win32_Printer.WorkOffline=true`
  ayarını geçersiz kılmaz. Bridge hata mesajı işletim sisteminin asıl hatasıyla
  başlar; geçici dosya yolları nedeniyle hata nedeni kesilmez.
- Sürücüde kağıt genişliğini 80 mm, kenar boşluklarını mümkün olan en düşük
  değer ve ölçeklemeyi %100 seçin; test çıktısının sağı kesiliyorsa sütun
  değerini 42'den 40 veya 38'e indirin.
- Soluk baskı için yazıcı/sürücüde **density/darkness** değerini ve baskı hızını
  kontrol edin. Bunlar Windows spooler/CUPS işinden güvenilir biçimde
  zorlanamaz.
- Termal kağıdın kaplamalı yüzünü tırnakla çizerek kararan tarafın termal kafaya
  baktığını doğrulayın. Yanlış yön ve uyumsuz/eski kağıt yazılımla düzeltilemez.
- Windows ve macOS'ta ayrı test baskısı alıp en uzun Türkçe ürün/not satırını,
  TL tutar hizasını ve kağıt kesimini fiziksel olarak kontrol edin.

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

Ayrıntılı arıza ve işletim sistemi matrisi:
[donanım kabul testi](printing-hardware-acceptance.md). Kaynak değişikliği eski
exe/dmg dosyalarını güncellemez; release üretimi ve gerçek cihaz kabulü gerekir.
