"use client"

import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight,
  Building2,
  CalendarClock,
  CreditCard,
  Layers3,
  RefreshCw,
  Search,
  Store,
  UsersRound,
} from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"

import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { StatCard } from "@/components/shared/stat-card"
import { StatusBadge } from "@/components/shared/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { formatMoney } from "@/lib/formatters"
import { cn } from "@/lib/utils"

import { AdapterNotice } from "./adapter-notice"
import {
  getSubscriptionPortfolio,
  secondaryAdminQueryKeys,
} from "./platform-admin-api"
import {
  EmptyDataState,
  QueryErrorState,
  SecondaryPageSkeleton,
} from "./query-state"
import type {
  SubscriptionPlan,
  TenantState,
  TenantSubscriptionRow,
} from "./types"

const TENANTS_PER_PAGE = 10

const tenantStatePresentation: Record<
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

export function SubscriptionsOverview() {
  const [search, setSearch] = useState("")
  const [stateFilter, setStateFilter] = useState<TenantState | "all">("all")
  const [page, setPage] = useState(1)

  const query = useQuery({
    queryKey: secondaryAdminQueryKeys.subscriptions,
    queryFn: ({ signal }) => getSubscriptionPortfolio(signal),
  })

  const filteredTenants = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("tr-TR")
    return (query.data?.businesses ?? []).filter(({ business, plan, status }) => {
      const text = `${business.name} ${business.slug} ${business.business_type} ${plan.name} ${plan.code}`
        .toLocaleLowerCase("tr-TR")
      const matchesSearch =
        normalizedSearch.length === 0 || text.includes(normalizedSearch)
      const matchesState = stateFilter === "all" || status === stateFilter
      return matchesSearch && matchesState
    })
  }, [query.data?.businesses, search, stateFilter])

  if (query.isPending) {
    return <SecondaryPageSkeleton />
  }

  if (query.isError) {
    return (
      <>
        <PageHeader
          eyebrow="Dixora Platform"
          title="Abonelikler"
          description="Plan kataloğu ve tenant abonelikleri API üzerinden yönetilir."
          icon={CreditCard}
        />
        <QueryErrorState
          title="Abonelik verileri alınamadı"
          description={
            query.error instanceof Error
              ? query.error.message
              : "Plan ve işletme verileri alınırken beklenmeyen bir hata oluştu."
          }
          retry={() => void query.refetch()}
        />
      </>
    )
  }

  const { businesses, plans, issues } = query.data
  const activePlans = plans.filter((plan) => plan.is_active)
  const prices = activePlans
    .map((plan) => Number(plan.monthly_price))
    .filter(Number.isFinite)
  const activeTenants = businesses.filter(
    ({ status, business }) => status === "ACTIVE" && business.is_active,
  ).length
  const trialTenants = businesses.filter(
    ({ status }) => status === "TRIAL",
  ).length
  const totalPages = Math.max(
    1,
    Math.ceil(filteredTenants.length / TENANTS_PER_PAGE),
  )
  const currentPage = Math.min(page, totalPages)
  const visibleTenants = filteredTenants.slice(
    (currentPage - 1) * TENANTS_PER_PAGE,
    currentPage * TENANTS_PER_PAGE,
  )

  return (
    <>
      <PageHeader
        eyebrow="Dixora Platform"
        title="Abonelik portföyü"
        description="Canlı plan kataloğunu ve işletmelere atanmış gerçek abonelik kayıtlarını tek görünümde takip edin."
        icon={CreditCard}
        actions={
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className={cn(query.isFetching && "animate-spin")} />
            Veriyi yenile
          </Button>
        }
      />

      <AdapterNotice
        title="Canlı abonelik verisi"
        badge="subscription-api"
        tone="live"
        className="mb-5"
      >
        Plan kataloğu <code>/subscriptions/plans</code>, tenant-plan eşleşmeleri
        ise <code>/subscriptions/portfolio</code> endpointinden gelir. Plan,
        başlangıç ve bitiş tarihleri tahmin edilmeden gösterilir.
      </AdapterNotice>

      {issues.map((issue) => (
        <AdapterNotice
          key={issue}
          title="Kısmi veri"
          tone="warning"
          className="mb-3"
        >
          {issue}
        </AdapterNotice>
      ))}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Aktif plan"
          value={activePlans.length}
          detail={`${plans.length} katalog kaydı`}
          icon={Layers3}
          tone="brand"
        />
        <StatCard
          title="Aylık fiyat aralığı"
          value={formatPriceRange(prices, activePlans[0]?.currency)}
          detail="Canlı plan kataloğu"
          icon={CreditCard}
          tone="info"
        />
        <StatCard
          title="Aktif tenant"
          value={activeTenants}
          detail={`${businesses.length} işletme içinde`}
          icon={Building2}
          tone="success"
        />
        <StatCard
          title="Deneme süreci"
          value={trialTenants}
          detail="Canlı abonelik kayıtları"
          icon={CalendarClock}
          tone="warning"
        />
      </div>

      <Tabs defaultValue="tenants">
        <TabsList className="mb-4">
          <TabsTrigger value="tenants">
            <Building2 />
            Tenantlar
            <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[0.62rem]">
              {businesses.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="plans">
            <Layers3 />
            Plan kataloğu
            <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[0.62rem]">
              {plans.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tenants">
          <SectionCard
            title="Tenant abonelik görünümü"
            description="Atanmış planı, abonelik durumunu ve geçerlilik tarihlerini canlı kayıtlardan izleyin."
            contentClassName="p-0"
          >
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setPage(1)
                  }}
                  className="pl-9"
                  placeholder="İşletme adı, kodu veya tipi ara"
                  aria-label="Tenant ara"
                />
              </div>
              <Select
                value={stateFilter}
                onValueChange={(value) => {
                  setStateFilter((value ?? "all") as TenantState | "all")
                  setPage(1)
                }}
              >
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Durum seçin" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tüm durumlar</SelectItem>
                  <SelectItem value="ACTIVE">Aktif</SelectItem>
                  <SelectItem value="TRIAL">Deneme</SelectItem>
                  <SelectItem value="PAST_DUE">Ödeme gecikmiş</SelectItem>
                  <SelectItem value="SUSPENDED">Askıda</SelectItem>
                  <SelectItem value="CANCELLED">İptal</SelectItem>
                  <SelectItem value="ARCHIVED">Arşivlendi</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {visibleTenants.length > 0 ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">İşletme</TableHead>
                      <TableHead>Abonelik durumu</TableHead>
                      <TableHead>Atanmış plan</TableHead>
                      <TableHead>Veri kaynağı</TableHead>
                      <TableHead className="pr-4 text-right">
                        Ayrıntı
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleTenants.map((row) => (
                      <TenantSubscriptionTableRow
                        key={row.business.id}
                        row={row}
                      />
                    ))}
                  </TableBody>
                </Table>
                <PaginationFooter
                  currentPage={currentPage}
                  totalPages={totalPages}
                  visibleCount={visibleTenants.length}
                  totalCount={filteredTenants.length}
                  onPageChange={setPage}
                />
              </>
            ) : (
              <EmptyDataState
                title={
                  businesses.length === 0
                    ? "Henüz tenant bulunmuyor"
                    : "Filtrelerle eşleşen tenant yok"
                }
                description={
                  businesses.length === 0
                    ? "İşletmeye abonelik atandığında kayıt bu listede otomatik görünür."
                    : "Arama metnini veya durum filtresini değiştirerek yeniden deneyin."
                }
                action={
                  businesses.length === 0 ? (
                    <Link
                      href="/super-admin/businesses?create=1"
                      className={buttonVariants({ variant: "default" })}
                    >
                      <Building2 />
                      İşletme oluştur
                    </Link>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSearch("")
                        setStateFilter("all")
                        setPage(1)
                      }}
                    >
                      Filtreleri temizle
                    </Button>
                  )
                }
              />
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="plans">
          {plans.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {plans.map((plan) => (
                <PlanCard key={plan.id} plan={plan} />
              ))}
            </div>
          ) : (
            <Card>
              <EmptyDataState
                title="Aktif plan kaydı bulunamadı"
                description="Plan kataloğu endpointi boş yanıt verdi. Yeni plan oluşturma işlemi mevcut API sözleşmesinde destekleniyor ancak bu görünüm salt-okunurdur."
              />
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </>
  )
}

