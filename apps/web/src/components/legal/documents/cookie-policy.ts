import type { LegalDocument } from "@/components/legal/legal-document";

export const COOKIE_POLICY_VERSION = "2026-09-06-v1";

/**
 * Describes what this codebase actually sets — no aspirational or placeholder
 * script categories. Cross-check against reality before editing:
 *   - Cookies: apps/web/src/lib/server/auth-cookies.ts, loyalty-cookie.ts
 *   - localStorage/sessionStorage: grep for `localStorage`/`sessionStorage`
 *     under apps/web/src
 * There is currently no analytics, advertising or tracking script anywhere in
 * the codebase; the "Analitik" and "Pazarlama" categories below are stated as
 * unused on purpose, not omitted.
 */
export const COOKIE_POLICY: LegalDocument = {
  title: "Çerez Politikası",
  version: COOKIE_POLICY_VERSION,
  effectiveDate: "6 Eylül 2026",
  sections: [
    {
      heading: "1. Bu Politika Ne Hakkında",
      paragraphs: [
        "Bu Çerez Politikası, dixoratech.com üzerinde ve Dixora'nın müşteri işletmelere ait alt sayfalarında (QR menü dâhil) hangi çerezlerin ve tarayıcı depolama (localStorage/sessionStorage) mekanizmalarının kullanıldığını, bunların hangi amaçla var olduğunu ve tercihlerinizi nasıl yönetebileceğinizi açıklar.",
        "Aşağıdaki liste, sistemde gerçekten ayarlanan çerez ve tarayıcı depolama kayıtlarını yansıtır; şu anda kullanılmayan bir kategori bu şekilde açıkça belirtilir.",
      ],
    },
    {
      heading: "2. Zorunlu Çerezler ve Depolama",
      paragraphs: [
        "Bu kayıtlar, Hizmet'in temel işlevlerini (oturum açma, güvenli erişim, sepetin sayfa yenilemesinde korunması) yerine getirmek için gereklidir ve rızanız olmadan da çalışır; devre dışı bırakılamaz.",
      ],
      list: [
        "dixora_access, dixora_refresh — oturum açmış kullanıcının kimlik doğrulama jetonları (HttpOnly, yalnızca sunucu tarafından okunur).",
        "dixora_trusted_device — kasiyer/garson panelinde PIN ile hızlı girişe izin veren, cihaza özgü güvenilir cihaz kaydı (HttpOnly).",
        "dixora_loyalty_[işletmeye özel kod] — QR menüden sadakat programına kaydolan bir müşterinin kendi üyelik oturumunu tutan çerez (HttpOnly).",
        "Sipariş sepeti (sessionStorage) — QR menüde sepetinize eklediğiniz ürünlerin sekme kapanana kadar hatırlanmasını sağlar.",
        "Çerez tercihi kaydı (localStorage) — bu bannerdaki seçiminizi (kabul/ret/tercihler) hatırlamak için kullanılır.",
      ],
    },
    {
      heading: "3. Tercih / Fonksiyonel Depolama",
      paragraphs: [
        "Bu kayıtlar zorunlu değildir; devre dışı bırakılmaları Hizmet'i kullanılamaz hâle getirmez, yalnızca aşağıdaki kişiselleştirmeleri sıfırlar.",
      ],
      list: [
        "Tema tercihi (localStorage) — işletme panelinde ve QR menüde açık/koyu görünüm tercihinizi hatırlar.",
        "Dil tercihi (localStorage) — QR menüde seçtiğiniz görüntüleme dilini hatırlar.",
        "Ses bildirimi tercihi (localStorage) — kasiyer panelinde sipariş sesi açık/kapalı tercihinizi hatırlar.",
        "Karşılama ekranı gösterim kaydı (sessionStorage) — QR menü açılış animasyonunun aynı oturumda tekrar gösterilmemesini sağlar.",
      ],
    },
    {
      heading: "4. Analitik Çerezler",
      paragraphs: [
        "Bu yazı itibarıyla Dixora, ziyaretçi davranışını ölçen herhangi bir analitik veya izleme aracı (ör. Google Analytics, Hotjar, Microsoft Clarity) kullanmamaktadır. Bu kategori, ileride bir analitik araç eklenmesi ihtimaline karşı bu politikada ve çerez tercihleri panelinde ayrılmış durumdadır; herhangi bir analitik betiği eklendiğinde, yalnızca bu kategoriye onay verdiğinizde çalışacak şekilde devreye alınacaktır.",
      ],
    },
    {
      heading: "5. Pazarlama Çerezleri",
      paragraphs: [
        "Bu yazı itibarıyla Dixora, reklam hedeflemesi veya yeniden pazarlama amacıyla herhangi bir üçüncü taraf pazarlama/reklam çerezi (ör. Meta Pixel, Google Ads) kullanmamaktadır. Bu kategori de yukarıdaki gibi ileriye dönük olarak ayrılmıştır.",
        "Bu kategori, kayıt formundaki isteğe bağlı \"ticari elektronik ileti\" (kampanya e-postası) izninden farklıdır; e-posta izni bir çerez değil, doğrudan sizin verdiğiniz bir iletişim onayıdır ve Gizlilik Politikası'nda ayrıca açıklanır.",
      ],
    },
    {
      heading: "6. Tercihlerinizi Yönetme",
      paragraphs: [
        "Sayfanın altındaki çerez bildiriminde \"Kabul Et\", \"Reddet\" veya \"Tercihleri Yönet\" seçeneklerinden birini kullanabilirsiniz. \"Reddet\", zorunlu olmayan hiçbir kategoriyi etkinleştirmez. Tercihlerinizi dilediğiniz zaman bu sayfanın altındaki veya site genelindeki \"Çerez Tercihleri\" bağlantısından yeniden açabilirsiniz.",
        "Zorunlu kategori, Hizmet'in çalışması için gerekli olduğundan bu araçtan kapatılamaz; tarayıcınızın kendi ayarlarından tüm çerezleri engelleyebilirsiniz, ancak bu durumda oturum açma gibi temel işlevler çalışmayabilir.",
      ],
    },
  ],
};
