# Yönetici/müdür PIN girişi ve kişisel kasa vardiyası

Önceki Paneller ekranı açık hesabın bilgilerini tekrar doğruluyor, kasiyer
erişimini gözlemle sınırlıyordu. Talep edilen çalışan hesabına giriş ve gerçek
kasiyer işlemleri bu akışta yoktu.

Yeni akış:

1. Admin içindeki Paneller bölümünde çalışanın kullanıcı adı ve PIN’i doğrulanır.
   Doğrulanan yönetici/müdür için kendi oturumu açılır. Önceki hesabın sorgu
   önbelleği, sepeti ve arayüz durumu temizlenir. Hatalı PIN oturumu değiştirmez.
2. Çalışan girişindeki PIN doğrulaması yönetici/müdürü aynı panel seçimine
   getirir. Bu girişin mevcut yetkili cihaz kontrolü korunur; şube uyuşmazlığı
   cihaz yetkisini artık silmez.
3. Kullanıcı yetkili olduğu Garson veya Kasiyer panelini seçer. Yeni panel
   erişimi gerçek çalışan kimliğiyle, seçili şube ve oturumla bağlı çalışır.
4. Kasiyer paneli yalnız bu kullanıcıya ait açık vardiyayı bulur. Yoksa kendi
   açılış nakdini girerek ayrı vardiya açar. Tahsilat ve iadeler bu vardiyaya
   bağlanır. Aynı kullanıcı tekrar girerse açık kendi vardiyasından devam eder.
5. Başka kasiyerin vardiyası devralınmaz. Bu operasyon oturumundan başka
   çalışanın vardiyasını kapatma veya devretme isteği reddedilir.

API eklemeleri: `/auth/panel-login`, `/auth/operation-options`,
`/auth/operation-select`, `/shifts/open-own`. Yetkiler, etkin hesap/rol, işletme,
şube ve PIN deneme sınırı sunucuda kontrol edilir. PIN’ler işlem günlüğüne veya
yanıta yazılmaz. Parola/PIN özetleri değiştirilmez. Kullanıcının kendi rolünden
fazla panel yetkisi verilmez. Eski gözlem erişimleri geriye uyumludur.

`0045_operator_panels` geçişi operasyon modunu eski kayıtlar için `support`
olarak ekler. Bir hesabın eskiden başka kasiyer için açtığı vardiya, kendi
kişisel vardiyasını engellemez. Kasiyer başına tek açık vardiya indeksi korunur;
vardiya açma işlemi kullanıcı satır kilidiyle eş zamanlı isteklere karşı korunur.
Geçiş hiçbir vardiyayı kapatmaz, taşımaz veya mali satırı değiştirmez.

Doğrulama:

- API: kimlik, operasyon, vardiya, sipariş/ödeme, çoklu şube ve geçiş testleri
  73/73; son şube ve geçiş kontrolleriyle 23/23 ek doğrulama geçti.
- Web: 424/424; son hesap değiştirme temizliğinden sonra ilgili 16/16 tekrar geçti.
- İşletme sahibi, yönetici ve müdür için ayrı vardiya ve ödeme aidiyeti test
  edildi. Eski kasiyer vardiyası satırları aynı kaldı.
- Tarayıcı: admin hesabından müdüre PIN ile gerçek hesap geçişi; yanlış PIN’de
  eski hesabın korunması; panel seçimi; kişisel vardiya; garson geçişi; çalışan
  girişinden PIN ve aynı kişisel vardiyaya devam akışı geçti.
- PostgreSQL/iki API çalışanıyla 20 paralel açılış: bir 201 ve 19 adet 409;
  önceki kasiyer vardiyası değişmedi.
- Eski kayıt ve kişisel/ortak açan kullanıcı indeksi geçişi 6/6 testten geçti.
- İlgili Ruff, mypy, TypeScript ve ESLint kontrolleri geçti.

Gerçek kullanıcıların PIN’leri alınmadı veya değiştirilmedi. Aktif ana şube
yönetici/müdür kayıtlarında PIN ve iki panel yetkisinin mevcut olduğu yalnız
metadata üzerinden doğrulandı. Devre dışı hesapların durumu değiştirilmedi.
Güncelleme öncesi PostgreSQL yedeği Git dışında alınıp `pg_restore --list` ile
doğrulandı. Docker güncellemesinde kalıcı veri hacimleri korunur.