function TenantSubscriptionTableRow({
  row,
}: {
  row: TenantSubscriptionRow
}) {
  const state = tenantStatePresentation[row.status]

  return (
    <TableRow>
      <TableCell className="pl-4">
        <div className="flex min-w-56 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <Building2 className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {row.business.name}
            </p>
            <p className="mt-0.5 truncate font-mono text-[0.68rem] text-muted-foreground">
              {row.business.slug}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
      </TableCell>
      <TableCell>
        <p className="text-xs font-semibold">{row.plan.name}</p>
        <p className="mt-0.5 font-mono text-[0.65rem] text-muted-foreground">
          {row.plan.code}
        </p>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="bg-emerald-500/[0.06] text-emerald-700">
          Canlı abonelik
        </Badge>
        <p className="mt-1 text-[0.65rem] text-muted-foreground">
          {formatSubscriptionPeriod(row.starts_at, row.ends_at)}
        </p>
      </TableCell>
      <TableCell className="pr-4 text-right">
        <Link
          href={`/super-admin/businesses/${row.business.id}`}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Aç
          <ArrowRight />
        </Link>
      </TableCell>
    </TableRow>
  )
}

function formatSubscriptionPeriod(startsAt: string, endsAt: string | null): string {
  const formatter = new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
  const start = formatter.format(new Date(startsAt))
  return endsAt ? `${start} – ${formatter.format(new Date(endsAt))}` : `${start} – devam ediyor`
}

