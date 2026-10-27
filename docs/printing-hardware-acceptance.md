# Print Bridge donanım kabul testi

Bu belge bir test planıdır; fiziksel Windows/macOS yazıcı testi yapılmış değildir.
Her pilot işletmede kullanılan gerçek bilgisayar, USB/ağ bağlantısı, sürücü ve
yazıcı modeli için ayrı kayıt tutulmalıdır. Simüle `PRINTED` sonucu bu kabulün
yerine geçmez. CUPS/Windows tamamlanması da kağıdın fiziksel kanıtı değildir.

Kayıt: tarih, işletme/şube, işletim sistemi, bridge sürümü ve commit, yazıcı
modeli/sürücü, bağlantı türü, job ID ve attempt, beklenen/gerçek kağıt sayısı,
operatör ve sonuç. Fiş fotoğrafları yalnız sentetik müşteri verisi içermeli.

| Senaryo                       | Uygulama                                                                            | Kabul ölçütü                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| İstasyon yönlendirmesi        | Tek siparişe mutfak ve bar ürünü ekle; ayrıca kasa hesabını yazdır.                 | Her ürün doğru istasyonda bir kez; kasa fişi yalnız kasa cihazında.                                                                                                        |
| Aynı isteği tekrar gönderme   | Aynı idempotency key ve içerikle isteği paralel gönder.                             | Bir iş ve beklenen kopya sayısı; içerik farklıysa 409.                                                                                                                     |
| İnternet kesilmesi            | Yazdırma sonrası API onayından önce ağı kes; sonra geri getir.                      | Süreç yeniden başlamadan journal onayı toparlanır; ikinci kağıt çıkmaz.                                                                                                    |
| İşlem sonlandırma             | İş alındıktan sonra, spool sırasında ve baskıdan hemen sonra bridge'i kapat.        | Lease süresi dolunca belirsiz iş otomatik basılmaz; operatör kontrolü ister.                                                                                               |
| Eski kilit                    | Kontrolsüz kapanmadan sonra yeniden başlat.                                         | `.lock` varken baskı başlamaz. Önce eski sürecin kapalı olduğu, spool ve kağıt kontrol edilir; sonra yalnız ilgili kilit operatör tarafından kaldırılır. Journal silinmez. |
| İkinci süreç                  | Aynı journal yoluyla ikinci bridge başlat.                                          | Kilit hatası; aynı kuyruk iki süreçten işlenmez. Ayrı journal ile aynı credential'ı kopyalamak desteklenen kurulum değildir.                                               |
| USB/ağ yazıcısı kapalı        | Yazıcı kapalıyken gönder; sonra aç.                                                 | Yanlış başarı yok; belirsiz iş manuel karar ister. Yeniden denemeden önce OS kuyruğu kontrol edilir.                                                                       |
| Kağıt bitmesi / kapak açık    | Çok kopyalı baskının ortasında hatayı oluştur.                                      | Otomatik bütün işi tekrarlamaz; eksik/fazla kağıt kontrol edilerek operatör karar verir.                                                                                   |
| macOS kuyruğu                 | CUPS işini beklet, durdur, iptal et, ardından başarılı örnek bas.                   | `lp` kabulü tek başına `PRINTED` oluşturmaz; IPP 7/8 başarı sayılmaz; yalnız 9 tamamlanma.                                                                                 |
| Uzun baskı                    | Baskıyı 45–90 saniye geciktir.                                                      | Heartbeat sürer; sıradaki işler önceden claim edilmez. Gecikmiş onay ikinci kağıt üretmez.                                                                                 |
| Journal bozuk / erişilemez    | Test journal dosyasını boz veya yazma iznini kaldır.                                | Baskı durur; özgün dosya korunur; boş geçmiş varsayımıyla devam edilmez.                                                                                                   |
| Beşten fazla deneme           | Beş hata sonrası yöneticinin kontrollü tekrarını kullan.                            | Attempt monoton artar; eski ACK yeni denemeyi yutmaz.                                                                                                                      |
| Yönlendirme sonradan düzeltme | İstasyon yazıcısını kapatıp siparişi KDS ile kabul et; yazıcıyı yeniden yapılandır. | Hiç denenmemiş bekleyen iş aynı job ID ile doğru cihaza bağlanır; kopya iş oluşturulmaz.                                                                                   |
| Tenant/şube sınırı            | Başka şube/işletmenin device/job ID ve anahtarını kullan.                           | Veri/iş verilmez; başka şubeye fiziksel gönderim olmaz.                                                                                                                    |

Belirsiz işin manuel tekrarı, daha önce kuyruğa alınan kağıdın sonradan çıkmasını
engelleyemez. Operatör OS kuyruğunu ve fiziksel çıktıyı kontrol etmeden yeniden
denememeli. Gönderilmiş bir işi otomatik iptal etmek de basılmış kağıdı geri alamaz.

Windows ve macOS için bütün satırlar tamamlanmadan pilot donanımı onaylanmamalı.
Elektrik kesintisi, disk bozulması ve journal'ın başka bir yola taşınması ayrıca
yerinde sınanmalı; yazılım testleri fiziksel exactly-once garantisi vermez.
