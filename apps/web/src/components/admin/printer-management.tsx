"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, LoaderCircle, Plus, Printer, RefreshCw, Route, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { adminApi, adminKeys } from "./admin-api";
import { ErrorState, FieldError, LoadingState } from "./admin-utils";
import type { PrintJob, PrinterDevice, Station } from "./types";

const printerSchema = z.object({
  name: z.string().trim().min(2, "Yazıcı adı en az 2 karakter olmalı.").max(120),
  code: z
    .string()
    .trim()
    .min(2, "Kod en az 2 karakter olmalı.")
    .max(80)
    .regex(/^[A-Za-z][A-Za-z0-9_-]+$/, "Harf, rakam, tire ve alt çizgi kullanın."),
  preparation_station_id: z.string(),
  transport: z.enum(["BRIDGE", "MOCK"]),
  paper_width: z.enum(["58", "80"]),
});

const stationSchema = z.object({
  name: z.string().trim().min(2, "İstasyon adı en az 2 karakter olmalı.").max(100),
  code: z
    .string()
    .trim()
    .min(2, "Kod en az 2 karakter olmalı.")
    .max(50)
    .regex(/^[A-Za-z][A-Za-z0-9_-]+$/, "Harf, rakam, tire ve alt çizgi kullanın."),
});

type PrinterValues = z.infer<typeof printerSchema>;
type StationValues = z.infer<typeof stationSchema>;