function PlanCard({ plan }: { plan: SubscriptionPlan }) {
  return (
    <Card className="relative">
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold">{plan.name}</p>
            <Badge variant="outline" className="font-mono text-[0.62rem]">
              {plan.code}
            </Badge>
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
            {formatMoney(plan.monthly_price, plan.currency)}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              / ay
            </span>
          </p>
        </div>
        <StatusBadge tone={plan.is_active ? "success" : "neutral"}>
          {plan.is_active ? "Aktif" : "Pasif"}
        </StatusBadge>
      </CardHeader>
      <CardContent className="space-y-2">
        <PlanLimit
          icon={Store}
          label="Şube limiti"
          value={plan.max_branches === null ? "Sınırsız" : plan.max_branches}
        />
        <PlanLimit
          icon={UsersRound}
          label="Kullanıcı limiti"
          value={plan.max_users === null ? "Sınırsız" : plan.max_users}
        />
        <p className="pt-2 text-[0.68rem] leading-5 text-muted-foreground">
          Özellik matrisi mevcut plan listeleme yanıtında yer almıyor; kapasite
          veya özellik tahmini yapılmadı.
        </p>
      </CardContent>
    </Card>
  )
}

function PlanLimit({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Store
  label: string
  value: string | number
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2.5">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </span>
      <span className="text-xs font-semibold tabular-nums">{value}</span>
    </div>
  )
}

function PaginationFooter({
  currentPage,
  totalPages,
  visibleCount,
  totalCount,
  onPageChange,
}: {
  currentPage: number
  totalPages: number
  visibleCount: number
  totalCount: number
  onPageChange: (page: number) => void
}) {
  return (
    <div className="flex flex-col gap-3 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>
        {totalCount} kayıttan {visibleCount} tanesi gösteriliyor
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Önceki
        </Button>
        <span className="min-w-20 text-center tabular-nums">
          {currentPage} / {totalPages}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Sonraki
        </Button>
      </div>
    </div>
  )
}

function formatPriceRange(
  prices: number[],
  currency = "TRY",
): string {
  if (prices.length === 0) return "Veri yok"
  const minimum = Math.min(...prices)
  const maximum = Math.max(...prices)
  if (minimum === maximum) return formatMoney(minimum, currency)
  return `${formatCompactMoney(minimum, currency)} – ${formatCompactMoney(maximum, currency)}`
}

function formatCompactMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    notation: value >= 10_000 ? "compact" : "standard",
  }).format(value)
}
