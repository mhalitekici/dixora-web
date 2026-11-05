# Çalışan kaydı ve şube erişimi düzeltmesi

Yeni çalışan formu seçili şube yerine alfabetik ilk aktif şubeyi kullanıyordu.
Kayıt başarılı olsa da seçili şubeyle sınırlı çalışan listesinde hesap görünmüyor,
ana şubeden PIN girişi `branch_forbidden` hatası veriyordu. Şubesiz işletme
yöneticileri de aynı liste filtresinde gizleniyordu.

Form artık oturumun mevcut şubesini kullanır. Çalışan listesi işletme sınırını
koruyarak kullanıcının yönetebildiği şubeleri kapsar; şubeye bağlı kullanıcılar
diğer şubelerin veya şubesiz yöneticilerin kayıtlarını göremez. Başarılı kayıttan
sonra arama yeni hesabı gösterir. PIN şube uyuşmazlığı Türkçe açıklanır.

Kullanıcının ana şube talebi doğrultusunda yalnız iki yeni hesabın yanlış şube
ataması işlem günlüğü tutularak düzeltildi. Parola/PIN özetleri ve roller aynı
kaldı; bu hesapların eski oturumları iptal edildi. Şubesiz yönetici değiştirilmedi.
Bakım kaydının önceki değerleri yerel, Git dışında saklanır.

Doğrulama: şube yönetimi, çalışan yönetimi ve kimlik doğrulama testleri 28/28;
web testleri 419/419 (giriş bileşeni 7/7); tarayıcıda mevcut şubenin alfabetik ilk şubeden farklı olduğu
durumda varsayılan seçim, kayıt, listede görünme ve yeni hesapla giriş başarılı.
Doğru şubede PIN girişi başarılı, yanlış şubede parola girişi 403 olarak korundu.
TypeScript, ilgili ESLint, Ruff ve API dosyası mypy kontrolleri geçti.

Tarayıcı regresyonu `apps/web/e2e/employee-branch.pw.ts`, en az iki aktif şubeli
yalıtılmış `dixora-lab` doğrulama verisiyle çalışır. Tek şubeli ortamda atlanır.
Gerçek kullanıcı parolası/PIN'i alınmadı; gerçek hesabın girişini kullanıcı
yeniden deneyecek. Yerel Docker güncellemesi veri hacimleri korunarak yapılır.
