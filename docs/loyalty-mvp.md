# Sadakat Programı MVP

Dixora sadakat modülü işletme (tenant) ve şube kapsamlıdır. Varsayılan olarak kapalıdır. İlk sürüm iki kampanya kuralını destekler:

- Ziyaret sayısı: ödenmiş ve minimum tutarı geçen sipariş başına bir ilerleme.
- Ürün adedi: ödenmiş siparişteki uygun ürün veya kategori adedi kadar ilerleme.

İlerleme yalnızca siparişin tamamı `PAID` olduğunda yazılır. Aynı sipariş ve program ikinci kez ilerleme üretemez. İptal/iade düzeltmeleri mevcut hareketi silmez; ters işaretli yeni bir ledger kaydı ekler.

## Güvenlik modeli

- Yönetim endpoint'leri tenant kimliğini authenticated backend context'ten alır.
- Şube, ürün, kategori, sipariş, üyelik ve ödül ilişkileri sunucuda tenant/branch kapsamında doğrulanır; yabancı kaynaklar `404` döner.
- Müşterinin public üyelik tokenı rastgele üretilir, veritabanında yalnızca SHA-256 özeti tutulur, web tarafında işletmeye özel HttpOnly cookie olarak saklanır ve 180 gün sonra sunucu tarafında da geçersizleşir. Farklı işletmelerin müşteri oturumları birbirini ezmez.
- Public menü yanıtları tenant, branch, müşteri ve üyelik UUID'lerini içermez.
- Telefon numarası PII'dir; API loglarına ve audit payload'larına açık metin olarak yazılmaz. Yönetim listesinde maskelenir.
- Ödül tutarı veya uygunluğu browser'dan kabul edilmez. Backend seçilen sipariş kalemini tekrar doğrular ve mevcut `Discount` fiyatlandırma akışını kullanır.

## Doğrulama sağlayıcısı

Doğrulama servisi provider protokolü üzerinden çalışır. `development` ve `test`
ortamında açık biçimde “Development verification” olarak etiketlenmiş kısa
ömürlü bir kod döndürür; SMS gönderildiğini iddia etmez. Production ortamında
provider `netgsm` veya `disabled` olarak açıkça seçilmelidir. `disabled` ya da
eksik yapılandırma durumunda istek `503` döner.

Netgsm OTP kurulumu:

1. Netgsm hesabında OTP SMS paketi ve 3–11 karakterlik onaylı mesaj başlığı açın.
2. Ana hesap yerine yalnız OTP yetkisi verilmiş bir API alt kullanıcısı oluşturun.
3. Production secret store'a `DIXORA_NETGSM_USERCODE`,
   `DIXORA_NETGSM_PASSWORD` ve `DIXORA_NETGSM_MSGHEADER` değerlerini ekleyin.
4. `DIXORA_LOYALTY_VERIFICATION_PROVIDER=netgsm` ayarlayın.
5. SMS maliyetini ve kaba kuvvet denemelerini sınırlayan telefon, IP ve işletme günlük
   limitlerini ortamınıza göre ayarlayın. Doğrulama kodları beş dakika geçerlidir ve
   başarılı üyelikten sonra aynı kod tekrar kullanılamaz.

Varsayılan korumalar:

- Telefon başına 15 dakikada 5 SMS/kod denemesi
- IP başına 15 dakikada 20 SMS/kod denemesi
- İşletme başına günlük 1000 SMS doğrulama isteği
- Veritabanında telefon ve doğrulama tokenı yerine kurulum anahtarıyla üretilen özetler

Limit ortam değişkenleri:

- `DIXORA_LOYALTY_VERIFICATION_RATE_LIMIT_ATTEMPTS`
- `DIXORA_LOYALTY_VERIFICATION_RATE_LIMIT_WINDOW_MINUTES`
- `DIXORA_LOYALTY_VERIFICATION_IP_RATE_LIMIT_ATTEMPTS`
- `DIXORA_LOYALTY_VERIFICATION_TENANT_DAILY_LIMIT`

6. Uygulamayı yeniden başlatıp Türkiye mobil numarasıyla gerçek teslimatı test edin.

Adapter Netgsm'in `https://api.netgsm.com.tr/sms/rest/v2/otp` endpoint'ini Basic
Authentication ile çağırır. Telefon veya credential değerleri loglanmaz; OTP
yanıtta browser'a geri verilmez. Netgsm OTP yalnız Türkiye mobil numaralarını
desteklediği için diğer ülke numaraları açık bir doğrulama hatası alır.

## İşletme paneli

