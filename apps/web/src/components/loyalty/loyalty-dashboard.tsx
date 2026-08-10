"use client"

import {
  Gift,
  HeartHandshake,
  ScanLine,
  Sparkles,
  UserPlus,
  UsersRound,
} from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"
import { toast } from "sonner"

import { ErrorState, LoadingState, number } from "@/components/admin/admin-utils"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toErrorMessage } from "@/lib/api/errors"

import { LoyaltyEnrollmentDialog } from "./loyalty-enrollment-dialog"

import {
  useLoyaltyCustomers,
  useLoyaltyProgram,
  useLoyaltyRewards,
  useLoyaltySetupOptions,
  useUpdateLoyaltyProgram,
} from "./loyalty-hooks"
import { LoyaltyProgramForm } from "./loyalty-program-form"
import type { LoyaltyAdminReward, LoyaltyCustomer, LoyaltyProgram } from "./types"

export function LoyaltyDashboard() {
  const programQuery = useLoyaltyProgram()
  const setupQuery = useLoyaltySetupOptions()
  const customersQuery = useLoyaltyCustomers()
  const [enrollOpen, setEnrollOpen] = useState(false)
  const rewardsQuery = useLoyaltyRewards()
  const mutation = useUpdateLoyaltyProgram()

  if (programQuery.isLoading || setupQuery.isLoading) {
    return <LoadingState label="Sadakat programı yükleniyor…" />
  }
  const error = programQuery.error ?? setupQuery.error
  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void programQuery.refetch()
          void setupQuery.refetch()
        }}
      />
    )
  }

  const program = programQuery.data ?? null
  const options = setupQuery.data
  if (!options) return null

  return (
    <>
      <PageHeader
        eyebrow="Müşteri ilişkileri"
        title="Sadakat programı"
        description="Müdavimlerinizi anlaşılır bir ödül yolculuğuyla karşılayın; ilerlemeyi ve kullanımları tek ekrandan izleyin."
        icon={HeartHandshake}
      />

      <ProgramPulse program={program} />

      <Tabs defaultValue="program">
        <TabsList className="mb-5 h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl bg-muted/70 p-1 sm:w-auto">
          <TabsTrigger value="program">Programı düzenle</TabsTrigger>
          <TabsTrigger value="customers">Müşteriler</TabsTrigger>
          <TabsTrigger value="rewards">Ödül hareketleri</TabsTrigger>
        </TabsList>
        <TabsContent value="program">
          <LoyaltyProgramForm
            key={program ? `${program.id}:${program.version}` : "new-loyalty-program"}
            program={program}
            options={options}
            pending={mutation.isPending}
            onSubmit={(input) =>
              mutation.mutate(input, {
                onSuccess: () => toast.success("Sadakat programı kaydedildi."),
                onError: (mutationError) => toast.error(toErrorMessage(mutationError)),
              })
            }
          />
        </TabsContent>
        <TabsContent value="customers">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-card p-3">
            <p className="text-xs text-muted-foreground">
              Müşteriler kasada kaydedilir: bilgileri girin, e-postasına gelen kodu
              doğrulayın, üyelik kartı kendisine gönderilsin.
            </p>
            <Button size="sm" onClick={() => setEnrollOpen(true)}>
              <UserPlus className="size-4" />
              Yeni müşteri kaydet
            </Button>
          </div>
          <CustomerTable
            loading={customersQuery.isLoading}
            error={customersQuery.error}
            customers={customersQuery.data ?? []}
            onRetry={() => void customersQuery.refetch()}
          />
        </TabsContent>
        <TabsContent value="rewards">
          <RewardTable
            loading={rewardsQuery.isLoading}
            error={rewardsQuery.error}
            rewards={rewardsQuery.data ?? []}
            onRetry={() => void rewardsQuery.refetch()}
          />
        </TabsContent>
      </Tabs>
      <LoyaltyEnrollmentDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        onEnrolled={() => void customersQuery.refetch()}
      />
    </>
  )
}

function ProgramPulse({ program }: { program: LoyaltyProgram | null }) {
  return (
    <section className="mb-6 overflow-hidden rounded-3xl border bg-card shadow-sm" aria-label="Program özeti">
      <div className="grid lg:grid-cols-[minmax(17rem,0.85fr)_minmax(0,1.35fr)]">
        <div className="relative overflow-hidden bg-[#292524] p-5 text-stone-50 sm:p-6">
          <div className="absolute -right-6 -top-8 size-28 rounded-full border-[18px] border-brand/20" aria-hidden="true" />
          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-xs font-semibold">
              <span className={`size-2 rounded-full ${program?.is_active ? "bg-emerald-400" : "bg-amber-400"}`} />
              {program?.is_active ? "Program yayında" : "Program taslakta"}
            </span>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-orange-300">
              Müdavim bileti
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">
              {program?.name ?? "İlk programınızı kurun"}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-stone-300">
              {program
                ? program.show_on_qr
                  ? "Müşteriler QR menüden katılabilir ve ödül yolculuğunu takip edebilir."
                  : "Program kayıtlı; QR menü görünürlüğü henüz kapalı."
                : "Kazanma kuralını, ödülü ve geçerli şubeleri dört kısa adımda belirleyin."}
            </p>
          </div>
        </div>

        <dl className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <PulseMetric
            icon={UsersRound}
            label="Aktif müşteri"
            value={number(program?.stats.active_customers ?? 0)}
            detail="Onaylı üyelik"
            tone="sage"
          />
          <PulseMetric
            icon={Gift}
            label="Hazır ödül"
            value={number(program?.stats.available_rewards ?? 0)}
            detail="Cüzdanlarda bekliyor"
            tone="orange"
          />
          <PulseMetric
            icon={ScanLine}
            label="Kullanılan"
            value={number(program?.stats.redeemed_rewards ?? 0)}
            detail="Kayıtlı kullanım"
            tone="amber"
          />
        </dl>
      </div>
    </section>
  )
}

function PulseMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Sparkles
  label: string
  value: string
  detail: string
  tone: "sage" | "orange" | "amber"
}) {
  const toneClass = {
    sage: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    orange: "bg-brand-soft text-brand",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  }[tone]
  return (
    <div className="flex items-center gap-4 p-5 sm:block sm:p-6">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${toneClass}`}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 sm:mt-5">
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</dd>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function CustomerTable({
  loading,
  error,
  customers,
  onRetry,
}: {
  loading: boolean
  error: Error | null
  customers: LoyaltyCustomer[]
  onRetry: () => void
}) {
  if (loading) return <LoadingState label="Sadakat müşterileri yükleniyor…" />
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (!customers.length) {
    return (
      <EmptyState
        title="Henüz sadakat müşterisi yok"
        description="Program QR menüde açıldığında onaylı katılımlar burada görünür."
        icon={UsersRound}
      />
    )
  }
  return (
    <LedgerShell
      eyebrow="Üye defteri"
      title={`${number(customers.length)} kayıtlı müşteri`}
      description="İletişim bilgileri gizlenmiş olarak gösterilir; ilerleme yalnızca uygun ve ödenmiş siparişlerden oluşur."
    >
      <div className="space-y-0 divide-y md:hidden">
        {customers.map((customer) => (
          <article key={customer.membership_code} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs font-semibold">{customer.membership_code}</p>
                <p className="mt-1 text-sm font-medium">{customer.display_name}</p>
                <p className="text-xs text-muted-foreground">{customer.contact_masked}</p>
              </div>
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                {customer.progress} ilerleme
              </span>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
              <span>{customer.available_rewards} hazır ödül</span>
              <time dateTime={customer.joined_at}>{formatDate(customer.joined_at)}</time>
            </div>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Üye kodu</TableHead>
              <TableHead>Müşteri</TableHead>
              <TableHead>İlerleme</TableHead>
              <TableHead>Hazır ödül</TableHead>
              <TableHead>Katılım</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((customer) => (
              <TableRow key={customer.membership_code}>
                <TableCell className="font-mono text-xs font-semibold">{customer.membership_code}</TableCell>
                <TableCell>
                  <span className="font-medium">{customer.display_name}</span>
                  <span className="block text-xs text-muted-foreground">{customer.contact_masked}</span>
                </TableCell>
                <TableCell className="font-medium tabular-nums">{customer.progress}</TableCell>
                <TableCell className="tabular-nums">{customer.available_rewards}</TableCell>
                <TableCell><time dateTime={customer.joined_at}>{formatDate(customer.joined_at)}</time></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </LedgerShell>
  )
}

function RewardTable({
  loading,
  error,
  rewards,
  onRetry,
}: {
  loading: boolean
  error: Error | null
  rewards: LoyaltyAdminReward[]
  onRetry: () => void
}) {
  if (loading) return <LoadingState label="Sadakat ödülleri yükleniyor…" />
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (!rewards.length) {
    return (
      <EmptyState
        title="Henüz ödül kazanılmadı"
        description="Yalnızca ödenmiş ve uygun siparişlerin ürettiği ödüller burada görünür."
        icon={Gift}
      />
    )
  }
  return (
    <LedgerShell
      eyebrow="Ödül hareketleri"
      title={`${number(rewards.length)} ödül kaydı`}
      description="Her ödül benzersiz kodu ve kullanım geçmişiyle izlenir."
    >
      <div className="divide-y md:hidden">
        {rewards.map((reward) => (
          <article key={reward.redemption_code} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs font-semibold">{reward.redemption_code}</p>
                <p className="mt-1 font-mono text-[0.7rem] text-muted-foreground">Üye {reward.membership_code}</p>
              </div>
              <RewardStatus status={reward.status} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
              <p><span className="block font-medium text-foreground">Kazanım</span>{formatDate(reward.issued_at)}</p>
              <p><span className="block font-medium text-foreground">Kullanım</span>{reward.redeemed_at ? formatDate(reward.redeemed_at) : "—"}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ödül kodu</TableHead>
              <TableHead>Üye</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead>Kazanım</TableHead>
              <TableHead>Kullanım</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rewards.map((reward) => (
              <TableRow key={reward.redemption_code}>
                <TableCell className="font-mono text-xs font-semibold">{reward.redemption_code}</TableCell>
                <TableCell className="font-mono text-xs">{reward.membership_code}</TableCell>
                <TableCell><RewardStatus status={reward.status} /></TableCell>
                <TableCell><time dateTime={reward.issued_at}>{formatDate(reward.issued_at)}</time></TableCell>
                <TableCell>{reward.redeemed_at ? <time dateTime={reward.redeemed_at}>{formatDate(reward.redeemed_at)}</time> : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </LedgerShell>
  )
}

function LedgerShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-3xl border bg-card">
      <header className="border-b bg-[#fbf8f2] p-4 dark:bg-muted/30 sm:p-5">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-brand">{eyebrow}</p>
        <h2 className="mt-1 text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  )
}

function RewardStatus({ status }: { status: LoyaltyAdminReward["status"] }) {
  return (
    <StatusBadge tone={status === "AVAILABLE" ? "success" : status === "REDEEMED" ? "info" : "neutral"}>
      {status === "AVAILABLE" ? "Kullanılabilir" : status === "REDEEMED" ? "Kullanıldı" : "Geri alındı"}
    </StatusBadge>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
