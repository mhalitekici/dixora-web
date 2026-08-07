"use client"

import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Database,
  Gauge,
  HeartPulse,
  Printer,
  RefreshCw,
  Server,
  TriangleAlert,
  WifiOff,
  Zap,
} from "lucide-react"

import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { StatusBadge } from "@/components/shared/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatDateTime, formatRelativeTime } from "@/lib/formatters"
import { cn } from "@/lib/utils"

import { AdapterNotice } from "./adapter-notice"
import {
  getSystemHealth,
  secondaryAdminQueryKeys,
} from "./platform-admin-api"
import {
  QueryErrorState,
  SecondaryPageSkeleton,
} from "./query-state"
import type {
  ServiceHealthState,
  SystemServiceHealth,
} from "./types"

const serviceIcons = {
  api: Server,
  postgresql: Database,
  redis: Zap,
  "print-bridge": Printer,
} as const

const healthPresentation: Record<
  ServiceHealthState,
  {
    label: string
    tone: "success" | "warning" | "danger" | "neutral"
    icon: typeof CheckCircle2
    iconClassName: string
    surfaceClassName: string
  }
> = {
  healthy: {
    label: "Sağlıklı",
    tone: "success",
    icon: CheckCircle2,
    iconClassName: "text-emerald-700 dark:text-emerald-300",
    surfaceClassName: "bg-emerald-500/10",
  },
  degraded: {
    label: "Kısıtlı",
    tone: "warning",
    icon: TriangleAlert,
    iconClassName: "text-amber-700 dark:text-amber-300",
    surfaceClassName: "bg-amber-500/10",
  },
  offline: {
    label: "Çevrimdışı",
    tone: "danger",
    icon: WifiOff,
    iconClassName: "text-destructive",
    surfaceClassName: "bg-destructive/10",
  },
  unknown: {
    label: "Bilinmiyor",
    tone: "neutral",
    icon: CircleHelp,
    iconClassName: "text-muted-foreground",
    surfaceClassName: "bg-muted",
  },
}

