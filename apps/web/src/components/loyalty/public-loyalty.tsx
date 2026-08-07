"use client"

import { useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  Check,
  Copy,
  Gift,
  HeartHandshake,
  LoaderCircle,
  LogOut,
  ShieldCheck,
  Smartphone,
} from "lucide-react"
import { useId, useState, type ReactNode } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError } from "@/lib/api/errors"

import { loyaltyApi } from "./loyalty-api"
import {
  loyaltyKeys,
  usePublicLoyaltyOffer,
  usePublicLoyaltyStatus,
} from "./loyalty-hooks"
import { StampProgress } from "./stamp-progress"
import type { LoyaltyRewardStatus, LoyaltyVerification } from "./types"

export function PublicLoyalty({
  businessSlug,
  branchSlug,
}: {
  businessSlug: string
  branchSlug: string
}) {
  const queryClient = useQueryClient()
  const offer = usePublicLoyaltyOffer(businessSlug, branchSlug)
  const status = usePublicLoyaltyStatus(
    businessSlug,
    branchSlug,
    offer.data?.enabled === true,
  )
  const [joining, setJoining] = useState(false)

  if (!offer.data?.enabled) return null
  if (status.isPending) {
    return (
      <section
        className="mb-5 flex items-center gap-3 rounded-3xl border bg-[#fffaf2] p-4 text-sm text-muted-foreground dark:bg-card"
        aria-live="polite"
        aria-busy="true"
      >
        <LoaderCircle className="size-4 animate-spin" />
        Müdavim biletiniz kontrol ediliyor…
      </section>
    )
  }
  if (
    status.isError &&
    (!(status.error instanceof ApiError) || status.error.status !== 401)
  ) {
    return (
      <section className="mb-5 rounded-3xl border border-destructive/30 bg-white p-4 dark:bg-card">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div>
            <p className="text-sm font-semibold">Sadakat bilgisi alınamadı</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Bağlantıyı kontrol edip yeniden deneyin.
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" className="mt-3" onClick={() => status.refetch()}>
          Yeniden dene
        </Button>
      </section>
    )
  }
  if (status.data) {
    const memberStatus = status.data
    const progress = Math.max(0, Number(memberStatus.progress) || 0)
    const target = Math.max(1, memberStatus.target)
    const cycleProgress = progress % target
    const availableRewards = memberStatus.rewards.filter((reward) => reward.status === "AVAILABLE")

    return (
      <section
        className="mb-5 overflow-hidden rounded-[1.75rem] border border-[var(--qr-primary)]/20 bg-[#fffaf2] text-[#292524] shadow-[0_18px_50px_-38px_rgba(41,37,36,0.65)] dark:bg-[#292522] dark:text-stone-50"
        aria-labelledby="loyalty-member-title"
      >
        <div className="h-1.5 bg-[var(--qr-primary)]" aria-hidden="true" />
        <div className="border-b border-dashed border-current/20 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--qr-primary)] text-[var(--qr-on-primary)]">
              <HeartHandshake className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[var(--qr-primary)]">
                Müdavim biletiniz
              </p>
              <h2 id="loyalty-member-title" className="mt-1 truncate text-lg font-semibold">
                {memberStatus.program_name}
              </h2>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                Üye kodu <span className="font-mono font-semibold text-current">{memberStatus.membership_code}</span>
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label="Bu cihazdaki sadakat üyeliğini unut"
              onClick={async () => {
                try {
                  await loyaltyApi.forget(businessSlug)
                  queryClient.removeQueries({ queryKey: loyaltyKeys.status(businessSlug, branchSlug) })
                  setJoining(false)
                  toast.success("Bu cihazdaki sadakat oturumu kapatıldı.")
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Oturum kapatılamadı.")
                }
              }}
            >
              <LogOut />
            </Button>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-stone-500 dark:text-stone-400">Sonraki ödüle</p>
              <p className="mt-0.5 text-xl font-semibold tracking-tight">
                {cycleProgress === 0 && progress > 0 ? "Yeni tur başladı" : `${target - cycleProgress} adım kaldı`}
              </p>
            </div>
            <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-semibold tabular-nums dark:bg-white/10">
              {cycleProgress} / {target}
            </span>
          </div>
          <StampProgress
            value={cycleProgress}
            target={target}
            className="mt-5"
            stampClassName="bg-[#fffaf2] dark:bg-[#292522]"
            completeClassName="border-[var(--qr-primary)] bg-[var(--qr-primary)] text-[var(--qr-on-primary)] shadow-none"
          />

          {availableRewards.length > 0 ? (
            <div className="mt-6 rounded-2xl bg-[#292524] p-4 text-stone-50 dark:bg-black/25">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-orange-300">
                  Kullanıma hazır ödüller
                </p>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-bold tabular-nums">
                  {availableRewards.length}
                </span>
              </div>
              <div className="mt-3 divide-y divide-white/10">
                {availableRewards.map((reward) => (
                  <div key={reward.redemption_code} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <Gift className="size-4 shrink-0 text-orange-300" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{reward.description}</p>
                      <p className="font-mono text-[0.65rem] text-stone-400">{reward.redemption_code}</p>
                    </div>
                    <span className="text-[0.65rem] font-semibold text-emerald-300">Hazır</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-5 rounded-2xl border border-dashed border-current/20 p-3 text-center text-xs text-stone-500 dark:text-stone-400">
              Hedef tamamlandığında ödülünüz burada hazır olacak.
            </p>
          )}

          {memberStatus.rewards.some((reward) => reward.status !== "AVAILABLE") ? (
            <details className="mt-4 text-xs text-stone-500 dark:text-stone-400">
              <summary className="cursor-pointer font-medium">Geçmiş ödüller</summary>
              <div className="mt-2 divide-y rounded-xl border border-current/10 px-3">
                {memberStatus.rewards
                  .filter((reward) => reward.status !== "AVAILABLE")
                  .map((reward) => (
                    <div key={reward.redemption_code} className="flex items-center justify-between gap-3 py-2">
                      <span className="truncate">{reward.description}</span>
                      <span className="shrink-0 font-medium">{rewardStatusLabel(reward.status)}</span>
                    </div>
                  ))}
              </div>
            </details>
          ) : null}

          <button
            type="button"
            className="mt-5 inline-flex min-h-9 items-center gap-2 rounded-lg text-xs font-medium text-stone-500 underline-offset-4 hover:text-stone-900 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--qr-primary)]/35 dark:text-stone-400 dark:hover:text-white"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(memberStatus.referral_code)
                toast.success("Davet kodu kopyalandı.")
              } catch {
                toast.error("Davet kodu panoya kopyalanamadı.")
              }
            }}
          >
            <Copy className="size-3.5" />
            Arkadaşını davet et · {memberStatus.referral_code}
          </button>
        </div>
      </section>
    )
  }

  const threshold = Math.max(1, offer.data.threshold ?? 1)

  return (
    <section
      className="mb-5 overflow-hidden rounded-[1.75rem] border border-[var(--qr-primary)]/20 bg-[#fffaf2] text-[#292524] shadow-[0_18px_50px_-38px_rgba(41,37,36,0.65)] dark:bg-[#292522] dark:text-stone-50"
      aria-labelledby="loyalty-offer-title"
    >
      <div className="h-1.5 bg-[var(--qr-primary)]" aria-hidden="true" />
      <div className="border-b border-dashed border-current/20 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--qr-primary)] text-[var(--qr-on-primary)]">
            <Gift className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[var(--qr-primary)]">
              Müdavimlere özel
            </p>
            <h2 id="loyalty-offer-title" className="mt-1 text-lg font-semibold">
              {offer.data.program_name}
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-300">
              <strong className="font-semibold text-stone-900 dark:text-white">
                {threshold} {offer.data.campaign_type === "VISIT_COUNT" ? "ziyaret" : "ürün"}
              </strong>
              {offer.data.reward_description
                ? ` tamamla, ${offer.data.reward_description} kazan.`
                : " tamamla, ödülünü kazan."}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between text-xs font-medium">
          <span>İlk ödüle giden yol</span>
          <span className="tabular-nums">0 / {threshold}</span>
        </div>
        <StampProgress
          value={0}
          target={threshold}
          className="mt-4"
          stampClassName="bg-[#fffaf2] dark:bg-[#292522]"
          completeClassName="border-[var(--qr-primary)] bg-[var(--qr-primary)] text-[var(--qr-on-primary)] shadow-none"
        />

        <div className="mt-5 space-y-2 rounded-2xl bg-black/[0.035] p-4 text-xs leading-5 text-stone-600 dark:bg-white/[0.055] dark:text-stone-300">
          {offer.data.qualifying_description ? (
            <RuleLine>Geçerli seçim: {offer.data.qualifying_description}</RuleLine>
          ) : null}
          {Number(offer.data.minimum_order_amount ?? 0) > 0 ? (
            <RuleLine>
              Minimum sipariş: {Number(offer.data.minimum_order_amount).toLocaleString("tr-TR", { style: "currency", currency: "TRY" })}
            </RuleLine>
          ) : null}
          {offer.data.campaign_type === "VISIT_COUNT" ? (
            <RuleLine>
              {offer.data.allow_multiple_same_day
                ? "Aynı gün birden fazla uygun ziyaret sayılır."
                : "Aynı gün yalnızca bir uygun ziyaret sayılır."}
            </RuleLine>
          ) : null}
          <RuleLine>Ödül sonraki uygun siparişte kullanılabilir.</RuleLine>
          {offer.data.ends_at ? (
            <RuleLine>
              Son katılım: {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(offer.data.ends_at))}
            </RuleLine>
          ) : null}
        </div>

        {joining ? (
          <EnrollmentForm
            businessSlug={businessSlug}
            branchSlug={branchSlug}
            onCancel={() => setJoining(false)}
            onComplete={async () => {
              await queryClient.invalidateQueries({
                queryKey: loyaltyKeys.status(businessSlug, branchSlug),
              })
              setJoining(false)
            }}
          />
        ) : (
          <Button
            type="button"
            size="lg"
            className="mt-5 w-full bg-[var(--qr-primary)] text-[var(--qr-on-primary)] hover:opacity-90"
            onClick={() => setJoining(true)}
          >
            <HeartHandshake />
            Programa katıl
          </Button>
        )}
      </div>
    </section>
  )
}

