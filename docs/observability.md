# Temel operasyon izleme

Yapılandırma kodu hazırlanmıştır; canlı alarm hedefi veya ücretli servis
etkinleştirilmemiştir. Alarmın operatöre ulaştığı ayrıca kanıtlanmalıdır.

- `/health`: süreç canlılığı. Bağımlılık kesintisinde 200 kalır.
- `/ready`: PostgreSQL, yapılandırılmış Redis ve MinIO bucket erişimi; probe'lar
  paralel ve sınırlı sürelidir. Hata 503; yanıt connection string içermez.
  Redis yoksa `not_configured` görünür, test ortamında bellek medya probe'u kullanılır.
- `/api/v1/printing/health`: oturum ve `printing.read` izni gerekir. Tenant/şube
  kapsamlı başarısız/yönlendirilmemiş iş, en eski bekleyen iş yaşı ve çevrimdışı
  bridge sayısı. API'nin çalışması fiziksel yazıcı sağlığını kanıtlamaz.
- Bridge'in loopback `/healthz` ve `/readyz` uçları: yerel süreç ve hata durumu.
- `http.request`: request ID, route şablonu, yöntem, durum ve süre. Query değerleri
  ve ham dinamik URL loglanmaz. `operation.rejected`, `request.unhandled`,
  `frontend.incident` olayları merkezi log toplayıcıda alarm üretmeye uygundur.
- Frontend React sınırı, global error ve unhandled rejection sabit şemayla
  `/diagnostics/frontend-errors` adresine raporlanır. API kimlik doğrulama ve
  oturum başına 10/dakika limit uygular; stack/metin/customer verisi kabul etmez.
  Oturum kurulmadan oluşan hatalar bu kanala teslim edilemeyebilir.
- İsteğe bağlı API Sentry mevcut yapı korunarak kullanılır. Body, query, URL,
  cookie, kullanıcı ve breadcrumbs atılır; exception değerleri ve local değişkenler
  maskelenir. DSN verilmedikçe dışarı veri gönderilmez.
- Nginx access log artık method/status/süre/request ID içerir. Uvicorn URL içeren
  HTTP erişim ve WebSocket kabul logları bastırılır. Nginx error logları ve üçüncü
  taraf ajanların ayrı gizlilik denetimi hâlâ gerekir; ham logları dışarı taşımadan
  önce toplayıcıda da redaksiyon uygulanmalıdır.

## Salt okunur alarm kontrolü

```bash
export DIXORA_MONITOR_TOKEN_FILE=/etc/dixora/monitor-access-token
python ops/monitor.py --base-url https://example.test \
  --backup-receipt /srv/dixora-backups/last-success.json
```

Token sadece dosyadan okunur; komut satırı/çıktıya yazılmaz. Uzak token aktarımı
HTTPS gerektirir; redirect takip edilmez. Mevcut kullanıcı access token'ı süreli
olduğundan yenileme veya ayrı, salt okunur servis kimliği kurulmadan sürekli
gözetim hazır sayılmaz. Her şube ayrı scope ile izlenmelidir. Geçersiz token
sağlıklıymış gibi sonuç üretmez.

Kontrol JSON alarm kodlarını yazar ve sorun varsa 1 döner: API erişim sorunu,
baskı kuyruğu/bridge sorunu, 26 saatten eski yedek, doğrulanmamış offsite kopya,
quiesce edilmeden alınmış paket, eksik receipt ve yapılandırılmamış baskı probe'u.
Başarılı backup, retention tamamlandıktan sonra atomik `last-success.json` yazar;
başarısız sonraki yedek önceki başarı zamanını ilerletmez.

Hazır unit'ler: `ops/systemd/dixora-monitor.service`, `.timer` ve
`dixora-alert@.service`. `monitor.env` içinde `DIXORA_MONITOR_BASE_URL` ve
`DIXORA_MONITOR_TOKEN_FILE` tanımlanır. Backup ve monitor başarısızlığı `OnFailure`
ile `dixora-alert` kimliği ve hata seviyesiyle journal'a düşer. Bunlar bu çalışmada
kurulmadı/başlatılmadı. Gerçek bildirim teslimatı için mevcut merkezi log/uyarı
sistemine bağlanmalı; test alarmı, sorumlu kişi ve eskalasyon kaydı tutulmalı.

Önerilen başlangıç eşikleri: readiness iki ardışık kontrol başarısız; herhangi
bir manuel baskı hatası; bekleyen iş >120 saniye; bridge >45 saniye görülmemiş;
yedek >26 saat; 5 dakikada sipariş/ödeme 5xx >%1 veya artan 409/422 reddi. Gerçek
işletme verisi ve bakım pencerelerine göre eşikler ayarlanmalı. İşlem reddi tek
başına veri kaybı demek değildir; request ID ile kayıt sonucu kontrol edilmelidir.