1. `/admin/loyalty` sayfasını açın.
2. Program adı, kampanya türü, eşik, uygun şubeler, minimum sipariş tutarı ve ödül ürün/kategorisini seçin.
3. `Program aktif` ve public menüde görünmesi için `QR menüde göster` seçeneklerini açın.
4. Kaydedilen gerçek müşteri ve ödül sayılarını aynı sayfadaki sekmelerden izleyin.

## Public müşteri akışı

1. Yayındaki şube menüsünü `/m/{businessSlug}/{branchSlug}` adresinden açın.
2. “Sadakat programına katıl” alanında telefon, açık rıza ve isteğe bağlı davet kodunu girin.
3. Development ortamında ekranda açıkça gösterilen test koduyla kaydı tamamlayın.
4. Üyelik kodu, ilerleme, ödül cüzdanı ve davet kodu aynı menüde görünür.
5. “Bu cihazdaki üyeliği unut” işlemi yalnızca public HttpOnly üyelik cookie'sini temizler; ledger verisini silmez.

## Kasa ve garson akışı

1. Açık bir siparişte “Sadakat üyeliği” kartına müşterinin üyelik kodunu girin.
2. Üyelik siparişe bağlandığında kullanılabilir ödüller sunucudan yüklenir.
3. Ödülü ve sunucunun uygun bulduğu sipariş kalemini seçin.
4. “Ödülü siparişe uygula” komutu idempotency key ile bir redemption, audit kaydı ve fiyatlandırma indirimi oluşturur.
5. Sipariş tamamen ödendiğinde ilerleme otomatik oluşur ve eşik aşılmışsa yeni ödül cüzdana eklenir.

Yeni kazanılan ödüller mevcut ödeme modeli nedeniyle sonraki açık siparişte kullanılır. `reward_same_order` alanı gelecekteki ödeme öncesi ödül rezervasyonu akışına ayrılmıştır; fiziksel ödeme tamamlandıktan sonra kapanmış siparişe geriye dönük indirim uygulanmaz.

## Kampanya ve ödül bildirimleri

İşletme menüsündeki **Kampanyalar ve Sadakat** başlığı, kampanyaları, sadakat
programını ve `/admin/notifications` bildirim ekranını birlikte sunar.

- Aktif oluşturulan veya durdurulduktan sonra yeniden yayınlanan kampanya,
  seçili şubelerdeki aktif ve kampanya e-postalarına izin vermiş üyelere duyurulur.
  Taslaklar gönderilmez; aynı yayın üzerindeki düzenlemeler tekrar duyurulmaz.
- Kampanyadaki **Üyelere e-posta ile duyur** seçeneği gönderimi kontrol eder.
  Alıcı bulunmazsa kampanya ekranında bu durum açıkça gösterilir.
- Ödenmiş sipariş sadakat eşiğine ulaştığında kazanılan her yeni ödül, müşterinin
  doğrulanmış e-posta adresine bir kez bildirilir. Ödül e-postası işlemseldir;
  kampanya izninden bağımsızdır. İkram hatırlatması ve kasada kullanılacak ödül
  doğrulama kodunu içerir.

Bildirimler iş işlemiyle aynı veritabanı transaction'ında `email_notifications`
kuyruğuna yazılır. API başlangıcında çalışan arka plan süreci kuyruğu otomatik
işler. PostgreSQL satır kilitleri, birden fazla API sürecinin aynı bildirimi
aynı anda göndermesini önler. Resend istekleri ayrıca bildirim kimliğine bağlı
`Idempotency-Key` taşır. SMTP için, sağlayıcı kabulünden hemen sonra süreç
kesilirse aynı e-postanın tekrar gönderilmesi mümkündür.

Başarısız gönderimler 2, 4, 8 ve 16 dakika sonra yeniden denenir; toplam beş
denemeden sonra durur. Gönderim öncesinde müşteri, üyelik, kampanya izni ve ödül
kullanılabilirliği tekrar kontrol edilir. Durdurulan veya süresi dolan
kampanyalar, geri çekilmiş izinler ve kullanılmış/geri alınmış ödüller için
sıradaki bildirim iptal edilir.

Bildirim ekranı yalnızca `loyalty.manage` yetkisiyle, ilgili işletmenin kayıtlarını
ve maskelenmiş alıcı adreslerini gösterir. `DIXORA_EMAIL_PROVIDER=resend` veya
`smtp` gerçek gönderim yapar; `development` yalnızca kayıt tutar ve ekranda açıkça
belirtilir. Testler gerçek sağlayıcıya e-posta göndermez.

## Otomatik testler

Backend testleri programın varsayılan kapalı durumunu, cross-tenant katalog referansını, public veri minimizasyonunu, tekil paid-order accrual'ını, siparişe bağlı ödül uygunluğunu, idempotent redemption'ı ve append-only reversal'ı kapsar:

```bash
docker compose run --rm api pytest tests/test_loyalty.py
```