function EnrollmentForm({
  businessSlug,
  branchSlug,
  onCancel,
  onComplete,
}: {
  businessSlug: string
  branchSlug: string
  onCancel: () => void
  onComplete: () => Promise<void>
}) {
  const consentId = useId()
  const [phone, setPhone] = useState("")
  const [referralCode, setReferralCode] = useState("")
  const [consent, setConsent] = useState(false)
  const [verification, setVerification] = useState<LoyaltyVerification | null>(null)
  const [code, setCode] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    if (!consent) {
      setError("Katılım için açık rıza onayı gerekli.")
      return
    }
    setPending(true)
    setError(null)
    try {
      setVerification(
        await loyaltyApi.verificationStart(businessSlug, branchSlug, {
          phone,
          consent_accepted: true,
        }),
      )
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Doğrulama başlatılamadı.")
    } finally {
      setPending(false)
    }
  }

  async function enroll() {
    if (!verification) return
    setPending(true)
    setError(null)
    try {
      await loyaltyApi.enroll(businessSlug, branchSlug, {
        phone,
        verification_token: verification.verification_token,
        verification_code: code,
        consent_accepted: true,
        consent_text_version: "2026-08",
        referral_code: referralCode.trim() || null,
      })
      toast.success("Sadakat üyeliğiniz oluşturuldu.")
      await onComplete()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Kayıt tamamlanamadı.")
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="mt-5 border-t border-dashed border-current/20 pt-5"
      onSubmit={(event) => {
        event.preventDefault()
        void (verification ? enroll() : start())
      }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-[var(--qr-primary)]">
            {verification ? "Adım 2 / 2" : "Adım 1 / 2"}
          </p>
          <h3 className="mt-1 font-semibold">
            {verification ? "Telefonunuzu doğrulayın" : "Biletinizi oluşturun"}
          </h3>
        </div>
        <span className="flex size-9 items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
          {verification ? <ShieldCheck className="size-4" /> : <Smartphone className="size-4" />}
        </span>
      </div>

      <div>
        <Label htmlFor="loyalty-phone">Telefon numarası</Label>
        <Input
          id="loyalty-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          disabled={Boolean(verification)}
          onChange={(event) => setPhone(event.target.value)}
          className="mt-1.5 bg-white dark:bg-black/15"
          placeholder="05xx xxx xx xx"
          aria-invalid={Boolean(error && !verification)}
        />
      </div>

      {!verification ? (
        <div className="mt-3 space-y-3">
          <div>
            <Label htmlFor="loyalty-referral">Davet kodu <span className="font-normal text-muted-foreground">(isteğe bağlı)</span></Label>
            <Input
              id="loyalty-referral"
              value={referralCode}
              onChange={(event) => setReferralCode(event.target.value.toUpperCase())}
              className="mt-1.5 bg-white font-mono uppercase dark:bg-black/15"
              autoComplete="off"
            />
          </div>
          <label htmlFor={consentId} className="flex items-start gap-3 rounded-2xl border border-current/10 bg-white/55 p-3 text-xs leading-5 dark:bg-black/10">
            <Checkbox
              id={consentId}
              checked={consent}
              onCheckedChange={(value) => setConsent(value === true)}
              aria-invalid={Boolean(error && !consent)}
            />
            <span>
              Telefon numaramın bu işletmenin sadakat üyeliği, ilerleme ve ödül kayıtları için
              işlenmesine açık rıza veriyorum.
            </span>
          </label>
          <div className="flex items-start gap-2 text-[0.7rem] leading-5 text-stone-500 dark:text-stone-400">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>Katılım telefon doğrulamasıyla korunur; numaranız menüde gösterilmez.</span>
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full bg-[var(--qr-primary)] text-[var(--qr-on-primary)] hover:opacity-90"
            disabled={pending || phone.length < 7}
          >
            {pending ? <LoaderCircle className="animate-spin" /> : <Smartphone />}
            Doğrulama kodu gönder
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5">
            <p className="font-semibold">
              {verification.mode === "DEVELOPMENT" ? "Geliştirme doğrulaması" : "SMS gönderildi"}
            </p>
            <p className="text-stone-600 dark:text-stone-300">{verification.message}</p>
            {verification.mode === "DEVELOPMENT" && verification.development_code ? (
              <p className="mt-1">
                Yerel test kodu: <span className="font-mono font-bold">{verification.development_code}</span>
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="loyalty-code">6 haneli doğrulama kodu</Label>
            <Input
              id="loyalty-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="mt-1.5 bg-white text-center font-mono text-lg tracking-[0.35em] dark:bg-black/15"
              maxLength={6}
              aria-invalid={Boolean(error)}
            />
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full bg-[var(--qr-primary)] text-[var(--qr-on-primary)] hover:opacity-90"
            disabled={pending || code.length < 6}
          >
            {pending ? <LoaderCircle className="animate-spin" /> : <Check />}
            Üyeliği tamamla
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={pending}
            onClick={() => {
              setVerification(null)
              setCode("")
              setError(null)
            }}
          >
            Telefon numarasını değiştir
          </Button>
        </div>
      )}

      {error ? <p role="alert" className="mt-3 text-xs font-medium text-destructive">{error}</p> : null}
      <Button type="button" variant="ghost" className="mt-1 w-full" onClick={onCancel} disabled={pending}>
        Vazgeç
      </Button>
    </form>
  )
}

function RuleLine({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2">
      <Check className="mt-1 size-3 shrink-0 text-[var(--qr-primary)]" strokeWidth={3} />
      <span>{children}</span>
    </p>
  )
}

function rewardStatusLabel(status: LoyaltyRewardStatus): string {
  if (status === "REDEEMED") return "Kullanıldı"
  if (status === "REVERSED") return "Geri alındı"
  return "Hazır"
}
