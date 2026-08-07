"use client"

import { useQuery } from "@tanstack/react-query"
import {
  Braces,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  FileClock,
  FilterX,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react"
import { useMemo, useState } from "react"

import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { StatCard } from "@/components/shared/stat-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { formatDateTime } from "@/lib/formatters"
import { cn } from "@/lib/utils"

import { AdapterNotice } from "./adapter-notice"
import {
  getAuditLogFeed,
  secondaryAdminQueryKeys,
} from "./platform-admin-api"
import {
  EmptyDataState,
  QueryErrorState,
  SecondaryPageSkeleton,
} from "./query-state"
import type { AuditLogEntry } from "./types"

const PAGE_SIZE = 15

export function AuditLogExplorer() {
  const [search, setSearch] = useState("")
  const [actionFilter, setActionFilter] = useState("all")
  const [resourceFilter, setResourceFilter] = useState("all")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<AuditLogEntry | null>(null)

  const query = useQuery({
    queryKey: secondaryAdminQueryKeys.audit,
    queryFn: ({ signal }) => getAuditLogFeed(signal),
  })

  const actionOptions = useMemo(
    () =>
      uniqueSorted((query.data?.items ?? []).map((item) => item.action)),
    [query.data?.items],
  )
  const resourceOptions = useMemo(
    () =>
      uniqueSorted(
        (query.data?.items ?? []).map((item) => item.resource_type),
      ),
    [query.data?.items],
  )
  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("tr-TR")
    const fromTimestamp = fromDate
      ? new Date(`${fromDate}T00:00:00`).getTime()
      : null
    const toTimestamp = toDate
      ? new Date(`${toDate}T23:59:59.999`).getTime()
      : null

    return (query.data?.items ?? []).filter((entry) => {
      const timestamp = new Date(entry.timestamp).getTime()
      const searchable = [
        entry.action,
        entry.resource_type,
        entry.resource_id,
        entry.actor_role,
        entry.actor_user_id,
        entry.reason,
        safeStringify(entry.previous_value),
        safeStringify(entry.new_value),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr-TR")

      return (
        (normalizedSearch.length === 0 ||
          searchable.includes(normalizedSearch)) &&
        (actionFilter === "all" || entry.action === actionFilter) &&
        (resourceFilter === "all" ||
          entry.resource_type === resourceFilter) &&
        (fromTimestamp === null ||
          (Number.isFinite(timestamp) && timestamp >= fromTimestamp)) &&
        (toTimestamp === null ||
          (Number.isFinite(timestamp) && timestamp <= toTimestamp))
      )
    })
  }, [
    actionFilter,
    fromDate,
    query.data?.items,
    resourceFilter,
    search,
    toDate,
  ])

  if (query.isPending) {
    return <SecondaryPageSkeleton />
  }

  if (query.isError) {
    return (
      <>
        <PageHeader
          eyebrow="Dixora Platform"
          title="Denetim kayıtları"
          description="Kritik yönetim ve kaynak değişikliklerinin izlenebilir kaydı."
          icon={FileClock}
        />
        <QueryErrorState
          title="Denetim akışı alınamadı"
          description={
            query.error instanceof Error
              ? query.error.message
              : "Audit endpointi beklenmeyen bir hata döndürdü."
          }
          retry={() => void query.refetch()}
        />
      </>
    )
  }

  const feed = query.data
  const distinctActors = new Set(
    feed.items
      .map((entry) => entry.actor_user_id ?? entry.actor_role)
      .filter(Boolean),
  ).size
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const visibleEntries = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )
  const hasFilters =
    search.length > 0 ||
    actionFilter !== "all" ||
    resourceFilter !== "all" ||
    fromDate.length > 0 ||
    toDate.length > 0

  const clearFilters = () => {
    setSearch("")
    setActionFilter("all")
    setResourceFilter("all")
    setFromDate("")
    setToDate("")
    setPage(1)
  }

  return (
    <>
      <PageHeader
        eyebrow="Dixora Platform"
        title="Denetim kayıtları"
        description="Kullanıcı, eylem, kaynak ve zaman sinyallerini tek bir denetlenebilir akışta inceleyin."
        icon={FileClock}
        actions={
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className={cn(query.isFetching && "animate-spin")} />
            Akışı yenile
          </Button>
        }
      />

      <AdapterNotice
        title={
          feed.availability === "live"
            ? "Canlı audit penceresi"
            : "Platform audit scope endpointi bekleniyor"
        }
        badge={
          feed.availability === "live"
            ? "current-identity"
            : "compatibility-adapter"
        }
        tone={feed.availability === "live" ? "live" : "warning"}
        className="mb-5"
      >
        {feed.limitation}
      </AdapterNotice>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Yüklenen kayıt"
          value={feed.items.length}
          detail={`En fazla ${feed.maxRecords} canlı kayıt`}
          icon={FileClock}
          tone="brand"
        />
        <StatCard
          title="Eşleşen kayıt"
          value={filtered.length}
          detail={hasFilters ? "Aktif filtre sonucu" : "Filtre uygulanmadı"}
          icon={Search}
          tone="info"
        />
        <StatCard
          title="Aktör"
          value={distinctActors}
          detail="Kullanıcı veya rol kimliği"
          icon={CircleUserRound}
          tone="success"
        />
        <StatCard
          title="Kaynak tipi"
          value={resourceOptions.length}
          detail="Canlı pencere içinde"
          icon={Braces}
          tone="warning"
        />
      </div>

      <SectionCard
        title="Platform olay akışı"
        description="Filtreleme ve sayfalama, API'nin döndürdüğü son kayıt penceresi üzerinde uygulanır."
        contentClassName="p-0"
      >
        <div className="grid gap-3 border-b p-4 lg:grid-cols-[minmax(16rem,1fr)_13rem_12rem_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              disabled={feed.availability !== "live"}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
              className="pl-9"
              placeholder="Eylem, aktör, kaynak veya gerekçe ara"
              aria-label="Denetim kayıtlarında ara"
            />
          </div>
          <Select
            value={actionFilter}
            disabled={feed.availability !== "live"}
            onValueChange={(value) => {
              setActionFilter(value ?? "all")
              setPage(1)
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Eylem" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm eylemler</SelectItem>
              {actionOptions.map((action) => (
                <SelectItem key={action} value={action}>
                  {formatAction(action)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={resourceFilter}
            disabled={feed.availability !== "live"}
            onValueChange={(value) => {
              setResourceFilter(value ?? "all")
              setPage(1)
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Kaynak" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm kaynaklar</SelectItem>
              {resourceOptions.map((resource) => (
                <SelectItem key={resource} value={resource}>
                  {formatToken(resource)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={!hasFilters}
            onClick={clearFilters}
          >
            <FilterX />
            Temizle
          </Button>
        </div>

        <div className="grid gap-3 border-b bg-muted/20 px-4 py-3 sm:grid-cols-2">
          <DateFilter
            id="audit-from"
            label="Başlangıç tarihi"
            value={fromDate}
            disabled={feed.availability !== "live"}
            max={toDate || undefined}
            onChange={(value) => {
              setFromDate(value)
              setPage(1)
            }}
          />
          <DateFilter
            id="audit-to"
            label="Bitiş tarihi"
            value={toDate}
            disabled={feed.availability !== "live"}
            min={fromDate || undefined}
            onChange={(value) => {
              setToDate(value)
              setPage(1)
            }}
          />
        </div>

        {visibleEntries.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Zaman</TableHead>
                  <TableHead>Eylem</TableHead>
                  <TableHead>Aktör</TableHead>
                  <TableHead>Kaynak</TableHead>
                  <TableHead className="pr-4 text-right">İncele</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="pl-4">
                      <div className="min-w-36">
                        <p className="text-xs font-medium">
                          {formatDateTime(entry.timestamp, {
                            dateStyle: "medium",
                          })}
                        </p>
                        <p className="mt-0.5 text-[0.66rem] text-muted-foreground">
                          {formatDateTime(entry.timestamp, {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <ActionBadge action={entry.action} />
                    </TableCell>
                    <TableCell>
                      <div className="min-w-32">
                        <p className="text-xs font-semibold">
                          {formatToken(entry.actor_role ?? "system")}
                        </p>
                        <p
                          className="mt-0.5 max-w-40 truncate font-mono text-[0.62rem] text-muted-foreground"
                          title={entry.actor_user_id ?? "Sistem işlemi"}
                        >
                          {entry.actor_user_id ?? "Sistem işlemi"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="min-w-36">
                        <p className="text-xs font-medium">
                          {formatToken(entry.resource_type)}
                        </p>
                        <p
                          className="mt-0.5 max-w-44 truncate font-mono text-[0.62rem] text-muted-foreground"
                          title={entry.resource_id ?? "Kaynak kimliği yok"}
                        >
                          {entry.resource_id ?? "Kimlik yok"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelected(entry)}
                      >
                        Ayrıntı
                        <ChevronRight />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <AuditPagination
              currentPage={currentPage}
              totalPages={totalPages}
              firstIndex={(currentPage - 1) * PAGE_SIZE + 1}
              lastIndex={(currentPage - 1) * PAGE_SIZE + visibleEntries.length}
              totalCount={filtered.length}
              onPageChange={setPage}
            />
          </>
        ) : (
          <AuditEmptyState
            feedAvailable={feed.availability === "live"}
            hasRecords={feed.items.length > 0}
            hasFilters={hasFilters}
            onClearFilters={clearFilters}
          />
        )}
      </SectionCard>

      <AuditDetailDialog
        entry={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />
    </>
  )
}

function DateFilter({
  id,
  label,
  value,
  disabled,
  min,
  max,
  onChange,
}: {
  id: string
  label: string
  value: string
  disabled: boolean
  min?: string
  max?: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground ring-1 ring-border">
        <CalendarDays className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-[0.65rem] text-muted-foreground">
          {label}
        </Label>
        <Input
          id={id}
          type="date"
          value={value}
          disabled={disabled}
          min={min}
          max={max}
          className="mt-1 bg-background"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  )
}

function ActionBadge({ action }: { action: string }) {
  const mutating =
    action.includes("created") ||
    action.includes("updated") ||
    action.includes("deleted") ||
    action.includes("approved") ||
    action.includes("rejected")

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[0.64rem]",
        mutating
          ? "border-violet-600/20 bg-violet-500/[0.07] text-violet-700 dark:text-violet-300"
          : "bg-muted/60 text-muted-foreground",
      )}
    >
      {formatAction(action)}
    </Badge>
  )
}

function AuditPagination({
  currentPage,
  totalPages,
  firstIndex,
  lastIndex,
  totalCount,
  onPageChange,
}: {
  currentPage: number
  totalPages: number
  firstIndex: number
  lastIndex: number
  totalCount: number
  onPageChange: (page: number) => void
}) {
  return (
    <div className="flex flex-col gap-3 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>
        {firstIndex}–{lastIndex} / {totalCount} kayıt
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-label="Önceki sayfa"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <ChevronLeft />
          Önceki
        </Button>
        <span className="min-w-20 text-center tabular-nums">
          {currentPage} / {totalPages}
        </span>
        <Button
          size="sm"
          variant="outline"
          aria-label="Sonraki sayfa"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Sonraki
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}

function AuditEmptyState({
  feedAvailable,
  hasRecords,
  hasFilters,
  onClearFilters,
}: {
  feedAvailable: boolean
  hasRecords: boolean
  hasFilters: boolean
  onClearFilters: () => void
}) {
  if (!feedAvailable) {
    return (
      <div className="px-4 py-6">
        <div className="mx-auto max-w-2xl rounded-2xl border border-dashed bg-muted/20 p-6 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-700">
            <ShieldAlert className="size-5" />
          </span>
          <h3 className="mt-4 text-sm font-semibold">
            Platform kapsamı güvenli biçimde bekletiliyor
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Mevcut endpoint tenant bağlamı olmadan kayıt döndürmüyor. Tenant
            kimliği uydurulmadı ve audit verisi başka bir kaynaktan taklit
            edilmedi.
          </p>
          <div className="mt-4 grid gap-2 text-left text-xs sm:grid-cols-3">
            <ContractRequirement
              label="Scope"
              value="platform | tenant"
            />
            <ContractRequirement label="Cursor" value="offset / cursor" />
            <ContractRequirement
              label="Filtreler"
              value="action, resource, date"
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <EmptyDataState
      title={
        hasRecords
          ? "Filtrelerle eşleşen kayıt yok"
          : "Canlı pencerede denetim kaydı yok"
      }
      description={
        hasRecords
          ? "Arama, eylem, kaynak veya tarih aralığını değiştirerek yeniden deneyin."
          : "Yeni denetlenebilir işlemler gerçekleştiğinde kayıtlar burada görünecek."
      }
      action={
        hasFilters ? (
          <Button variant="outline" onClick={onClearFilters}>
            <FilterX />
            Filtreleri temizle
          </Button>
        ) : undefined
      }
    />
  )
}

function ContractRequirement({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl bg-background px-3 py-2.5 ring-1 ring-border">
      <p className="text-[0.62rem] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-[0.68rem] font-semibold">{value}</p>
    </div>
  )
}

function AuditDetailDialog({
  entry,
  onOpenChange,
}: {
  entry: AuditLogEntry | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Denetim kaydı ayrıntısı</DialogTitle>
          <DialogDescription>
            {entry
              ? `${formatAction(entry.action)} · ${formatDateTime(entry.timestamp)}`
              : "Seçili kayıt"}
          </DialogDescription>
        </DialogHeader>

        {entry ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <AuditFact label="Eylem" value={entry.action} mono />
              <AuditFact
                label="Aktör rolü"
                value={entry.actor_role ?? "system"}
              />
              <AuditFact
                label="Aktör kimliği"
                value={entry.actor_user_id ?? "Sistem işlemi"}
                mono
              />
              <AuditFact
                label="Şube kimliği"
                value={entry.branch_id ?? "Platform / şubesiz"}
                mono
              />
              <AuditFact label="Kaynak tipi" value={entry.resource_type} />
              <AuditFact
                label="Kaynak kimliği"
                value={entry.resource_id ?? "Kimlik yok"}
                mono
              />
            </div>

            {entry.reason ? (
              <div className="rounded-xl border bg-muted/25 p-3">
                <p className="text-[0.65rem] text-muted-foreground">Gerekçe</p>
                <p className="mt-1 text-xs leading-5">{entry.reason}</p>
              </div>
            ) : null}

            <div className="grid gap-3 lg:grid-cols-2">
              <JsonPanel title="Önceki değer" value={entry.previous_value} />
              <JsonPanel title="Yeni değer" value={entry.new_value} />
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function AuditFact({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="rounded-xl border px-3 py-2.5">
      <p className="text-[0.62rem] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 truncate text-xs font-semibold",
          mono && "font-mono text-[0.68rem]",
        )}
        title={value}
      >
        {value}
      </p>
    </div>
  )
}

function JsonPanel({
  title,
  value,
}: {
  title: string
  value: Record<string, unknown> | null
}) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex items-center gap-2 border-b bg-muted/35 px-3 py-2">
        <Braces className="size-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold">{title}</p>
      </div>
      {value ? (
        <pre className="max-h-64 overflow-auto p-3 font-mono text-[0.68rem] leading-5">
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : (
        <p className="p-3 text-xs text-muted-foreground">
          Bu alan için kayıtlı değer bulunmuyor.
        </p>
      )}
    </div>
  )
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "tr-TR"),
  )
}

function formatAction(action: string): string {
  return action
    .split(".")
    .map(formatToken)
    .join(" · ")
}

function formatToken(value: string): string {
  return value
    .replaceAll("_", " ")
    .toLocaleLowerCase("tr-TR")
    .replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase("tr-TR"))
}

function safeStringify(value: unknown): string {
  try {
    return value ? JSON.stringify(value) : ""
  } catch {
    return ""
  }
}
