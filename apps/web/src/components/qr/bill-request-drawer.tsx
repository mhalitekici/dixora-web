"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { Banknote, BedDouble, CreditCard, Loader2, UserPlus } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { loyaltyApi } from "@/components/loyalty/loyalty-api"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type PaymentPreference = "CASH" | "CARD" | "ROOM_CHARGE"

const PAYMENT_OPTIONS: Array<{
  value: PaymentPreference
  label: string
  description: string
  icon: typeof Banknote
}> = [
  { value: "CASH", label: "Nakit", description: "Nakit ödeme tercihi", icon: Banknote },
  { value: "CARD", label: "Kart", description: "Kartla ödeme tercihi", icon: CreditCard },
  { value: "ROOM_CHARGE", label: "Odaya yaz", description: "Oda hesabına eklensin", icon: BedDouble },
]

export function BillRequestDrawer({
  open,
  onOpenChange,
  businessSlug,
  branchSlug,
  total,
  submitting,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  businessSlug: string
  branchSlug: string
  total: string
  submitting: boolean
  onSubmit: (input: {
    payment_preference: PaymentPreference
    room_reference: string | null
    membership_code: string | null
  }) => Promise<void>
}) {
  const [paymentPreference, setPaymentPreference] = useState<PaymentPreference>("CARD")
  const [roomReference, setRoomReference] = useState("")
  const [membershipCode, setMembershipCode] = useState("")
  const [joinOpen, setJoinOpen] = useState(false)
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [verificationId, setVerificationId] = useState<string | null>(null)
  const [verificationCode, setVerificationCode] = useState("")
  const [developmentCode, setDevelopmentCode] = useState<string | null>(null)
  const [membershipConsent, setMembershipConsent] = useState(false)
  const loyaltyOfferQuery = useQuery({
    queryKey: ["loyalty", "public", "offer", businessSlug, branchSlug],
    queryFn: ({ signal }) => loyaltyApi.offer(businessSlug, branchSlug, signal),
    enabled: open,
    staleTime: 60_000,
  })
  const loyaltyAvailable = loyaltyOfferQuery.data?.enabled === true

  const emailEnrollmentMutation = useMutation({
    mutationFn: () => {
      if (!membershipConsent) throw new Error("Üyelik izni gerekli.")
      return loyaltyApi.publicEmailEnrollmentStart(businessSlug, branchSlug, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        birth_date: null,
        consent_accepted: true,
      })
    },
    onSuccess: (result) => {
      setVerificationId(result.verification_id)
      setDevelopmentCode(result.development_code)
      toast.success("Doğrulama kodu gönderildi")
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Kod gönderilemedi."),
  })

  const enrollmentMutation = useMutation({
    mutationFn: () => {
      return loyaltyApi.publicEmailEnrollmentConfirm(businessSlug, branchSlug, {
        verification_id: verificationId ?? "",
        code: verificationCode.trim(),
      })
    },
    onSuccess: (result) => {
      setMembershipCode(result.member_code)
      setJoinOpen(false)
      setVerificationCode("")
      toast.success("Üyelik oluşturuldu", { description: `Kodunuz: ${result.member_code}` })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Üyelik oluşturulamadı."),
  })

  const roomRequired = paymentPreference === "ROOM_CHARGE"
  const canSubmit = !submitting && (!roomRequired || roomReference.trim().length > 0)

  async function submit() {
    if (!canSubmit) return
    await onSubmit({
      payment_preference: paymentPreference,
      room_reference: roomRequired ? roomReference.trim() : null,
      membership_code: membershipCode.trim().toUpperCase() || null,
    })
    onOpenChange(false)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className="mx-auto max-w-2xl">
        <DrawerHeader className="border-b px-5 pb-4 text-left">
          <DrawerTitle className="text-xl font-semibold">Hesabı iste</DrawerTitle>
          <DrawerDescription>
            {total} tutarındaki hesabınız için garson masanıza yönlendirilir.
          </DrawerDescription>
        </DrawerHeader>

        <div className="scrollbar-subtle flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Ödeme tercihiniz</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {PAYMENT_OPTIONS.map((option) => {
                const Icon = option.icon
                const selected = option.value === paymentPreference
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPaymentPreference(option.value)}
                    className={cn(
                      "focus-operational flex min-h-28 flex-col items-start rounded-xl border p-3 text-left transition-colors",
                      selected
                        ? "border-[var(--qr-primary)] bg-[var(--qr-primary)]/10 text-foreground"
                        : "bg-card hover:border-[var(--qr-primary)]/40",
                    )}
                  >
                    <Icon className={cn("size-5", selected && "text-[var(--qr-primary)]")} />
                    <span className="mt-3 text-sm font-semibold">{option.label}</span>
                    <span className="mt-1 text-xs leading-4 text-muted-foreground">{option.description}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          {roomRequired ? (
            <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
              <Label htmlFor="qr-room-reference">Oda numarası veya misafir adı</Label>
              <Input
                id="qr-room-reference"
                value={roomReference}
                onChange={(event) => setRoomReference(event.target.value)}
                placeholder="Örn. 214 veya Ahmet Yılmaz"
                className="h-11 rounded-lg bg-background"
              />
              <p className="text-xs leading-5 text-muted-foreground">Garson, oda ve misafir bilgisini doğruladıktan sonra hesabı odaya işler.</p>
            </div>
          ) : null}

          {loyaltyAvailable ? (
            <section className="border-t pt-5" aria-labelledby="qr-membership-title">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="qr-membership-title" className="text-sm font-semibold">Üyelik ve kampanyalar</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Üyelik kodunuz varsa girin; garson avantajlarınızı hesaba uygular.</p>
              </div>
              <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-lg" onClick={() => setJoinOpen((current) => !current)}>
                <UserPlus /> Yeni üye
              </Button>
            </div>
            <Input
              aria-label="Üyelik kodu"
              value={membershipCode}
              onChange={(event) => setMembershipCode(event.target.value.toUpperCase())}
              placeholder="Üyelik kodu"
              autoComplete="off"
              maxLength={32}
              className="mt-3 h-11 rounded-lg"
            />

            {joinOpen ? (
              <div className="mt-3 space-y-3 rounded-xl border bg-muted/30 p-3">
                <div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="qr-member-first-name">Ad</Label>
                      <Input id="qr-member-first-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} className="mt-1 h-11 rounded-lg bg-background" />
                    </div>
                    <div>
                      <Label htmlFor="qr-member-last-name">Soyad</Label>
                      <Input id="qr-member-last-name" value={lastName} onChange={(event) => setLastName(event.target.value)} className="mt-1 h-11 rounded-lg bg-background" />
                    </div>
                  </div>
                  <Label htmlFor="qr-member-email">E-posta</Label>
                  <Input id="qr-member-email" type="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ornek@eposta.com" className="mt-1 h-11 rounded-lg bg-background" />
                </div>
                {!verificationId ? (
                  <>
                    <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                      <input type="checkbox" checked={membershipConsent} onChange={(event) => setMembershipConsent(event.target.checked)} className="mt-1 size-4 accent-[var(--qr-primary)]" />
                      Sadakat programı kapsamında e-posta adresime doğrulama kodu gönderilmesini kabul ediyorum.
                    </label>
                    <Button type="button" variant="outline" className="w-full rounded-lg" disabled={firstName.trim().length === 0 || lastName.trim().length === 0 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) || !membershipConsent || emailEnrollmentMutation.isPending} onClick={() => emailEnrollmentMutation.mutate()}>
                      {emailEnrollmentMutation.isPending ? <Loader2 className="animate-spin" /> : null} Kodu gönder
                    </Button>
                  </>
                ) : (
                  <>
                    <div>
                      <Label htmlFor="qr-member-code">Doğrulama kodu</Label>
                      <Input id="qr-member-code" inputMode="numeric" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" maxLength={6} className="mt-1 h-11 rounded-lg bg-background" />
                    </div>
                    {developmentCode ? <p className="text-xs text-amber-700 dark:text-amber-300">Geliştirme kodu: {developmentCode}</p> : null}
                    <Button type="button" variant="outline" className="w-full rounded-lg" disabled={verificationCode.length < 4 || !membershipConsent || enrollmentMutation.isPending} onClick={() => enrollmentMutation.mutate()}>
                      {enrollmentMutation.isPending ? <Loader2 className="animate-spin" /> : null} Üyeliği oluştur
                    </Button>
                  </>
                )}
              </div>
            ) : null}
            </section>
          ) : null}
        </div>

        <DrawerFooter className="border-t px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          <Button type="button" className="h-12 rounded-xl bg-[var(--qr-primary)] text-[var(--qr-on-primary)] hover:opacity-90" disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? <Loader2 className="animate-spin" /> : null} Hesap talebini garsona gönder
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
