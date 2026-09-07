# Dixora Print Bridge

Print Bridge, şubedeki Windows veya macOS bilgisayarında çalışan yerel yazdırma
agent'ıdır. Merkezi Docker servisi değildir. API'ye yalnız dışarıya doğru HTTPS
istekleri açar ve işletim sisteminde kurulu yazıcıları kullanır.

## Komutlar

```bash
# Kaynak koddan geliştirme
npm run dev:print-bridge

# Yüklü işletim sistemi yazıcılarını listele
npm run start --workspace @dixora/print-bridge -- printers

# Tek kullanımlık yönetim koduyla bridge'i kaydet
npm run start --workspace @dixora/print-bridge -- enroll \
  --code XXXX-XXXX --name "Kasa Bilgisayarı"

# Taşınabilir klasör üret
npm run package:print-bridge

# Windows masaüstü kurulum dosyası üret
npm run package:print-bridge:windows

# macOS evrensel DMG üret (yalnız macOS veya macOS CI çalıştırıcısı)
npm run package:print-bridge:macos
```

## Windows masaüstü kurulumu

`npm run package:print-bridge:windows` komutu, Node.js gerektirmeyen
`Dixora-Print-Bridge-Setup.exe` NSIS kurulum dosyasını üretir ve web
uygulamasının indirme klasörüne kopyalar. Şube kullanıcısı Yazıcı Yönetimi
ekranındaki **Windows uygulamasını indir** düğmesinden bu `.exe` dosyasını
indirir, çift tıklar ve açılan Dixora Print Bridge uygulamasında API adresi ile
tek kullanımlık bağlantı kodunu girer.

Uygulama kurulumdan sonra sistem tepsisinde çalışır, Windows oturum açılışında
yeniden başlar ve Node.js ya da PowerShell kullanımını kullanıcıdan gizler.
Yerel testte API adresi `http://localhost:8000`; canlıda HTTPS API adresidir.

Taşınabilir `scripts/install-windows.ps1` dosyası yalnız teknik/manuel kurulum
senaryoları için korunur; yönetim panelindeki Windows indirme düğmesi ona
bağlanmaz.

`PRINT_BRIDGE_API_URL`, varsayılan olarak `http://localhost:8000` olan API kök
adresidir; `/api/v1` eklemeyin. Desktop uygulaması token ve bridge kapsamını
uygulamanın kullanıcı veri dizininde saklar. Taşınabilir CLI varsayılan olarak
kullanıcının ev dizinindeki `.dixora-print-bridge` altında çalışır; production
kurulum betikleri bunu işletim sisteminin kullanıcı veri dizinine yönlendirir.

## macOS masaüstü kurulumu

`npm run package:print-bridge:macos`, Intel ve Apple Silicon için evrensel
`Dixora-Print-Bridge.dmg` dosyasını üretir ve web uygulamasının indirme
klasörüne kopyalar. DMG üretimi macOS araçları gerektirdiğinden komut yalnız
macOS üzerinde veya macOS GitHub Actions çalıştırıcısında çalışır.

Şube kullanıcısı Yazıcı Yönetimi ekranındaki **macOS uygulamasını indir**
düğmesinden DMG'yi indirir, uygulamayı Applications klasörüne taşır ve açılan
Dixora Print Bridge penceresine API adresi ile tek kullanımlık bağlantı kodunu
girer. Uygulama CUPS yazıcılarını listeler, menü çubuğunda çalışır ve kullanıcı
oturum açtığında yeniden başlar.

Taşınabilir `scripts/install-macos.sh` betiği yalnız teknik/manuel kurulum
senaryoları için korunur; yönetim panelindeki macOS indirme düğmesi ona
bağlanmaz. Canlı dağıtımda DMG Apple Developer ID ile imzalanıp notarize
edilmelidir.

## Yazdırma

- Windows: `Get-Printer` keşfi ve `Out-Printer` spooler gönderimi
- macOS: `lpstat` keşfi ve `lp`/CUPS spooler gönderimi
- 80 mm, 42 sütun, UTF-8 düz metin; Türkçe karakterler korunur
- Sunucu eşlemesi olmadan cihaz claim edilemez
- Kalıcı yerel journal, ağ acknowledgement hatasından sonra çift baskıyı
  engeller
- Fiziksel sonuç belirsizse otomatik tekrar yerine yönetici onaylı yeniden
  deneme gerekir

Tam kurulum, güvenlik modeli ve sınırlamalar için
[printing.md](../../docs/printing.md) belgesine bakın.

## Geliştirme mock'u

Mock transport yalnız test/geliştirme içindir. Fiziksel yazdırma için
`PRINT_BRIDGE_TRANSPORT=auto` kullanın; Windows/macOS otomatik seçilir. Linux
üzerinde fiziksel taşıma yoktur ve `mock` seçeneği production'da reddedilir.
