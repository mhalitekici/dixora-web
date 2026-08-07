"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChefHat,
  Clock3,
  LoaderCircle,
  Plus,
  Printer,
  RefreshCw,
  ServerCog,
  TriangleAlert,
  Utensils,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { adminApi, adminKeys } from "./admin-api";
import {
  AdapterNotice,
  dateTime,
  ErrorState,
  FieldError,
  LoadingState,
  number,
  relativeMinutes,
  shortId,
} from "./admin-utils";
import type {
  KitchenTicket,
  KitchenTicketStatus,
  PrintJob,
  PrintJobStatus,
  Station,
} from "./types";

const stationSchema = z.object({
  name: z.string().trim().min(2, "İstasyon adı en az 2 karakter olmalı.").max(100),
  code: z
    .string()
    .trim()
    .min(2, "Kod en az 2 karakter olmalı.")
    .max(50)
    .regex(/^[A-Za-z0-9_-]+$/, "Kod yalnız harf, rakam, - ve _ içerebilir."),
  sort_order: z.coerce.number().int().min(0).max(999),
});
type StationValues = z.infer<typeof stationSchema>;

const kitchenStatusLabels: Record<KitchenTicketStatus, string> = {
  NEW: "Yeni",
  ACCEPTED: "Kabul edildi",
  PREPARING: "Hazırlanıyor",
  READY: "Hazır",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
};

