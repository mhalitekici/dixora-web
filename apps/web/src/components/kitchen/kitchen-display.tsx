"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  BellOff,
  Check,
  ChefHat,
  Clock3,
  Flame,
  Loader2,
  Maximize2,
  Play,
  Printer,
  RefreshCw,
  Utensils,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type TicketItem = {
  id: string;
  order_item_id?: string;
  name: string;
  quantity: string | number;
  note?: string | null;
  modifiers?: string[] | Array<{ name?: string; name_snapshot?: string }>;
  status?: string;
};
type Ticket = {
  id: string;
  order_id: string;
  preparation_station_id: string;
  station_name?: string;
  table_name?: string;
  waiter_name?: string;
  order_source?: string;
  status: string;
  created_at: string;
  items?: TicketItem[];
  print_status?: string;
};

function unwrap<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: T[] }).items;
  }
  return [];
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => null)) as T | { detail?: string; message?: string } | null;
  if (!response.ok) {
    const error = payload as { detail?: string; message?: string } | null;
    throw new Error(error?.detail ?? error?.message ?? "İşlem tamamlanamadı.");
  }
  return payload as T;
}

const statusColumns = [
  { key: "NEW", label: "Yeni", color: "bg-brand", icon: Bell },
  { key: "ACCEPTED", label: "Kabul edildi", color: "bg-blue-500", icon: Check },
  { key: "PREPARING", label: "Hazırlanıyor", color: "bg-amber-500", icon: Flame },
  { key: "READY", label: "Hazır", color: "bg-emerald-500", icon: Utensils },
] as const;

const nextAction: Record<string, { status: string; label: string; icon: typeof Play; className: string }> = {
  NEW: { status: "ACCEPTED", label: "Kabul et", icon: Check, className: "bg-brand text-[#24110a] hover:bg-brand/90" },
  ACCEPTED: { status: "PREPARING", label: "Hazırlamaya başla", icon: Play, className: "bg-blue-500 text-white hover:bg-blue-500/90" },
  PREPARING: { status: "READY", label: "Hazır olarak işaretle", icon: Utensils, className: "bg-amber-500 text-[#2b1b05] hover:bg-amber-500/90" },
  READY: { status: "COMPLETED", label: "Tamamla", icon: Check, className: "bg-emerald-500 text-[#08291d] hover:bg-emerald-500/90" },
};

function waitSeconds(createdAt: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 1000));
}

function timer(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function modifierLabels(modifiers?: TicketItem["modifiers"]) {
  if (!modifiers) return [];
  return modifiers.map((modifier) =>
    typeof modifier === "string" ? modifier : modifier.name ?? modifier.name_snapshot ?? "",
  );
}

function playNewTicketSound() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.setValueAtTime(660, context.currentTime + 0.16);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.36);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.38);
    oscillator.addEventListener("ended", () => void context.close());
  } catch {
    // Audio feedback is optional; visual feedback remains authoritative.
  }
}