export function SystemHealth() {
  const query = useQuery({
    queryKey: secondaryAdminQueryKeys.system,
    queryFn: ({ signal }) => getSystemHealth(signal),
    refetchInterval: 30_000,
    retry: 1,
  })

  if (query.isPending) {
    return <SecondaryPageSkeleton />
  }

  if (query.isError) {
    return (
      <>
        <PageHeader
          eyebrow="Dixora Platform"
          title="Sistem sağlığı"
          description="Platform servislerinin canlı sağlık sinyalleri."
          icon={HeartPulse}
        />
        <QueryErrorState
          title="Sağlık sinyalleri alınamadı"
          description={
            query.error instanceof Error
              ? query.error.message
              : "Yetki kontrollü sistem sağlık adapteri yanıt vermedi."
          }
          retry={() => void query.refetch()}
        />
      </>
    )
  }

  const { services, checkedAt, adapter } = query.data
  const counts = services.reduce(
    (totals, service) => {
      totals[service.state] += 1
      return totals
    },
    { healthy: 0, degraded: 0, offline: 0, unknown: 0 },
  )
  const overallState: ServiceHealthState =
    counts.offline > 0
      ? "offline"
      : counts.degraded > 0
        ? "degraded"
        : counts.unknown > 0
          ? "unknown"
          : "healthy"
  const overall = healthPresentation[overallState]

  return (
    <>
      <PageHeader
        eyebrow="Dixora Platform"
        title="Sistem sağlığı"
        description="API, PostgreSQL, Redis ve Print Bridge servislerini sunucu tarafındaki canlı sağlık problarıyla izleyin."
        icon={HeartPulse}
        actions={
          <>
            <StatusBadge
              tone={overall.tone}
              pulse={overallState === "healthy"}
              className="h-8 rounded-lg px-3"
            >
              {overallState === "healthy"
                ? "Tüm problar sağlıklı"
                : `${counts.offline + counts.degraded + counts.unknown} servis dikkat istiyor`}
            </StatusBadge>
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw className={cn(query.isFetching && "animate-spin")} />
              Şimdi kontrol et
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {services.map((service) => (
          <ServiceHealthCard key={service.id} service={service} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(19rem,0.75fr)]">
        <SectionCard
          title="Prob özeti"
          description="Aynı BFF isteğinde paralel çalışan servis kontrolleri."
          contentClassName="grid gap-3 sm:grid-cols-2"
          action={
            <Badge variant="outline" className="gap-1.5">
              <Activity className="size-3" />
              30 sn otomatik yenileme
            </Badge>
          }
        >
          <SummaryTile
            icon={CheckCircle2}
            label="Sağlıklı"
            value={counts.healthy}
            className="bg-emerald-500/[0.07] text-emerald-800 dark:text-emerald-200"
          />
          <SummaryTile
            icon={TriangleAlert}
            label="Kısıtlı"
            value={counts.degraded}
            className="bg-amber-500/[0.08] text-amber-800 dark:text-amber-200"
          />
          <SummaryTile
            icon={WifiOff}
            label="Çevrimdışı"
            value={counts.offline}
            className="bg-destructive/[0.07] text-destructive"
          />
          <SummaryTile
            icon={Clock3}
            label="Son kontrol"
            value={formatRelativeTime(checkedAt)}
            className="bg-muted text-foreground"
            compact
          />
        </SectionCard>

        <SectionCard
          title="Ölçüm kapsamı"
          description="Her durumun hangi canlı sinyalden üretildiği."
          contentClassName="space-y-3"
        >
          <AdapterNotice
            title="Canlı BFF probları"
            badge={adapter.source}
            tone="live"
          >
            Sağlık yanıtı sunucuda oluşturulur; servis kimlik bilgileri tarayıcıya
            aktarılmaz.
          </AdapterNotice>
          <ul className="space-y-2">
            {adapter.limitations.map((limitation) => (
              <li
                key={limitation}
                className="flex gap-2 text-xs leading-5 text-muted-foreground"
              >
                <span
                  aria-hidden="true"
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-brand"
                />
                {limitation}
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </>
  )
}

function ServiceHealthCard({
  service,
}: {
  service: SystemServiceHealth
}) {
  const Icon = serviceIcons[service.id]
  const presentation = healthPresentation[service.state]
  const StateIcon = presentation.icon

  return (
    <Card className="gap-3">
      <CardHeader className="flex-row items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <Icon className="size-5" />
          </span>
          <div>
            <CardTitle>{service.name}</CardTitle>
            <p className="mt-0.5 font-mono text-[0.64rem] text-muted-foreground">
              {service.endpointLabel}
            </p>
          </div>
        </div>
        <StatusBadge
          tone={presentation.tone}
          pulse={service.state === "healthy"}
        >
          {presentation.label}
        </StatusBadge>
      </CardHeader>

      <CardContent>
        <div
          className={cn(
            "flex items-start gap-3 rounded-xl p-3",
            presentation.surfaceClassName,
          )}
        >
          <StateIcon
            className={cn(
              "mt-0.5 size-4 shrink-0",
              presentation.iconClassName,
            )}
          />
          <div>
            <p className="text-xs font-semibold">{service.summary}</p>
            <p className="mt-1 text-[0.7rem] leading-5 text-muted-foreground">
              {service.detail}
            </p>
          </div>
        </div>

        {service.metadata ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {visibleMetadata(service).map(([label, value]) => (
              <div key={label} className="rounded-lg border px-2.5 py-2">
                <p className="text-[0.6rem] text-muted-foreground">{label}</p>
                <p
                  className="mt-0.5 truncate text-xs font-semibold tabular-nums"
                  title={String(value)}
                >
                  {formatMetadataValue(value)}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="justify-between gap-3 text-[0.68rem] text-muted-foreground">
        <span>
          {service.latencyMs === null
            ? "Gecikme ölçülmedi"
            : `${service.latencyMs} ms`}
        </span>
        <span title={formatDateTime(service.observedAt)}>
          {formatRelativeTime(service.observedAt)}
        </span>
      </CardFooter>
    </Card>
  )
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  className,
  compact = false,
}: {
  icon: typeof Gauge
  label: string
  value: number | string
  className: string
  compact?: boolean
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-xl p-3", className)}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background/60">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[0.66rem] opacity-70">{label}</p>
        <p
          className={cn(
            "mt-0.5 truncate font-semibold tabular-nums",
            compact ? "text-sm" : "text-xl",
          )}
        >
          {value}
        </p>
      </div>
    </div>
  )
}

function visibleMetadata(
  service: SystemServiceHealth,
): Array<[string, string | number | boolean]> {
  if (!service.metadata) return []

  const labels: Record<string, string> = {
    bridgeId: "Köprü kimliği",
    processedJobs: "İşlenen iş",
    failedJobs: "Hatalı iş",
    lastSuccessfulPollAt: "Son başarılı poll",
    httpStatus: "HTTP",
    database: "DB ping",
    service: "Servis",
  }

  return Object.entries(service.metadata)
    .filter((entry): entry is [string, string | number | boolean] => {
      const value = entry[1]
      return value !== null && value !== ""
    })
    .slice(0, 4)
    .map(([key, value]) => [labels[key] ?? key, value])
}

function formatMetadataValue(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "Başarılı" : "Başarısız"
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value)
  ) {
    return formatRelativeTime(value)
  }
  return String(value)
}
