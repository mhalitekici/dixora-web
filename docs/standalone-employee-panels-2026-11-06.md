# Admin dışında çalışan panel seçimi

Yönetici/müdürün PIN girişindeki seçim ekranı `/admin/panels` altında olduğundan
admin kabuğu ve yönetim bağlantıları görünüyordu. Yeni çalışan girişleri doğrudan
bağımsız `/panels` sayfasına gider. Bu sayfada yalnız hesap bilgisi, izin verilen
Garson/Kasiyer seçimleri ve çıkış vardır; admin menüsü yüklenmez.

Seçim garson için `/waiter/tables`, kasiyer için `/cashier` açar. Operasyon
ekranındaki seçim dönüşü ve profil dönüşü de `/panels` kullanır. Admin içinden
PIN ile başka çalışan hesabına geçiş doğrulandığında admin alanından çıkılır.

Sunucunun oturum kaydından türetilen `staff_session` bilgisi kimlik yanıtına ve
imzalı erişim/yenileme belirteçlerine taşınır; yenilemede korunur. Çalışan
oturumuyla admin URL’si açıldığında seçim ekranına yönlendirilir. Eski belirteçte
yeni alan yoksa admin yerleşimi sunucudan gelen oturum bilgisini bekler ve admin
kabuğunu göstermeden yönlendirir. Çalışan oturumunda yönetim bağlantıları arama
ve menülerde filtrelenir. Normal işletme parola girişi admin alanını kullanmaya
devam eder. Bu değişiklik rolün API izinlerini yeniden tanımlamaz.

Kişisel yönetici vardiyası ve ödeme aidiyeti korunur. Standart kasiyerlerin
mevcut terminal/vardiya davranışı değiştirilmez. Veri şeması değişmedi.

Doğrulama: kimlik/operasyon API testleri 30/30; vardiya ve yönetici akışı 15/15;
proxy, gezinme ve giriş bileşenleri 28/28. TypeScript, ilgili ESLint, Ruff ve
mypy kontrolleri geçti. Tarayıcı akışı geliştirme sunucusunda ve Docker üretim
web imajında geçti: bağımsız seçim, admin menüsünün yokluğu, elle admin URL’sine
gitmenin seçime dönmesi, iki panel, ayrı vardiya ve aynı vardiyaya devam.

Yerel Docker API/web güncellendi; servisler healthy, `/ready` 200, giriş ekranı
tarayıcıda 200 ve sıfır sayfa hatasıyla doğrulandı. Sipariş, ödeme, kasa vardiyası
ve yazdırma işi satır sayıları ve tam satır özetleri güncelleme öncesiyle aynı.
Geçici üretim doğrulama web servisi durduruldu.