export function KitchenDisplay() {
  const queryClient = useQueryClient();
  const [station, setStation] = useState("all");
  const [sort, setSort] = useState("oldest");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const previousNewIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const query = useQuery({
    queryKey: ["kitchen", "tickets"],
    queryFn: async () =>
      unwrap<Ticket>(await api<unknown>("/kitchen/tickets")),
    refetchInterval: 5_000,
  });
  const tickets = useMemo(() => query.data ?? [], [query.data]);

  useEffect(() => {
    const newIds = new Set(tickets.filter((ticket) => ticket.status === "NEW").map((ticket) => ticket.id));
    if (soundEnabled && previousNewIds.current.size > 0) {
      const hasNew = [...newIds].some((id) => !previousNewIds.current.has(id));
      if (hasNew) playNewTicketSound();
    }
    previousNewIds.current = newIds;
  }, [soundEnabled, tickets]);

  const stations = useMemo(
    () =>
      Array.from(
        new Map(
          tickets.map((ticket) => [
            ticket.preparation_station_id,
            ticket.station_name ?? "İstasyon",
          ]),
        ),
      ),
    [tickets],
  );

  const visibleTickets = useMemo(
    () =>
      tickets
        .filter(
          (ticket) =>
            ticket.status !== "COMPLETED" &&
            (station === "all" || ticket.preparation_station_id === station),
        )
        .sort((a, b) =>
          sort === "oldest"
            ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            : new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
    [sort, station, tickets],
  );

  const mutation = useMutation({
    mutationFn: ({ ticket, status }: { ticket: Ticket; status: string }) =>
      api<Ticket>(`/kitchen/tickets/${ticket.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onMutate: async ({ ticket, status }) => {
      await queryClient.cancelQueries({ queryKey: ["kitchen", "tickets"] });
      const previous = queryClient.getQueryData<Ticket[]>(["kitchen", "tickets"]);
      queryClient.setQueryData<Ticket[]>(["kitchen", "tickets"], (current = []) =>
        current.map((item) => (item.id === ticket.id ? { ...item, status } : item)),
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(["kitchen", "tickets"], context.previous);
      toast.error(error instanceof Error ? error.message : "Bilet güncellenemedi.");
    },
    onSuccess: (_result, variables) => {
      toast.success(
        variables.status === "READY"
          ? `${variables.ticket.table_name ?? "Sipariş"} servise hazır`
          : "Bilet durumu güncellendi",
      );
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["kitchen", "tickets"] }),
  });

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-[#191717]">
      <div className="flex flex-col gap-3 border-b border-white/8 bg-[#201d1d] p-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand text-[#24110a]">
            <ChefHat className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-white">Mutfak Sipariş Ekranı</h1>
            <p className="text-[0.65rem] text-white/40">
              {visibleTickets.length} aktif bilet · {visibleTickets.reduce((sum, ticket) => sum + (ticket.items?.length ?? 0), 0)} kalem
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {query.isError ? (
            <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-[0.65rem] font-semibold text-red-300">
              Bağlantı hatası
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[0.65rem] font-semibold text-emerald-300">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-40" />
                <span className="relative size-1.5 rounded-full bg-emerald-400" />
              </span>
              Canlı
            </span>
          )}
          <Select value={station} onValueChange={(value) => setStation(value ?? "all")}>
            <SelectTrigger className="h-9 min-w-40 rounded-xl border-white/10 bg-white/5 text-white">
              <SelectValue placeholder="Tüm istasyonlar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm istasyonlar</SelectItem>
              {stations.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(value) => setSort(value ?? "oldest")}>
            <SelectTrigger className="h-9 min-w-32 rounded-xl border-white/10 bg-white/5 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="oldest">En eski önce</SelectItem>
              <SelectItem value="newest">En yeni önce</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-9 rounded-xl text-white/60 hover:bg-white/8 hover:text-white",
              soundEnabled && "bg-brand/15 text-brand",
            )}
            onClick={() => {
              setSoundEnabled((value) => !value);
              if (!soundEnabled) playNewTicketSound();
            }}
            aria-label={soundEnabled ? "Sesi kapat" : "Sesi aç"}
          >
            {soundEnabled ? <Bell /> : <BellOff />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-xl text-white/60 hover:bg-white/8 hover:text-white"
            onClick={() => void document.documentElement.requestFullscreen?.()}
            aria-label="Tam ekran"
          >
            <Maximize2 />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-xl text-white/60 hover:bg-white/8 hover:text-white"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            aria-label="Yenile"
          >
            <RefreshCw className={cn(query.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <div className="flex min-h-[60dvh] items-center justify-center">
          <Loader2 className="size-7 animate-spin text-brand" />
        </div>
      ) : query.isError ? (
        <div className="flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center">
          <span className="flex size-16 items-center justify-center rounded-3xl bg-red-500/10 text-red-300">
            <AlertTriangle className="size-7" />
          </span>
          <h2 className="mt-5 text-xl font-semibold text-white">
            Mutfak biletleri yüklenemedi
          </h2>
          <p className="mt-2 max-w-md text-sm text-white/40">
            Sipariş verilerine ulaşılamıyor. Bağlantınızı kontrol edip yeniden deneyin.
          </p>
          <Button
            variant="outline"
            className="mt-5 border-white/10 bg-white/5 text-white hover:bg-white/10"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className={cn(query.isFetching && "animate-spin")} />
            Yeniden dene
          </Button>
        </div>
      ) : visibleTickets.length ? (
        <div className="grid min-h-[calc(100dvh-8.4rem)] gap-px bg-white/[0.06] xl:grid-cols-4">
          {statusColumns.map((column) => {
            const columnTickets = visibleTickets.filter((ticket) => ticket.status === column.key);
            return (
              <section key={column.key} className="min-w-0 bg-[#191717] p-3">
                <header className="mb-3 flex h-10 items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", column.color)} />
                    <h2 className="text-xs font-semibold uppercase tracking-[0.13em] text-white/65">
                      {column.label}
                    </h2>
                  </div>
                  <span className="flex size-7 items-center justify-center rounded-lg bg-white/6 text-xs font-bold text-white">
                    {columnTickets.length}
                  </span>
                </header>
                <div className="space-y-3">
                  {columnTickets.map((ticket) => {
                    const seconds = waitSeconds(ticket.created_at, now);
                    const critical = seconds >= 12 * 60;
                    const warning = seconds >= 8 * 60;
                    const action = nextAction[ticket.status];
                    const ActionIcon = action?.icon ?? Check;
                    return (
                      <article
                        key={ticket.id}
                        className={cn(
                          "overflow-hidden rounded-2xl border bg-[#252222] shadow-xl shadow-black/10",
                          critical
                            ? "border-red-500/55"
                            : warning
                              ? "border-amber-500/45"
                              : "border-white/9",
                        )}
                      >
                        <header
                          className={cn(
                            "flex items-center gap-3 border-b border-white/8 px-3 py-2.5",
                            critical ? "bg-red-500/10" : warning ? "bg-amber-500/8" : "bg-white/[0.025]",
                          )}
                        >
                          <span className="flex size-10 items-center justify-center rounded-xl bg-white/8 text-lg font-bold text-white">
                            {ticket.table_name ?? "—"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-xs font-semibold text-white">
                                {ticket.waiter_name ?? "Servis"}
                              </p>
                              <span className="rounded-md bg-white/6 px-1.5 py-0.5 text-[0.55rem] font-semibold text-white/45">
                                {ticket.order_source ?? "WAITER"}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[0.58rem] text-white/35">
                              #{ticket.order_id.slice(0, 6).toUpperCase()}
                            </p>
                          </div>
                          <div
                            className={cn(
                              "flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 font-mono text-sm font-bold tabular-nums",
                              critical
                                ? "bg-red-500 text-white"
                                : warning
                                  ? "bg-amber-500 text-[#2b1b05]"
                                  : "bg-white/8 text-white",
                            )}
                          >
                            <Clock3 className="size-3.5" />
                            {timer(seconds)}
                          </div>
                        </header>
                        <div className="space-y-3 p-3">
                          {(ticket.items ?? []).map((item) => (
                            <div key={item.id} className="flex items-start gap-2.5">
                              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/8 text-xs font-bold text-white">
                                {Number(item.quantity)}×
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold leading-5 text-white">{item.name}</p>
                                {modifierLabels(item.modifiers).length ? (
                                  <p className="mt-0.5 text-[0.65rem] leading-4 text-brand">
                                    {modifierLabels(item.modifiers).join(" · ")}
                                  </p>
                                ) : null}
                                {item.note ? (
                                  <div className="mt-1.5 rounded-lg border border-amber-500/20 bg-amber-500/8 px-2 py-1.5">
                                    <p className="text-[0.66rem] font-semibold leading-4 text-amber-300">
                                      {item.note}
                                    </p>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                        <footer className="flex items-center gap-2 border-t border-white/8 p-2.5">
                          <span
                            className={cn(
                              "flex size-9 items-center justify-center rounded-xl",
                              ticket.print_status === "PRINTED"
                                ? "bg-emerald-500/10 text-emerald-300"
                                : "bg-amber-500/10 text-amber-300",
                            )}
                            title={`Baskı: ${ticket.print_status ?? "PENDING"}`}
                          >
                            <Printer className="size-4" />
                          </span>
                          {action ? (
                            <Button
                              className={cn("h-10 flex-1 rounded-xl font-bold", action.className)}
                              disabled={mutation.isPending}
                              onClick={() => mutation.mutate({ ticket, status: action.status })}
                            >
                              {mutation.isPending && mutation.variables?.ticket.id === ticket.id ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <ActionIcon />
                              )}
                              {action.label}
                            </Button>
                          ) : null}
                        </footer>
                      </article>
                    );
                  })}
                  {!columnTickets.length ? (
                    <div className="flex min-h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-white/8 text-center">
                      <column.icon className="size-5 text-white/20" />
                      <p className="mt-2 text-[0.68rem] text-white/30">Bu aşamada bilet yok</p>
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-[70dvh] flex-col items-center justify-center text-center">
          <span className="flex size-16 items-center justify-center rounded-3xl bg-white/5 text-white/30">
            <ChefHat className="size-7" />
          </span>
          <h2 className="mt-5 text-xl font-semibold text-white">Tüm biletler tamamlandı</h2>
          <p className="mt-2 text-sm text-white/40">Yeni siparişler gerçek zamanlı olarak burada görünecek.</p>
        </div>
      )}
    </div>
  );
}
