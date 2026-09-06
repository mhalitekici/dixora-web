import { Info } from "lucide-react"

/**
 * Explains the bracketed `[ŞİRKET TİCARİ UNVANI]`-style placeholders that
 * still appear below, instead of leaving a reader to wonder whether the page
 * is unfinished or broken.
 *
 * Dixora is pre-registration at MVP stage: there is no incorporated company
 * yet to name, so these fields are placeholders by necessity, not oversight.
 * Never replace the bracketed tokens with a guessed company name, VKN,
 * MERSİS number or address — fill them in only once those are real, and
 * remove this notice at the same time.
 */
export function LegalPlaceholderNotice({ className }: { className?: string }) {
  return (
    <div
      role="note"
      className={`flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/8 p-4 text-sm leading-6 text-amber-900 dark:text-amber-200 ${className ?? ""}`}
    >
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>
        Dixora şu anda erken (MVP) aşamadadır ve resmi şirket sicil bilgileri
        (ticari unvan, VKN, MERSİS numarası, tescilli adres) henüz
        kesinleşmemiştir. Aşağıdaki köşeli parantez içindeki alanlar bu
        yüzden geçici olarak boş bırakılmıştır ve şirket resmen kurulduğunda
        gerçek bilgilerle güncellenecektir.
      </p>
    </div>
  )
}
