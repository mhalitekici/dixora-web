# Paneller için PIN doğrulaması

Paneller ekranı yalnız hesap parolasını doğruluyordu; kullanıcı müdür/yönetici
PIN’ini parola alanına girdiğinde doğru PIN olsa da işlem reddediliyordu.

PIN özelliği açıkken doğrulama yöntemi seçilebilir: hesap parolası veya çalışan
PIN’i. Kullanıcı adı açık oturumdan gelir. Yöntem değiştirilince ve doğrulama
reddedilince gizli alan temizlenir. Parola ile mevcut doğrulama korunur.

API tam olarak bir kimlik bilgisi kabul eder. PIN, oturumdaki hesabın atanmış
PIN özetiyle kontrol edilir; başka hesabın doğru bilgileri yetki vermez. PIN
özelliği kapalıysa veya PIN atanmamışsa PIN ile yetki alınamaz. Mevcut rol,
şube, oturum, 10 dakika geçerlilik, işlem günlüğü ve deneme sınırı korunur.
Kasiyer desteği gözlem modundadır; başka çalışanın vardiyası devralınmaz.
Gerçek kullanıcıların parolaları veya PIN’leri değiştirilmedi.

Doğrulama:

- Kimlik doğrulama ve operasyon güvenliği: 26 test geçti. İşletme sahibi,
  yönetici ve müdür için kendi PIN’i; yanlış PIN/başka hesap, kapalı özellik,
  atanmamış PIN, belirsiz istek, oturum sınırı ve 429 deneme sınırı kontrol edildi.
- Bileşen: 3 test geçti; parola uyumluluğu, PIN isteği ve hata sonrası temizleme.
- Tarayıcı: yeni müdür oluşturuldu, kendi oturumuyla yanlış PIN reddi, doğru PIN
  ile kasiyer gözlemi, destekten çıkış ve garson paneline giriş doğrulandı.
- TypeScript, ilgili ESLint, Ruff ve API dosyası mypy kontrolleri geçti.
- Docker API/web imajları başarıyla derlendi. Veri şeması değişmedi.
- Aynı tarayıcı akışı Docker üretim web imajında, yalıtılmış doğrulama API’sine
  bağlı geçici servisle tekrar geçti. Geçici servis doğrulama sonrası durduruldu.
- Yerel `dixora` API/web servisleri güncellendi ve healthy. `/ready` 200;
  giriş ekranı 200, etkin düğme ve sıfır sayfa hatasıyla kontrol edildi. Sipariş,
  ödeme, kasa vardiyası ve yazdırma işi satır sayıları ve tam satır özetleri aynı.

Tarayıcı testi, PIN özelliği açık yalıtılmış `dixora-lab` doğrulama ortamında
çalışır ve kendi müdür hesabını oluşturur. Gerçek kullanıcı PIN’iyle giriş
denenmedi. Kullanıcı, Paneller → Doğrulama yöntemi → Çalışan PIN’i seçip açık
hesabının PIN’ini girmelidir; PIN atanmamış hesap parola yöntemini kullanabilir.