const transitions: Record<KitchenTicketStatus, KitchenTicketStatus[]> = {
  NEW: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

const primaryTransitionLabel: Partial<Record<KitchenTicketStatus, string>> = {
  ACCEPTED: "Kabul et",
  PREPARING: "Hazırlamaya başla",
  READY: "Hazır",
  COMPLETED: "Teslim edildi",
};

export function KitchenManagement() {
  const queryClient = useQueryClient();
  const [stationId, setStationId] = useState("ALL");
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const stationsQuery = useQuery({
    queryKey: adminKeys.stations(),
    queryFn: ({ signal }) => adminApi.stations(signal),
  });
  const ticketsQuery = useQuery({
    queryKey: adminKeys.kitchenTickets(stationId, includeCompleted),
    queryFn: ({ signal }) =>
      adminApi.kitchenTickets(
        {
          stationId: stationId === "ALL" ? undefined : stationId,
          includeCompleted,
        },
        signal,
      ),
    refetchInterval: 12_000,
  });
  const jobsQuery = useQuery({
    queryKey: adminKeys.printJobs(),
    queryFn: ({ signal }) => adminApi.printJobs(signal),
    refetchInterval: 15_000,
  });

  const form = useForm<StationValues>({
    resolver: zodResolver(stationSchema),
    defaultValues: { name: "", code: "", sort_order: 0 },
  });
  const createStation = useMutation({
    mutationFn: adminApi.createStation,
    onSuccess: async () => {
      toast.success("Hazırlık istasyonu oluşturuldu.");
      setDialogOpen(false);
      form.reset();
      await queryClient.invalidateQueries({ queryKey: adminKeys.stations() });
    },
    onError: () => toast.error("İstasyon oluşturulamadı."),
  });
  const updateTicket = useMutation({
    mutationFn: ({ id, status }: { id: string; status: KitchenTicketStatus }) =>
      adminApi.updateKitchenTicket(id, status),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...adminKeys.root, "kitchen-tickets"] }),
        queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() }),
      ]);
      toast.success("Mutfak bileti güncellendi.");
    },
    onError: () => toast.error("Bilet durumu güncellenemedi."),
  });

  const firstError = stationsQuery.error ?? ticketsQuery.error ?? jobsQuery.error;
  if (stationsQuery.isLoading || ticketsQuery.isLoading || jobsQuery.isLoading) {
    return <LoadingState label="Mutfak operasyonu yükleniyor…" />;
  }
  if (firstError) {
    return (
      <ErrorState
        error={firstError}
        onRetry={() => {
          void stationsQuery.refetch();
          void ticketsQuery.refetch();
          void jobsQuery.refetch();
        }}
      />
    );
  }

  const stations = stationsQuery.data ?? [];
  const tickets = ticketsQuery.data ?? [];
  const jobs = jobsQuery.data ?? [];
  const preparing = tickets.filter((ticket) => ticket.status === "PREPARING").length;
  const ready = tickets.filter((ticket) => ticket.status === "READY").length;
  const failedJobs = jobs.filter((job) => job.status === "FAILED").length;

  return (
    <>
      <PageHeader
        eyebrow="Mutfak operasyonu"
        title="İstasyonlar ve yazdırma"
        description="Mutfak biletlerini yönetin, hazırlık istasyonlarını tanımlayın ve yazdırma iş sinyallerini izleyin."
        icon={ChefHat}
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger render={<Button />}>
              <Plus />
              İstasyon ekle
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Yeni hazırlık istasyonu</DialogTitle>
                <DialogDescription>
                  Ürünlerin yönlendirileceği mutfak, bar veya tatlı istasyonunu tanımlayın.
                </DialogDescription>
              </DialogHeader>
              <form
                id="station-form"
                className="space-y-4"
                onSubmit={form.handleSubmit((values) =>
                  createStation.mutate({
                    ...values,
                    code: values.code.toUpperCase(),
                  }),
                )}
              >
                <div>
                  <Label htmlFor="station-name">İstasyon adı</Label>
                  <Input id="station-name" className="mt-1.5" {...form.register("name")} />
                  <FieldError>{form.formState.errors.name?.message}</FieldError>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="station-code">Kod</Label>
                    <Input
                      id="station-code"
                      className="mt-1.5 uppercase"
                      placeholder="MUTFAK"
                      {...form.register("code")}
                    />
                    <FieldError>{form.formState.errors.code?.message}</FieldError>
                  </div>
                  <div>
                    <Label htmlFor="station-sort">Sıra</Label>
                    <Input
                      id="station-sort"
                      className="mt-1.5"
                      type="number"
                      {...form.register("sort_order")}
                    />
                    <FieldError>{form.formState.errors.sort_order?.message}</FieldError>
                  </div>
                </div>
              </form>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Vazgeç
                </Button>
                <Button type="submit" form="station-form" disabled={createStation.isPending}>
                  {createStation.isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}
                  Oluştur
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Aktif bilet"
          value={tickets.length}
          detail="Seçili filtrede"
          icon={Utensils}
          tone="brand"
        />
        <StatCard
          title="Hazırlanıyor"
          value={preparing}
          detail="İşlemdeki bilet"
          icon={Clock3}
          tone="warning"
        />
        <StatCard
          title="Hazır"
          value={ready}
          detail="Teslim bekleyen"
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          title="Yazdırma hatası"
          value={failedJobs}
          detail={`${jobs.length} son iş içinde`}
          icon={Printer}
          tone={failedJobs ? "warning" : "default"}
        />
      </div>

      <Tabs defaultValue="tickets">
        <TabsList className="mb-4 h-10">
          <TabsTrigger value="tickets">Mutfak biletleri</TabsTrigger>
          <TabsTrigger value="stations">İstasyonlar</TabsTrigger>
          <TabsTrigger value="printing">Yazıcı sinyali</TabsTrigger>
        </TabsList>

        <TabsContent value="tickets">
          <div className="mb-4 flex flex-col gap-3 rounded-2xl border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
            <Select value={stationId} onValueChange={(value) => setStationId(value ?? "ALL")}>
              <SelectTrigger className="h-10 min-w-48 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tüm istasyonlar</SelectItem>
                {stations.map((station) => (
                  <SelectItem key={station.id} value={station.id}>
                    {station.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-3">
              <Label htmlFor="completed-tickets" className="text-sm font-normal">
                Tamamlananları göster
              </Label>
              <Switch
                id="completed-tickets"
                checked={includeCompleted}
                onCheckedChange={setIncludeCompleted}
              />
              <Button variant="outline" size="icon" onClick={() => void ticketsQuery.refetch()}>
                <RefreshCw className={cn(ticketsQuery.isFetching ? "animate-spin" : "")} />
                <span className="sr-only">Biletleri yenile</span>
              </Button>
            </div>
          </div>
          {tickets.length ? (
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {tickets.map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  onTransition={(status) => updateTicket.mutate({ id: ticket.id, status })}
                  pending={updateTicket.isPending && updateTicket.variables?.id === ticket.id}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Bu filtrede mutfak bileti yok"
              description="Yeni siparişler istasyon eşleştirmelerine göre burada görünür."
              icon={ChefHat}
            />
          )}
        </TabsContent>

        <TabsContent value="stations">
          <SectionCard
            title="Hazırlık istasyonları"
            description="Backend katalog istasyonları"
          >
            {stations.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {stations.map((station) => (
                  <StationCard
                    key={station.id}
                    station={station}
                    ticketCount={
                      tickets.filter(
                        (ticket) => ticket.preparation_station_id === station.id,
                      ).length
                    }
                    jobs={jobs.filter((job) => job.preparation_station_id === station.id)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                title="Hazırlık istasyonu yok"
                description="İlk istasyonu ekleyerek ürün yönlendirmesini başlatın."
                icon={ServerCog}
              />
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="printing">
          <AdapterNotice className="mb-4" title="Yazıcı heartbeat endpoint’i bulunmuyor">
            Durumlar gerçek <code>/printing/jobs</code> kayıtlarından türetilir. Cihazın çevrimiçi
            olduğunu kesinleştirmek için backend’e printer/bridge heartbeat endpoint’i eklenmelidir
            (adapter TODO).
          </AdapterNotice>
          <SectionCard
            title="Son yazdırma işleri"
            description={`${jobs.length} gerçek yazdırma kaydı`}
          >
            {jobs.length ? (
              <div className="space-y-2">
                {jobs.slice(0, 50).map((job) => (
                  <PrintJobRow key={job.id} job={job} stations={stations} />
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                title="Yazdırma işi yok"
                description="İlk mutfak veya fiş çıktısı oluşturulduğunda durum burada görünecek."
                icon={Printer}
              />
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </>
  );
}

function TicketCard({
  ticket,
  onTransition,
  pending,
}: {
  ticket: KitchenTicket;
  onTransition: (status: KitchenTicketStatus) => void;
  pending: boolean;
}) {
  const availableTransitions = transitions[ticket.status];
  const primary = availableTransitions.find((status) => status !== "CANCELLED");
  return (
    <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className="flex items-start justify-between gap-3 border-b p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold">
              {ticket.table_name ?? "Paket"} · #{ticket.batch_number}
            </p>
            <StatusBadge tone={ticketTone(ticket.status)}>
              {kitchenStatusLabels[ticket.status]}
            </StatusBadge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {ticket.station_name} · {ticket.waiter_name ?? ticket.order_source} ·{" "}
            {relativeMinutes(ticket.created_at)}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">#{shortId(ticket.order_id)}</span>
      </header>
      <div className="divide-y">
        {ticket.items.map((item) => (
          <div key={item.id} className="flex gap-3 px-4 py-3">
            <span className="font-bold tabular-nums">{number(item.quantity, 2)}×</span>
            <div className="min-w-0">
              <p className="font-medium">{item.name}</p>
              {item.modifiers.length ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {item.modifiers.join(" · ")}
                </p>
              ) : null}
              {item.note ? (
                <p className="mt-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-xs font-medium">
                  {item.note}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {availableTransitions.length ? (
        <footer className="flex gap-2 border-t bg-muted/20 p-3">
          {availableTransitions.includes("CANCELLED") ? (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={pending}
                  />
                }
              >
                İptal
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Mutfak biletini iptal et?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {ticket.table_name ?? "Paket"} için bu bilet ve bağlı ürün kalemleri iptal
                    durumuna alınacak.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Vazgeç</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => onTransition("CANCELLED")}
                  >
                    Bileti iptal et
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          {primary ? (
            <Button
              size="sm"
              className="ml-auto"
              disabled={pending}
              onClick={() => onTransition(primary)}
            >
              {pending ? <LoaderCircle className="animate-spin" /> : null}
              {primaryTransitionLabel[primary] ?? kitchenStatusLabels[primary]}
            </Button>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}

function StationCard({
  station,
  ticketCount,
  jobs,
}: {
  station: Station;
  ticketCount: number;
  jobs: PrintJob[];
}) {
  const lastJob = jobs[0];
  const failed = jobs.filter((job) => job.status === "FAILED").length;
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <ChefHat className="size-4" />
        </span>
        <StatusBadge tone={station.is_active ? "success" : "neutral"}>
          {station.is_active ? "Aktif" : "Kapalı"}
        </StatusBadge>
      </div>
      <p className="mt-4 font-semibold">{station.name}</p>
      <p className="text-xs text-muted-foreground">
        {station.code} · sıra {station.sort_order}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-muted/50 p-2.5">
          <p className="text-[0.65rem] text-muted-foreground">Aktif bilet</p>
          <p className="mt-1 font-semibold">{ticketCount}</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-2.5">
          <p className="text-[0.65rem] text-muted-foreground">İş hatası</p>
          <p className={cn("mt-1 font-semibold", failed ? "text-destructive" : "")}>{failed}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Son yazdırma: {lastJob ? `${printStatusLabel(lastJob.status)} · ${dateTime(lastJob.created_at)}` : "kayıt yok"}
      </p>
    </div>
  );
}

function PrintJobRow({ job, stations }: { job: PrintJob; stations: Station[] }) {
  const station = stations.find((item) => item.id === job.preparation_station_id);
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl",
          job.status === "FAILED"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground",
        )}
      >
        {job.status === "FAILED" ? (
          <TriangleAlert className="size-4" />
        ) : (
          <Printer className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{station?.name ?? "Genel yazıcı kuyruğu"}</p>
          <StatusBadge tone={printTone(job.status)}>{printStatusLabel(job.status)}</StatusBadge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          #{shortId(job.id)} · {job.kind} · {job.attempt_count} deneme · {dateTime(job.created_at)}
        </p>
        {job.last_error ? (
          <p className="mt-1 truncate text-xs text-destructive">{job.last_error}</p>
        ) : null}
      </div>
    </div>
  );
}

function ticketTone(status: KitchenTicketStatus) {
  if (status === "READY" || status === "COMPLETED") return "success" as const;
  if (status === "CANCELLED") return "danger" as const;
  if (status === "PREPARING") return "warning" as const;
  return "info" as const;
}

function printStatusLabel(status: PrintJobStatus) {
  return (
    {
      PENDING: "Bekliyor",
      CLAIMED: "Alındı",
      SENT: "Gönderildi",
      PRINTED: "Yazdırıldı",
      FAILED: "Hata",
      CANCELLED: "İptal",
    } satisfies Record<PrintJobStatus, string>
  )[status];
}

function printTone(status: PrintJobStatus) {
  if (status === "PRINTED") return "success" as const;
  if (status === "FAILED" || status === "CANCELLED") return "danger" as const;
  if (status === "PENDING") return "warning" as const;
  return "info" as const;
}
