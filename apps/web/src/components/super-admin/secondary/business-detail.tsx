"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  Ban,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleSlash2,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UserCog,
  Store,
  Tag,
} from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { StatusBadge } from "@/components/shared/status-badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "@/lib/formatters"
import { cn } from "@/lib/utils"

import { AdapterNotice } from "./adapter-notice"
import {
  getBusiness,
  getBusinessOverview,
  getBusinessUsers,
  reactivateBusiness,
  resetBusinessUserPassword,
  secondaryAdminQueryKeys,
  setBusinessLifecycle,
  supportModeCapability,
} from "./platform-admin-api"
import {
  QueryErrorState,
  SecondaryPageSkeleton,
} from "./query-state"
import type { PlatformBusiness, TenantState } from "./types"

type LifecycleAction = "activate" | "suspend"

const lifecycleCopy: Record<
  LifecycleAction,
  {
    title: string
    description: (name: string) => string
    action: string
    success: string
    icon: typeof CheckCircle2
  }
> = {
  activate: {
    title: "İşletmeyi etkinleştir",
    description: (name) =>
      `${name} yeniden erişilebilir olacak ve tenant yaşam döngüsü ACTIVE durumuna geçirilecek.`,
    action: "Etkinleştir",
    success: "İşletme etkinleştirildi.",
    icon: CheckCircle2,
  },
  suspend: {
    title: "İşletmeyi askıya al",
    description: (name) =>
      `${name} için tenant erişimi kapatılacak ve yaşam döngüsü SUSPENDED durumuna geçirilecek.`,
    action: "Askıya al",
    success: "İşletme askıya alındı.",
    icon: Ban,
  },
}

const statePresentation: Record<
  TenantState,
  { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }
> = {
  ACTIVE: { label: "Aktif", tone: "success" },
  TRIAL: { label: "Deneme", tone: "info" },
  PAST_DUE: { label: "Ödeme gecikmiş", tone: "warning" },
  SUSPENDED: { label: "Askıda", tone: "danger" },
  CANCELLED: { label: "İptal", tone: "neutral" },
  ARCHIVED: { label: "Arşivlendi", tone: "neutral" },
}

