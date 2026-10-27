# Dixora P1 / P2 uygulama backlog'u

27 Ekim 2026. Bu maddeler planlandı; bu çalışmada topluca geliştirilmedi.
Önce [P0 raporundaki](production-readiness-2026-10-27.md) pilot kapıları kapanmalı.
Mevcut modüler FastAPI uygulaması, PostgreSQL transaction'ları, Redis ve Next.js
korunur; yeni mikroservis/Kafka/Kubernetes gerekmiyor.

Pazar referansı olarak NarPOS'un platform/terminal bağlantıları, Adisyo'nun
merkezi şube yönetimi, Simpra'nın stok/rezervasyon/raporlama ürünleri ve
RestaPOS'un platform sipariş akışı incelendi. Bunlar üreticilerin ürün
beyanlarıdır; bağımsız performans veya entegrasyon testi değildir.
Kaynaklar: [NarPOS](https://narpos.cloud/index.html),
[Adisyo](https://adisyo.com/coklu-sube-adisyon-pos-sistemi),
[Simpra](https://simprasuite.com.tr/), [RestaPOS](https://restapos.com/sss/).

## Öncelik ve uygulanacak parçalar

| Sıra                         | İş ve mevcut örtüşme                                                                                                                                                                           | Dosya / modül planı                                                                                                                                                                                     | Bağımlılık ve kabul ölçütü                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1.1                         | Yemeksepeti / Trendyol Yemek / Getir. `DeliveryOrder`, kanal/provider alanları, dış sipariş kimliği ve manuel paket siparişi var; canlı partner bağlantısı doğrulanmadı.                       | `app/models/delivery.py`, `app/services/delivery.py`, `app/api/delivery.py`; yeni `app/integrations/marketplaces/` altında bir sağlayıcıyla başla. Web `components/delivery/`.                          | Partner sözleşmesi ve sandbox, şube/mağaza eşlemesi, imza doğrulama, webhook inbox + aynı transaction'da sipariş, provider/merchant/branch kapsamlı benzersizlik, kalıcı outbound status outbox. Aynı webhook 20 kez bir sipariş üretmeli; geç/ters sıralı iptal ve stok eşlemesi test edilmeli. Entegrasyon yokken ekran bağlı görünmemeli. |
| P1.2; pilot için hukuki kapı | ÖKC ve terminal. İç tahsilat/iade kaydı, kasa mutabakatı ve platform abonelikleri için iyzico kodu var. Restoran hesabının banka POS'tan çekildiği veya mali ÖKC fişi üretildiği doğrulanmadı. | `app/models/payments.py`, `app/models/orders.py`, `app/services/payments/`, `app/api/orders.py`, `app/api/printing.py`; yeni `app/integrations/fiscal/`; gerekirse bridge'de üretici protokol adaptörü. | Mali müşavir/ÖKC üreticisi kapsam kararı, güncel GİB ve cihaz SDK dokümanı, test terminali ve sertifikasyon. Önce bir üretici. Sipariş, terminal işlem ID ve mali belge ayrı durumlarda saklanmalı; zaman aşımı sorgulanmadan yeniden çekim olmamalı. Fiziksel tahsilat/iade, mali belge ve günlük mutabakat birlikte kabul edilmeli.        |
| P1.3                         | Stok ve kârlılık. Reçete, Decimal birim dönüşümü, stok hareketi, sayım/transfer ve temel cost alanları var.                                                                                    | `app/models/inventory.py`, `app/services/inventory_units.py`, `app/services/orders.py`, `app/api/inventory.py`, `app/api/reports.py`; web stok/reçete ve rapor ekranları.                               | Maliyet kaynağı ve hareketli ağırlıklı ortalama/FIFO kararı; satış anındaki maliyet snapshot'ı. Fire, ikram, iade ve dönem düzeltmeleri tarihsel kârı sessizce değiştirmemeli. Satırdan rapora Decimal toplamları mutabık olmalı; stok kilidi yük testi eklenmeli.                                                                           |
| P1.4                         | Merkezi çok şube. Şube erişimi, fiyat, ürün provisioning, stok transferi ve rollup altyapısı var.                                                                                              | `app/api/organization.py`, `app/services/branch_setup.py`, `app/api/catalog.py`, `app/api/reports.py`, `app/services/pricing.py`; web şube ve rapor bileşenleri.                                        | Merkezi katalog değişiklikleri için sürümleme, yayınlama/geri alma ve şube override önceliği. Her API için tenant/branch test matrisi; farklı saat dilimi/iş günü ve para birimi toplama politikası. Günlük toplam, şubelerin mutabık toplamı olmalı.                                                                                        |
| P1.5                         | Patronun günlük özeti. Satış, vardiya, iade ve işletme günü kapanış raporları ile e-posta outbox'ı var.                                                                                        | `app/services/cashier_reconciliation.py`, `app/api/reports.py`, `app/services/email_notifications.py`; yeni günlük özet hizmeti ve admin özet görünümü.                                                 | Önce deterministik SQL/Decimal özet: net satış, iadeler, nakit/POS farkı, stok ve baskı uyarıları. Tenant timezone + iş günü ile bir kez üretim; yeniden gönderim idempotent olmalı. Her rakam kaynak rapora ve tarih aralığına bağlanmalı. Dış iletişim ayrıca etkinleştirilmeli.                                                           |
| P1.6                         | Rezervasyon/bekleme. Masa ve salon modeli var; rezervasyon yaşam döngüsü doğrulanmış modül değil.                                                                                              | `app/models/operations.py` ilişkileri; yeni `app/models/reservations.py`, `app/api/reservations.py`, `app/services/reservations.py`; yeni web rezervasyon ekranı.                                       | Şube kapsamı, timezone, kapasite ve çakışma kilidi; bekleme → onay → geldi/iptal/no-show durumları. Aynı masa/saat iki kez kesinleştirilememeli. Bildirim izni ve saklama politikası belirlenmeli; ödeme/depozito sonraki bağımsız parça olmalı.                                                                                             |
| P1.7                         | QR önerileri. QR menü, modifier, sadakat ve kampanya değerlendirmesi mevcut.                                                                                                                   | `app/api/qr.py`, `app/services/campaigns.py`, `app/services/qr_config.py`; `components/qr/public-menu.tsx` ve mevcut cart yapısı.                                                                       | Önce kural tabanlı tamamlayıcı ürün: aktif/şubede satılabilir/stoğu uygun. Misafir açıkça eklemeden sepet değişmemeli; alerjenler ve gerçek fiyat gösterilmeli. Kampanya çakışması ve istem dışı ücret için regresyon; dönüşüm ölçümü veri minimizasyonuyla yapılmalı.                                                                       |
| P2.1                         | Veriye dayalı AI asistanı. Raporlar ve özet kaynağı mevcut; güvenilir finansal cevap üretimi doğrulanmadı.                                                                                     | Yeni `app/services/business_assistant.py`, salt okunur rapor araçları, `app/api/reports.py`; yeni admin asistan görünümü.                                                                               | Önce P1.3/P1.5 veri sözleşmeleri. LLM hesabı yapmamalı; sayısal cevap SQL/Decimal sonucundan gelmeli. Cevapta kaynak dönem/şube/ölçüm zamanı; veri yoksa açık eksiklik. Tenant izolasyonu, prompt injection, yetki ve uydurma cevap eval seti; ilk sürümde ödeme/sipariş yazma yetkisi olmamalı.                                             |

## Ortak teknik işler

- P1: `app/realtime.py` için transaction içi kalıcı operasyon outbox'ı, olay ID'si,
  tekrar teslimat ve consumer dedup. Mevcut e-posta outbox'ı bütün realtime
  olaylarının kalıcı olduğu anlamına gelmez.
- P1: `app/api/websocket.py` açık bağlantılarda oturum/tenant/şube yetkisini
  periyodik doğrulamalı; iptal ve rol/şube değişiminde bağlantı kapanmalı.
- P1: `ops/monitor.py` için ayrı salt okunur servis kimliği, token yaşam döngüsü,
  merkezi log/metric toplayıcı ve gerçek operatör alarm teslimatı.
- P1: installer sürüm eşliği, Windows imzalama, macOS imzalama/notarization ve
  indirilen dosyanın release hash kontrolü. Yeni source kodu eski exe/dmg'yi güncellemez.
- P1: sertifika yenilemesinden sonra Nginx reload'unun uçtan uca kanıtı;
  mevcut periyodik `certbot renew` tek başına çalışan sürecin yeni sertifikayı
  yüklediğini kanıtlamaz.
- P2: kritik tablolarda PostgreSQL RLS savunması. Mevcut tenant/branch
  filtrelerini kaldırmadan, connection pool transaction kapsamını test ederek ekle.
- P2: tam offline POS ancak komut kimliği, cihaz sahipliği, fiyat/stock snapshot,
  ödeme sonucu sorgulama ve çatışma kuralları tasarlandıktan sonra ayrı karar.
  Browser'da kör mutation kuyruğu sipariş/ödeme için kabul edilmemeli.

Dosya adları `apps/api/` ve `apps/web/src/` köklerine göredir. Yeni olarak işaretlenen
modüller henüz mevcut değildir. Her parça küçük PR, tenant/branch regresyonu ve
sahte dış servis başarısı üretmeyen sandbox kabulü ile tamamlanmalıdır.