export function PrinterManagement() {
  const queryClient = useQueryClient();
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [stationCreateOpen, setStationCreateOpen] = useState(false);
  const branchesQuery = useQuery({
    queryKey: adminKeys.branches(),
    queryFn: ({ signal }) => adminApi.branches(signal),
  });
  const branches = branchesQuery.data ?? [];
  const branchId = selectedBranchId ?? branches.find((branch) => branch.is_active)?.id ?? "";
  const stationsQuery = useQuery({
    queryKey: adminKeys.stations(branchId || "none"),
    queryFn: ({ signal }) => adminApi.stations(signal, branchId),
    enabled: Boolean(branchId),
  });
  const devicesQuery = useQuery({
    queryKey: adminKeys.printerDevices(branchId || "none"),
    queryFn: ({ signal }) => adminApi.printerDevices(branchId, signal),
    enabled: Boolean(branchId),
  });
  const jobsQuery = useQuery({
    queryKey: adminKeys.printJobs(branchId || "none"),
    queryFn: ({ signal }) => adminApi.printJobs(signal, branchId),
    enabled: Boolean(branchId),
    refetchInterval: 5_000,
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.printerDevices(branchId) }),
      queryClient.invalidateQueries({ queryKey: adminKeys.printJobs(branchId) }),
    ]);
  const createMutation = useMutation({
    mutationFn: (values: PrinterValues) =>
      adminApi.createPrinterDevice({
        branch_id: branchId,
        preparation_station_id:
          values.preparation_station_id === "GENERAL" ? null : values.preparation_station_id,
        code: values.code.toUpperCase(),
        name: values.name,
        transport: values.transport,
        settings: { paper_width: Number(values.paper_width) },
      }),
    onSuccess: async () => {
      setCreateOpen(false);
      toast.success("Yazıcı cihazı kaydedildi.");
      await invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Yazıcı kaydedilemedi."),
  });
  const createStationMutation = useMutation({
    mutationFn: (values: StationValues) =>
      adminApi.createStation({
        branch_id: branchId,
        name: values.name,
        code: values.code.toUpperCase(),
        sort_order: stationsQuery.data?.length ?? 0,
      }),
    onSuccess: async () => {
      setStationCreateOpen(false);
      toast.success("Hazırlık istasyonu eklendi.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.stations(branchId) }),
        queryClient.invalidateQueries({ queryKey: ["catalog", "stations"] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "İstasyon eklenemedi."),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof adminApi.updatePrinterDevice>[1] }) =>
      adminApi.updatePrinterDevice(id, input),
    onSuccess: async () => {
      toast.success("Yazıcı yönlendirmesi güncellendi.");
      await invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Yazıcı güncellenemedi."),
  });
  const testMutation = useMutation({
    mutationFn: adminApi.testPrinterDevice,
    onSuccess: async (job) => {
      toast.info(`Test işi #${job.id.slice(0, 8)} kuyruğa alındı; yazdırma sonucu bekleniyor.`);
      await queryClient.invalidateQueries({ queryKey: adminKeys.printJobs(branchId) });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Test işi oluşturulamadı."),
  });

  const error = branchesQuery.error ?? stationsQuery.error ?? devicesQuery.error ?? jobsQuery.error;
  if (branchesQuery.isLoading) return <LoadingState label="Yazıcı yönetimi yükleniyor…" />;
  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void branchesQuery.refetch();
          void stationsQuery.refetch();
          void devicesQuery.refetch();
          void jobsQuery.refetch();
        }}
      />
    );
  }

  const stations = stationsQuery.data ?? [];
  const devices = devicesQuery.data ?? [];
  const jobs = jobsQuery.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Çıktı yönlendirme"
        title="Yazıcılar"
        description="Hazırlık istasyonlarını gerçek yazıcı cihazlarına bağlayın ve test işinin kuyruk durumunu izleyin."
        icon={Printer}
        actions={
          <>
            <Button variant="outline" disabled={!branchId} onClick={() => setStationCreateOpen(true)}>
              <Plus />
              İstasyon ekle
            </Button>
            <Button disabled={!branchId} onClick={() => setCreateOpen(true)}>
              <Plus />
              Yazıcı ekle
            </Button>
          </>
        }
      />

      {branches.length ? (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Yazdırma kapsamı</p>
            <p className="text-xs text-muted-foreground">Cihaz ve işler şube bazında izole edilir.</p>
          </div>
          <Select
            items={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
            value={branchId}
            onValueChange={(value) => setSelectedBranchId(value ?? null)}
          >
            <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {!branchId ? (
        <EmptyState title="Şube bulunamadı" description="Yazıcı eklemek için önce bir şube oluşturun." icon={Printer} />
      ) : devicesQuery.isLoading || stationsQuery.isLoading || jobsQuery.isLoading ? (
        <LoadingState label="Şube yazıcıları yükleniyor…" />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <SectionCard title="Cihaz ve istasyon rotaları" description={`${devices.length} kayıtlı cihaz`}>
            {devices.length ? (
              <div className="divide-y">
                {devices.map((device) => (
                  <DeviceRow
                    key={device.id}
                    device={device}
                    stations={stations}
                    pending={updateMutation.isPending || (testMutation.isPending && testMutation.variables === device.id)}
                    onRoute={(stationId) =>
                      updateMutation.mutate({
                        id: device.id,
                        input: { preparation_station_id: stationId === "GENERAL" ? null : stationId },
                      })
                    }
                    onToggle={(is_active) => updateMutation.mutate({ id: device.id, input: { is_active } })}
                    onTest={() => testMutation.mutate(device.id)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState compact title="Yazıcı cihazı yok" description="İlk cihazı ekleyip hazırlık istasyonuna yönlendirin." icon={Printer} />
            )}
          </SectionCard>

          <SectionCard
            title="Son yazdırma işleri"
            description="5 saniyede bir gerçek kuyruk durumu yenilenir"
            action={
              <Button variant="ghost" size="icon-sm" onClick={() => void jobsQuery.refetch()}>
                <RefreshCw className={cn(jobsQuery.isFetching && "animate-spin")} />
                <span className="sr-only">İşleri yenile</span>
              </Button>
            }
          >
            {jobs.length ? (
              <div className="space-y-2">
                {jobs.slice(0, 20).map((job) => <JobRow key={job.id} job={job} devices={devices} />)}
              </div>
            ) : (
              <EmptyState compact title="Kuyruk boş" description="Test veya sipariş çıktıları burada görünür." icon={Clock3} />
            )}
          </SectionCard>
        </div>
      )}

      <PrinterCreateDialog
        open={createOpen}
        stations={stations}
        pending={createMutation.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={(values) => createMutation.mutate(values)}
      />
      <StationCreateDialog
        open={stationCreateOpen}
        pending={createStationMutation.isPending}
        onClose={() => setStationCreateOpen(false)}
        onSubmit={(values) => createStationMutation.mutate(values)}
      />
    </>
  );
}

function StationCreateDialog({
  open,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: StationValues) => void;
}) {
  const form = useForm<StationValues>({
    resolver: zodResolver(stationSchema),
    defaultValues: { name: "", code: "" },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hazırlık istasyonu ekle</DialogTitle>
          <DialogDescription>
            Ürünleri mutfak, bar veya servis hazırlık akışına yönlendirmek için bir istasyon oluşturun.
          </DialogDescription>
        </DialogHeader>
        <form id="station-create-form" className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div>
            <Label htmlFor="station-name">İstasyon adı</Label>
            <Input id="station-name" className="mt-1.5" placeholder="Sıcak mutfak" {...form.register("name")} />
            <FieldError>{form.formState.errors.name?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="station-code">İstasyon kodu</Label>
            <Input id="station-code" className="mt-1.5 uppercase" placeholder="HOT-KITCHEN" {...form.register("code")} />
            <FieldError>{form.formState.errors.code?.message}</FieldError>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button type="submit" form="station-create-form" disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}
            İstasyonu kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeviceRow({
  device,
  stations,
  pending,
  onRoute,
  onToggle,
  onTest,
}: {
  device: PrinterDevice;
  stations: Station[];
  pending: boolean;
  onRoute: (stationId: string) => void;
  onToggle: (active: boolean) => void;
  onTest: () => void;
}) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Printer className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{device.name}</p>
            <StatusBadge tone={device.is_active ? "success" : "neutral"}>
              {device.is_active ? "Aktif" : "Kapalı"}
            </StatusBadge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {device.code} · {device.transport} · {String(device.settings.paper_width ?? "—")} mm
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={device.is_active} disabled={pending} onCheckedChange={onToggle} aria-label={`${device.name} aktif`} />
          <Button size="sm" variant="outline" disabled={pending || !device.is_active} onClick={onTest}>
            {pending ? <LoaderCircle className="animate-spin" /> : <Printer />}
            Test işi
          </Button>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 pl-0 sm:pl-12">
        <Route className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Select
          items={[
            { value: "GENERAL", label: "Genel şube kuyruğu" },
            ...stations
              .filter((station) => station.is_active)
              .map((station) => ({ value: station.id, label: station.name })),
          ]}
          value={device.preparation_station_id ?? "GENERAL"}
          onValueChange={(value) => value && onRoute(value)}
          disabled={pending}
        >
          <SelectTrigger className="h-9 w-full sm:w-72"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="GENERAL">Genel şube kuyruğu</SelectItem>
            {stations.filter((station) => station.is_active).map((station) => (
              <SelectItem key={station.id} value={station.id}>{station.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function JobRow({ job, devices }: { job: PrintJob; devices: PrinterDevice[] }) {
  const printer = devices.find((device) => device.id === job.printer_device_id);
  const failed = job.status === "FAILED";
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start gap-2">
        {failed ? <TriangleAlert className="mt-0.5 size-4 text-destructive" /> : <Clock3 className="mt-0.5 size-4 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="truncate text-sm font-medium">{printer?.name ?? "Otomatik istasyon rotası"}</p>
            <StatusBadge tone={jobTone(job.status)}>{jobLabel(job.status)}</StatusBadge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">#{job.id.slice(0, 8)} · {new Date(job.created_at).toLocaleString("tr-TR")}</p>
          {job.last_error ? <p className="mt-1 text-xs text-destructive">{job.last_error}</p> : null}
        </div>
      </div>
    </div>
  );
}

function PrinterCreateDialog({
  open,
  stations,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  stations: Station[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: PrinterValues) => void;
}) {
  const form = useForm<PrinterValues>({
    resolver: zodResolver(printerSchema),
    defaultValues: { name: "", code: "", preparation_station_id: "GENERAL", transport: "BRIDGE", paper_width: "80" },
  });
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yazıcı cihazı ekle</DialogTitle>
          <DialogDescription>Print Bridge cihazını şube kuyruğuna veya tek bir hazırlık istasyonuna bağlayın.</DialogDescription>
        </DialogHeader>
        <form id="printer-create-form" className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div>
            <Label htmlFor="printer-name">Cihaz adı</Label>
            <Input id="printer-name" className="mt-1.5" {...form.register("name")} />
            <FieldError>{form.formState.errors.name?.message}</FieldError>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="printer-code">Cihaz kodu</Label>
              <Input id="printer-code" className="mt-1.5 uppercase" placeholder="MUTFAK-01" {...form.register("code")} />
              <FieldError>{form.formState.errors.code?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="printer-width">Kağıt genişliği</Label>
              <select id="printer-width" className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm" {...form.register("paper_width")}>
                <option value="80">80 mm</option><option value="58">58 mm</option>
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="printer-station">Yönlendirilen istasyon</Label>
            <select id="printer-station" className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm" {...form.register("preparation_station_id")}>
              <option value="GENERAL">Genel şube kuyruğu</option>
              {stations.filter((station) => station.is_active).map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="printer-transport">Bağlantı türü</Label>
            <select id="printer-transport" className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm" {...form.register("transport")}>
              <option value="BRIDGE">Print Bridge</option>
              <option value="MOCK">Geliştirme mock’u</option>
            </select>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button type="submit" form="printer-create-form" disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}
            Cihazı kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function jobLabel(status: PrintJob["status"]) {
  return { PENDING: "Bekliyor", CLAIMED: "Alındı", SENT: "Gönderildi", PRINTED: "Yazdırıldı", FAILED: "Hata", CANCELLED: "İptal" }[status];
}

function jobTone(status: PrintJob["status"]) {
  if (status === "PRINTED") return "success" as const;
  if (status === "FAILED" || status === "CANCELLED") return "danger" as const;
  if (status === "PENDING") return "warning" as const;
  return "info" as const;
}