export function BusinessDetail({ businessId }: { businessId: string }) {
  const queryClient = useQueryClient()
  const [pendingAction, setPendingAction] = useState<LifecycleAction | null>(
    null,
  )
  const [supportOpen, setSupportOpen] = useState(false)
  const [supportReason, setSupportReason] = useState("")
  const [passwordResetOpen, setPasswordResetOpen] = useState(false)
  const [resetUserId, setResetUserId] = useState("")
  const [resetPassword, setResetPassword] = useState("")
  const [resetReason, setResetReason] = useState("")
  const [reactivateOpen, setReactivateOpen] = useState(false)
  const [extendDays, setExtendDays] = useState("30")
  const [reactivateNote, setReactivateNote] = useState("")

  const query = useQuery({
    queryKey: secondaryAdminQueryKeys.business(businessId),
    queryFn: ({ signal }) => getBusiness(businessId, signal),
  })
  const overviewQuery = useQuery({
    queryKey: [...secondaryAdminQueryKeys.business(businessId), "overview"],
    queryFn: ({ signal }) => getBusinessOverview(businessId, signal),
  })

  const lifecycleMutation = useMutation({
    mutationFn: (action: LifecycleAction) =>
      setBusinessLifecycle(businessId, action),
    onSuccess: async (business, action) => {
      queryClient.setQueryData(
        secondaryAdminQueryKeys.business(businessId),
        business,
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["platform", "businesses"] }),
        queryClient.invalidateQueries({
          queryKey: secondaryAdminQueryKeys.subscriptions,
        }),
      ])
      setPendingAction(null)
      toast.success(lifecycleCopy[action].success)
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "İşletme durumu güncellenemedi.",
      )
    },
  })

  const usersQuery = useQuery({
    queryKey: ["secondary-admin", "business-users", businessId],
    queryFn: ({ signal }) => getBusinessUsers(businessId, signal),
    enabled: passwordResetOpen,
  })

  const passwordResetMutation = useMutation({
    mutationFn: () =>
      resetBusinessUserPassword(businessId, resetUserId, {
        newPassword: resetPassword,
        reason: resetReason,
      }),
    onSuccess: (result) => {
      setPasswordResetOpen(false)
      setResetUserId("")
      setResetPassword("")
      setResetReason("")
      toast.success(`${result.username} için geçici şifre tanımlandı`, {
        description: `${result.sessions_revoked} açık oturum kapatıldı. Şifreyi kullanıcıya güvenli bir kanaldan iletin.`,
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Şifre sıfırlanamadı.",
      )
    },
  })

  const reactivateMutation = useMutation({
    mutationFn: () =>
      reactivateBusiness(businessId, {
        extendDays: Number(extendDays) || 30,
        note: reactivateNote,
      }),
    onSuccess: async (business) => {
      queryClient.setQueryData(
        secondaryAdminQueryKeys.business(businessId),
        business,
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["platform", "businesses"] }),
        queryClient.invalidateQueries({
          queryKey: secondaryAdminQueryKeys.subscriptions,
        }),
      ])
      setReactivateOpen(false)
      setReactivateNote("")
      toast.success("Üyelik etkinleştirildi ve süre uzatıldı.")
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Üyelik uzatılamadı.",
      )
    },
  })

  if (query.isPending) {
    return <SecondaryPageSkeleton />
  }

  if (query.isError) {
    return (
      <>
        <PageHeader
          eyebrow="Dixora Platform"
          title="İşletme ayrıntısı"
          description="Tenant kaydı API üzerinden yüklenemedi."
          icon={Building2}
          actions={
            <Link
              href="/super-admin/businesses"
              className={buttonVariants({ variant: "outline" })}
            >
              <ArrowLeft />
              İşletmelere dön
            </Link>
          }
        />
        <QueryErrorState
          title="İşletme kaydı açılamadı"
          description={
            query.error instanceof Error
              ? query.error.message
              : "İşletme bilgileri alınırken beklenmeyen bir hata oluştu."
          }
          retry={() => void query.refetch()}
        />
      </>
    )
  }

  const business = query.data
  const status =
    statePresentation[business.state] ?? statePresentation.ARCHIVED
  const isSuspended =
    business.state === "SUSPENDED" || business.is_active === false
  const activeNow =
    business.state === "ACTIVE" && business.is_active === true

  const overview = overviewQuery.data
  const money = (value: string | number | undefined) =>
    value === undefined
      ? "—"
      : new Intl.NumberFormat("tr-TR", {
          style: "currency",
          currency: overview?.currency ?? "TRY",
          minimumFractionDigits: 2,
        }).format(Number(value))
  const day = (value: string | null | undefined) =>
    value ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(value)) : "—"

  return (
    <>
      <PageHeader
        eyebrow="İşletme yönetimi"
        title={business.name}
        description={`Tenant kodu ${business.slug} · ${formatBusinessType(business.business_type)}`}
        icon={Building2}
        actions={
          <>
            <Link
              href="/super-admin/businesses"
              className={buttonVariants({ variant: "outline" })}
            >
              <ArrowLeft />
              Listeye dön
            </Link>
            <Button variant="outline" onClick={() => setSupportOpen(true)}>
              <KeyRound />
              Destek modu
            </Button>
            <Button variant="outline" onClick={() => setPasswordResetOpen(true)}>
              <UserCog />
              Şifre sıfırla
            </Button>
            {isSuspended ? (
              <Button
                disabled={
                  business.state === "ARCHIVED" ||
                  lifecycleMutation.isPending
                }
                onClick={() => setPendingAction("activate")}
              >
                <CheckCircle2 />
                Etkinleştir
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={
                  business.state === "ARCHIVED" ||
                  lifecycleMutation.isPending
                }
                onClick={() => setPendingAction("suspend")}
              >
                <Ban />
                Askıya al
              </Button>
            )}
            {!activeNow && business.state !== "ARCHIVED" ? (
              <Button variant="outline" onClick={() => setReactivateOpen(true)}>
                <RefreshCw />
                Üyeliği uzat / aktifleştir
              </Button>
            ) : null}
          </>
        }
      />

      {overview ? (
        <div className="mb-5 grid gap-3 lg:grid-cols-3">
          <div className="rounded-2xl border bg-card p-4">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              İletişim
            </p>
            <p className="mt-2 text-sm font-semibold">{overview.owner_name ?? "—"}</p>
            {overview.owner_email ? (
              <a
                href={`mailto:${overview.owner_email}`}
                className="mt-1 block truncate text-sm text-brand underline underline-offset-4"
              >
                {overview.owner_email}
              </a>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">E-posta yok</p>
            )}
            {overview.owner_phone ? (
              <a
                href={`tel:${overview.owner_phone}`}
                className="mt-1 block text-sm text-brand underline underline-offset-4"
              >
                {overview.owner_phone}
              </a>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Telefon yok</p>
            )}
          </div>

          <div className="rounded-2xl border bg-card p-4">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Şubeler ve kullanıcılar
            </p>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {overview.active_branches}
              <span className="ml-1 text-sm font-medium text-muted-foreground">
                aktif şube
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Toplam {overview.total_branches} şube kaydı · {overview.user_count} kullanıcı
            </p>
          </div>

          <div className="rounded-2xl border bg-card p-4">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Bu ayki tutar
            </p>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {money(overview.monthly_total)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {overview.plan_name ?? "Plan yok"} · {money(overview.base_monthly_price)} baz
              {overview.billable_extra_branches > 0
                ? ` + ${overview.billable_extra_branches} ek şube × ${money(overview.additional_branch_price)}`
                : ""}
            </p>
            <p className="mt-2 border-t pt-2 text-xs">
              <span className="text-muted-foreground">
                {overview.trial_ends_at ? "Deneme bitişi" : "Sonraki ödeme"}:{" "}
              </span>
              <strong>{day(overview.trial_ends_at ?? overview.next_payment_at)}</strong>
            </p>
          </div>
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DetailMetric
          icon={activeNow ? CheckCircle2 : CircleSlash2}
          label="Yaşam döngüsü"
          value={
            <StatusBadge tone={status.tone} pulse={activeNow}>
              {status.label}
            </StatusBadge>
          }
          detail={
            business.is_active
              ? "Tenant erişimi açık"
              : "Tenant erişimi kapalı"
          }
        />
        <DetailMetric
          icon={Store}
          label="İşletme tipi"
          value={formatBusinessType(business.business_type)}
          detail="API tenant profili"
        />
        <DetailMetric
          icon={CalendarDays}
          label="Oluşturulma"
          value={formatDateTime(business.created_at, {
            dateStyle: "medium",
          })}
          detail={formatDateTime(business.created_at)}
        />
        <DetailMetric
          icon={ShieldCheck}
          label="Yönetim kapsamı"
          value="Platform"
          detail="Durum mutasyonları denetlenir"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.75fr)]">
        <SectionCard
          title="Tenant kimliği"
          description="İşletmenin API tarafından döndürülen değişmez ve sınıflandırma bilgileri."
          contentClassName="space-y-1"
        >
          <IdentityRow
            icon={Building2}
            label="Görünen ad"
            value={business.name}
          />
          <Separator />
          <IdentityRow
            icon={Tag}
            label="Tenant kodu"
            value={business.slug}
            mono
            copyValue={business.slug}
          />
          <Separator />
          <IdentityRow
            icon={Store}
            label="İşletme tipi"
            value={formatBusinessType(business.business_type)}
          />
          <Separator />
          <IdentityRow
            icon={LockKeyhole}
            label="Tenant kimliği"
            value={business.id}
            mono
            copyValue={business.id}
          />
        </SectionCard>

        <SectionCard
          title="Güvenli işlemler"
          description="Erişim değişiklikleri onay gerektirir ve backend audit kaydı üretir."
          contentClassName="space-y-3"
        >
          <div className="rounded-xl border bg-muted/25 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold">Tenant erişimi</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {business.is_active
                    ? "Oturum açma ve tenant operasyonları etkin."
                    : "Tenant düzeyindeki erişim kapatılmış."}
                </p>
              </div>
              <StatusBadge
                tone={business.is_active ? "success" : "danger"}
                dot
              >
                {business.is_active ? "Açık" : "Kapalı"}
              </StatusBadge>
            </div>
          </div>

          <Button
            className="w-full justify-start"
            variant={isSuspended ? "default" : "destructive"}
            disabled={
              lifecycleMutation.isPending ||
              business.state === "ARCHIVED"
            }
            onClick={() =>
              setPendingAction(isSuspended ? "activate" : "suspend")
            }
          >
            {lifecycleMutation.isPending ? (
              <Loader2 className="animate-spin" />
            ) : isSuspended ? (
              <CheckCircle2 />
            ) : (
              <Ban />
            )}
            {isSuspended ? "İşletmeyi etkinleştir" : "İşletmeyi askıya al"}
          </Button>

          <Button
            className="w-full justify-start"
            variant="outline"
            onClick={() => setSupportOpen(true)}
          >
            <KeyRound />
            Destek modu sözleşmesini görüntüle
            <ExternalLink className="ml-auto size-3.5 text-muted-foreground" />
          </Button>
        </SectionCard>
      </div>

      <LifecycleConfirmation
        action={pendingAction}
        business={business}
        pending={lifecycleMutation.isPending}
        onCancel={() => setPendingAction(null)}
        onConfirm={(action) => lifecycleMutation.mutate(action)}
      />

      <Dialog
        open={supportOpen}
        onOpenChange={(open) => {
          setSupportOpen(open)
          if (!open) setSupportReason("")
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Denetlenebilir destek modu</DialogTitle>
            <DialogDescription>
              {business.name} tenantına süreli ve gerekçeli erişim sözleşmesi.
            </DialogDescription>
          </DialogHeader>

          <AdapterNotice
            title="Güvenli endpoint bekleniyor"
            badge={supportModeCapability.contract}
            tone="warning"
          >
            {supportModeCapability.explanation} Güvenlik nedeniyle istemci
            tarafında sahte tenant geçişi oluşturulmaz.
          </AdapterNotice>

          <div className="space-y-2">
            <Label htmlFor="support-reason">Destek gerekçesi</Label>
            <Textarea
              id="support-reason"
              value={supportReason}
              onChange={(event) => setSupportReason(event.target.value)}
              placeholder="Örn. müşteri talebi #DX-1042 için yazıcı yapılandırmasını inceleme"
              maxLength={500}
            />
            <div className="flex justify-between gap-3 text-[0.68rem] text-muted-foreground">
              <span>Gerekçe audit kaydına yazılacak.</span>
              <span className="tabular-nums">{supportReason.length}/500</span>
            </div>
          </div>

          <div className="grid gap-2 rounded-xl border bg-muted/25 p-3 text-xs sm:grid-cols-3">
            <ContractFact label="Kapsam" value={business.slug} />
            <ContractFact label="Süre" value="Süreli oturum" />
            <ContractFact label="Kayıt" value="Giriş + çıkış" />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSupportOpen(false)}>
              Kapat
            </Button>
            <Button disabled>
              <LockKeyhole />
              Endpoint bağlanmadı
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog
        open={passwordResetOpen}
        onOpenChange={(open) => {
          setPasswordResetOpen(open)
          if (!open) {
            setResetUserId("")
            setResetPassword("")
            setResetReason("")
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kullanıcı şifresi sıfırla</DialogTitle>
            <DialogDescription>
              {business.name} çalışanı için geçici bir şifre tanımlayın. Mevcut
              şifre görüntülenemez; yalnızca yenisi atanır ve kullanıcının açık
              oturumları kapatılır.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="reset-user">Kullanıcı</Label>
            {usersQuery.isPending ? (
              <p className="text-sm text-muted-foreground">Kullanıcılar yükleniyor…</p>
            ) : usersQuery.isError ? (
              <p className="text-sm text-destructive">Kullanıcılar alınamadı.</p>
            ) : (
              <select
                id="reset-user"
                value={resetUserId}
                onChange={(event) => setResetUserId(event.target.value)}
                className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="">Kullanıcı seçin…</option>
                {(usersQuery.data ?? []).map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.display_name} · {user.username}
                    {user.is_active ? "" : " (pasif)"}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reset-password">Geçici şifre</Label>
            <div className="flex gap-2">
              <Input
                id="reset-password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                placeholder="En az 10 karakter"
                className="h-11 rounded-xl font-mono"
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0"
                onClick={() => setResetPassword(generateTemporaryPassword())}
              >
                Üret
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Şifreyi kullanıcıya güvenli bir kanaldan iletin; bu ekrandan
              sonra tekrar görüntülenemez.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reset-reason">Gerekçe (opsiyonel)</Label>
            <Textarea
              id="reset-reason"
              value={resetReason}
              onChange={(event) => setResetReason(event.target.value)}
              placeholder="Örn. Destek talebi DX-1042 · telefonla kimlik doğrulandı"
              maxLength={500}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordResetOpen(false)}>
              Vazgeç
            </Button>
            <Button
              disabled={
                !resetUserId ||
                resetPassword.trim().length < 10 ||
                passwordResetMutation.isPending
              }
              onClick={() => passwordResetMutation.mutate()}
            >
              {passwordResetMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <UserCog />
              )}
              Şifreyi sıfırla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={reactivateOpen}
        onOpenChange={(open) => {
          setReactivateOpen(open)
          if (!open) setReactivateNote("")
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Üyeliği uzat / aktifleştir</DialogTitle>
            <DialogDescription>
              {business.name} için ödeme alındıktan sonra bu işlemi kullanın.
              Tenant durumu ACTIVE olarak ayarlanır ve abonelik bitiş tarihi
              bugünden itibaren uzatılır.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="reactivate-days">Kaç gün uzatılsın?</Label>
            <Input
              id="reactivate-days"
              type="number"
              min={1}
              max={365}
              value={extendDays}
              onChange={(event) => setExtendDays(event.target.value)}
              className="h-11 rounded-xl"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reactivate-note">Not (opsiyonel)</Label>
            <Textarea
              id="reactivate-note"
              value={reactivateNote}
              onChange={(event) => setReactivateNote(event.target.value)}
              placeholder="Örn. IBAN ile 1.200,00 TL ödeme alındı, dekont referansı..."
              maxLength={500}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReactivateOpen(false)}>
              Vazgeç
            </Button>
            <Button
              disabled={
                reactivateMutation.isPending ||
                !Number(extendDays) ||
                Number(extendDays) < 1
              }
              onClick={() => reactivateMutation.mutate()}
            >
              {reactivateMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              Onayla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function LifecycleConfirmation({
  action,
  business,
  pending,
  onCancel,
  onConfirm,
}: {
  action: LifecycleAction | null
  business: PlatformBusiness
  pending: boolean
  onCancel: () => void
  onConfirm: (action: LifecycleAction) => void
}) {
  const copy = action ? lifecycleCopy[action] : null
  const Icon = copy?.icon ?? ShieldCheck

  return (
    <AlertDialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia
            className={cn(
              action === "suspend"
                ? "bg-destructive/10 text-destructive"
                : "bg-emerald-500/10 text-emerald-700",
            )}
          >
            <Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>{copy?.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {copy?.description(business.name)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Vazgeç</AlertDialogCancel>
          <AlertDialogAction
            variant={action === "suspend" ? "destructive" : "default"}
            disabled={!action || pending}
            onClick={() => {
              if (action) onConfirm(action)
            }}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Icon />}
            {pending ? "Güncelleniyor" : copy?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DetailMetric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Building2
  label: string
  value: React.ReactNode
  detail: string
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span className="flex size-8 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-2 min-h-6 text-base font-semibold">{value}</div>
      <p className="mt-1 text-[0.7rem] text-muted-foreground">{detail}</p>
    </div>
  )
}

function IdentityRow({
  icon: Icon,
  label,
  value,
  mono = false,
  copyValue,
}: {
  icon: typeof Building2
  label: string
  value: string
  mono?: boolean
  copyValue?: string
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.68rem] font-medium text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            "mt-0.5 truncate text-sm font-semibold",
            mono && "font-mono text-xs",
          )}
          title={value}
        >
          {value}
        </p>
      </div>
      {copyValue ? (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`${label} değerini kopyala`}
          onClick={() => {
            void navigator.clipboard.writeText(copyValue)
            toast.success(`${label} panoya kopyalandı.`)
          }}
        >
          <Copy />
        </Button>
      ) : null}
    </div>
  )
}

function ContractFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.65rem] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-semibold" title={value}>
        {value}
      </p>
    </div>
  )
}

function formatBusinessType(value: string): string {
  const labels: Record<string, string> = {
    RESTAURANT: "Restoran",
    CAFE: "Kafe",
    BAR: "Bar",
    HOTEL: "Otel",
    BOUTIQUE_HOTEL: "Butik otel",
  }

  return (
    labels[value] ??
    value
      .toLocaleLowerCase("tr-TR")
      .replaceAll("_", " ")
      .replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase("tr-TR"))
  )
}

/** Browser-side temporary password suggestion (server still validates length). */
function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  const values = new Uint32Array(14)
  crypto.getRandomValues(values)
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("")
}
