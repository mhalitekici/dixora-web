"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  FileClock,
  Filter,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { adminApi, adminKeys } from "./admin-api";
import {
  AdapterNotice,
  dateTime,
  ErrorState,
  LoadingState,
  number,
  shortId,
} from "./admin-utils";
import type { AuditLog } from "./types";

const PAGE_SIZE = 25;

export function AuditLogViewer() {
  const [serverAction, setServerAction] = useState("ALL");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("ALL");
  const [resourceType, setResourceType] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const query = useQuery({
    queryKey: adminKeys.audit(serverAction, 250),
    queryFn: ({ signal }) =>
      adminApi.auditLogs(serverAction === "ALL" ? "" : serverAction, 250, signal),
  });

  const logs = useMemo(() => query.data ?? [], [query.data]);
  const actions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.action))).sort(),
    [logs],
  );
  const roles = useMemo(
    () =>
      Array.from(new Set(logs.map((log) => log.actor_role).filter(Boolean) as string[])).sort(),
    [logs],
  );
  const resourceTypes = useMemo(
    () => Array.from(new Set(logs.map((log) => log.resource_type))).sort(),
    [logs],
  );
  const filtered = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("tr-TR");
    const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
    return logs.filter((log) => {
      if (role !== "ALL" && log.actor_role !== role) return false;
      if (resourceType !== "ALL" && log.resource_type !== resourceType) return false;
      const timestamp = new Date(log.timestamp).getTime();
      if (fromTime !== null && timestamp < fromTime) return false;
      if (toTime !== null && timestamp > toTime) return false;
      if (!normalized) return true;
      return [
        log.action,
        log.resource_type,
        log.resource_id ?? "",
        log.actor_role ?? "",
        log.actor_user_id ?? "",
        log.reason ?? "",
      ].some((value) => value.toLocaleLowerCase("tr-TR").includes(normalized));
    });
  }, [dateFrom, dateTo, logs, resourceType, role, search]);

  if (query.isLoading) return <LoadingState label="Denetim kayıtları yükleniyor…" />;
  if (query.error) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const today = new Date().toDateString();
  const todayCount = logs.filter((log) => new Date(log.timestamp).toDateString() === today).length;
  const actorCount = new Set(logs.map((log) => log.actor_user_id).filter(Boolean)).size;

  const resetPage = () => setPage(0);

  return (
    <>
      <PageHeader
        eyebrow="İzlenebilirlik"
        title="Denetim kayıtları"
        description="Kim, ne zaman, hangi kaynak üzerinde ne değiştirdi sorusunu güvenli ve filtrelenebilir biçimde inceleyin."
        icon={FileClock}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Yüklenen kayıt"
          value={number(logs.length)}
          detail="Backend üst sınırı 250"
          icon={FileClock}
          tone="info"
        />
        <StatCard
          title="Bugünkü hareket"
          value={number(todayCount)}
          detail="Yerel gün hesabı"
          icon={Clock3}
          tone="brand"
        />
        <StatCard
          title="Aktör"
          value={number(actorCount)}
          detail="Benzersiz kullanıcı kimliği"
          icon={UserRound}
          tone="success"
        />
        <StatCard
          title="Aksiyon çeşidi"
          value={number(actions.length)}
          detail="Yüklenen kümede"
          icon={ShieldCheck}
          tone="warning"
        />
      </div>

      <AdapterNotice className="mb-4" title="Sayfalama adapter sınırı">
        Backend denetim endpoint’i <code>offset</code> ve <code>total</code> döndürmüyor. En yeni 250
        gerçek kayıt alınır; rol, kaynak, tarih, arama ve sayfalama istemci tarafında uygulanır.
        Tam sunucu sayfalaması için API sözleşmesine <code>offset</code>/<code>total</code> eklenmelidir
        (TODO).
      </AdapterNotice>

      <div className="mb-4 space-y-3 rounded-2xl border bg-card p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Denetim kaydı ara"
            name="audit-log-search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              resetPage();
            }}
            placeholder="Aksiyon, kaynak, aktör veya gerekçe ara…"
            className="h-10 rounded-xl pl-9"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <Select
            value={serverAction}
            onValueChange={(value) => {
              setServerAction(value ?? "ALL");
              resetPage();
            }}
          >
            <SelectTrigger className="h-10 w-full rounded-xl">
              <Filter />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tüm aksiyonlar</SelectItem>
              {actions.map((action) => (
                <SelectItem key={action} value={action}>
                  {action}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={role}
            onValueChange={(value) => {
              setRole(value ?? "ALL");
              resetPage();
            }}
          >
            <SelectTrigger className="h-10 w-full rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tüm aktör rolleri</SelectItem>
              {roles.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={resourceType}
            onValueChange={(value) => {
              setResourceType(value ?? "ALL");
              resetPage();
            }}
          >
            <SelectTrigger className="h-10 w-full rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tüm kaynaklar</SelectItem>
              {resourceTypes.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div>
            <Label htmlFor="audit-from" className="sr-only">
              Başlangıç tarihi
            </Label>
            <Input
              id="audit-from"
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                resetPage();
              }}
              className="h-10"
            />
          </div>
          <div>
            <Label htmlFor="audit-to" className="sr-only">
              Bitiş tarihi
            </Label>
            <Input
              id="audit-to"
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                resetPage();
              }}
              className="h-10"
            />
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {pageItems.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Zaman</TableHead>
                  <TableHead>Aktör</TableHead>
                  <TableHead>Aksiyon</TableHead>
                  <TableHead>Kaynak</TableHead>
                  <TableHead>Gerekçe</TableHead>
                  <TableHead className="w-14 pr-4">
                    <span className="sr-only">Detay</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="pl-4 text-muted-foreground">
                      {dateTime(log.timestamp)}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{log.actor_role ?? "SYSTEM"}</p>
                      <p className="text-xs text-muted-foreground">
                        {shortId(log.actor_user_id)}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={actionTone(log.action)}>{log.action}</StatusBadge>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{log.resource_type}</p>
                      <p className="text-xs text-muted-foreground">
                        {shortId(log.resource_id)}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-52 truncate text-muted-foreground">
                      {log.reason || "—"}
                    </TableCell>
                    <TableCell className="pr-4">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Denetim kaydı detayını aç"
                        onClick={() => setSelected(log)}
                      >
                        <Eye />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-5">
              <EmptyState
                compact
                title="Denetim kaydı bulunamadı"
                description="Filtreleri değiştirerek tekrar deneyin."
                icon={FileClock}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          {filtered.length
            ? `${safePage * PAGE_SIZE + 1}–${Math.min((safePage + 1) * PAGE_SIZE, filtered.length)}`
            : "0"}{" "}
          / {number(filtered.length)} filtrelenmiş kayıt
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={safePage === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft />
            Önceki
          </Button>
          <span className="min-w-20 text-center">
            {safePage + 1} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={safePage + 1 >= pageCount}
            onClick={() => setPage((current) => current + 1)}
          >
            Sonraki
            <ChevronRight />
          </Button>
        </div>
      </div>

      <AuditDetail log={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function AuditDetail({ log, onClose }: { log: AuditLog | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(log)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{log?.action ?? "Denetim kaydı"}</DialogTitle>
          <DialogDescription>
            {log ? `${dateTime(log.timestamp)} · ${log.actor_role ?? "SYSTEM"}` : ""}
          </DialogDescription>
        </DialogHeader>
        {log ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <AuditMetric label="Kaynak" value={log.resource_type} />
              <AuditMetric label="Kaynak kimliği" value={log.resource_id ?? "—"} />
              <AuditMetric label="Aktör kimliği" value={log.actor_user_id ?? "SYSTEM"} />
            </div>
            {log.reason ? (
              <div className="rounded-xl border bg-muted/25 p-3">
                <p className="text-xs text-muted-foreground">Gerekçe</p>
                <p className="mt-1 text-sm">{log.reason}</p>
              </div>
            ) : null}
            <div className="grid gap-3 lg:grid-cols-2">
              <JsonPanel title="Önceki değer" value={log.previous_value} />
              <JsonPanel title="Yeni değer" value={log.new_value} />
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AuditMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-xs">{value}</p>
    </div>
  );
}

function JsonPanel({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="min-w-0 rounded-xl border">
      <p className="border-b px-3 py-2.5 font-semibold">{title}</p>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all bg-muted/20 p-3 text-xs leading-5">
        {value === null || value === undefined
          ? "Kayıt yok"
          : JSON.stringify(redactSecrets(value), null, 2)}
      </pre>
    </div>
  );
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      /password|pin|token|secret/i.test(key) ? "[REDACTED]" : redactSecrets(item),
    ]),
  );
}

function actionTone(action: string) {
  if (/delete|archive|cancel|reject|void|deactiv/i.test(action)) return "danger" as const;
  if (/create|approve|accept|paid/i.test(action)) return "success" as const;
  if (/update|change|transfer|reset/i.test(action)) return "warning" as const;
  return "info" as const;
}
