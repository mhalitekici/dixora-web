"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock3,
  Copy,
  Laptop,
  Link2,
  LoaderCircle,
  MonitorDown,
  Plus,
  Printer,
  RefreshCw,
  ReceiptText,
  RotateCcw,
  Route,
  TriangleAlert,
  Unlink,
} from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
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
import type {
  PrintBridge,
  PrintBridgeEnrollment,
  PrintBridgePrinterMapping,
  PrintJob,
  PrinterDevice,
  Station,
} from "./types";

const printerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Yazıcı adı en az 2 karakter olmalı.")
    .max(120),
  code: z
    .string()
    .trim()
    .min(2, "Kod en az 2 karakter olmalı.")
    .max(80)
    .regex(
      /^[A-Za-z][A-Za-z0-9_-]+$/,
      "Harf, rakam, tire ve alt çizgi kullanın.",
    ),
  purpose: z.enum(["PREPARATION", "CASHIER"]),
  preparation_station_id: z.string(),
  paper_width: z.literal("80"),
});

const stationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "İstasyon adı en az 2 karakter olmalı.")
    .max(100),
  code: z
    .string()
    .trim()
    .min(2, "Kod en az 2 karakter olmalı.")
    .max(50)
    .regex(
      /^[A-Za-z][A-Za-z0-9_-]+$/,
      "Harf, rakam, tire ve alt çizgi kullanın.",
    ),
});

type PrinterValues = z.infer<typeof printerSchema>;
type StationValues = z.infer<typeof stationSchema>;

const UNMAPPED_VALUE = "__UNMAPPED__";

export function PrinterManagement() {
  const queryClient = useQueryClient();
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [stationCreateOpen, setStationCreateOpen] = useState(false);
  const [enrollment, setEnrollment] = useState<PrintBridgeEnrollment | null>(
    null,
  );
  const branchesQuery = useQuery({
    queryKey: adminKeys.branches(),
    queryFn: ({ signal }) => adminApi.branches(signal),
  });
  const branches = branchesQuery.data ?? [];
  const branchId =
    selectedBranchId ?? branches.find((branch) => branch.is_active)?.id ?? "";
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
  const bridgesQuery = useQuery({
    queryKey: adminKeys.printBridges(branchId || "none"),
    queryFn: ({ signal }) => adminApi.printBridges(branchId, signal),
    enabled: Boolean(branchId),
    refetchInterval: 10_000,
  });
  const jobsQuery = useQuery({
    queryKey: adminKeys.printJobs(branchId || "none"),
    queryFn: ({ signal }) => adminApi.printJobs(signal, branchId),
    enabled: Boolean(branchId),
    refetchInterval: 5_000,
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: adminKeys.printerDevices(branchId),
      }),
      queryClient.invalidateQueries({
        queryKey: adminKeys.printBridges(branchId),
      }),
      queryClient.invalidateQueries({
        queryKey: adminKeys.printJobs(branchId),
      }),
    ]);

  const createMutation = useMutation({
    mutationFn: (values: PrinterValues) =>
      adminApi.createPrinterDevice({
        branch_id: branchId,
        preparation_station_id:
          values.purpose === "CASHIER" ||
          values.preparation_station_id === "GENERAL"
            ? null
            : values.preparation_station_id,
        purpose: values.purpose,
        code: values.code.toUpperCase(),
        name: values.name,
        transport: "BRIDGE",
        settings: { paper_width: Number(values.paper_width) },
      }),
    onSuccess: async () => {
      setCreateOpen(false);
      toast.success("Yazıcı cihazı kaydedildi.");
      await invalidate();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Yazıcı kaydedilemedi.",
      ),
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
        queryClient.invalidateQueries({
          queryKey: adminKeys.stations(branchId),
        }),
        queryClient.invalidateQueries({ queryKey: ["catalog", "stations"] }),
      ]);
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "İstasyon eklenemedi.",
      ),
  });
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<typeof adminApi.updatePrinterDevice>[1];
    }) => adminApi.updatePrinterDevice(id, input),
    onSuccess: async () => {
      toast.success("Yazıcı yönlendirmesi güncellendi.");
      await invalidate();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Yazıcı güncellenemedi.",
      ),
  });
  const testMutation = useMutation({
    mutationFn: adminApi.testPrinterDevice,
    onSuccess: async (job) => {
      toast.info(`Test işi #${job.id.slice(0, 8)} kuyruğa alındı.`);
      await queryClient.invalidateQueries({
        queryKey: adminKeys.printJobs(branchId),
      });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Test işi oluşturulamadı.",
      ),
  });
  const enrollmentMutation = useMutation({
    mutationFn: () =>
      adminApi.createPrintBridgeEnrollment({ branch_id: branchId }),
    onSuccess: (nextEnrollment) => setEnrollment(nextEnrollment),
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Bağlantı kodu oluşturulamadı.",
      ),
  });
  const mapMutation = useMutation({
    mutationFn: ({
      bridgeId,
      deviceId,
      localPrinterName,
    }: {
      bridgeId: string;
      deviceId: string;
      localPrinterName: string;
    }) => adminApi.mapBridgePrinter(bridgeId, deviceId, localPrinterName),
    onSuccess: async () => {
      toast.success("Yerel yazıcı eşleştirildi.");
      await invalidate();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Yazıcı eşleştirilemedi.",
      ),
  });
  const unmapMutation = useMutation({
    mutationFn: ({
      bridgeId,
      deviceId,
    }: {
      bridgeId: string;
      deviceId: string;
    }) => adminApi.unmapBridgePrinter(bridgeId, deviceId),
    onSuccess: async () => {
      toast.success("Yerel yazıcı eşleştirmesi kaldırıldı.");
      await invalidate();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Eşleştirme kaldırılamadı.",
      ),
  });
  const retryMutation = useMutation({
    mutationFn: adminApi.retryPrintJob,
    onSuccess: async () => {
      toast.success("Baskı işi operatör onayıyla yeniden kuyruğa alındı.");
      await queryClient.invalidateQueries({
        queryKey: adminKeys.printJobs(branchId),
      });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Baskı işi yeniden denenemedi.",
      ),
  });
  const revokeMutation = useMutation({
    mutationFn: adminApi.revokePrintBridge,
    onSuccess: async () => {
      toast.success("Print Bridge bağlantısı kaldırıldı.");
      await invalidate();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Bridge kaldırılamadı.",
      ),
  });

  const error =
    branchesQuery.error ??
    stationsQuery.error ??
    devicesQuery.error ??
    bridgesQuery.error ??
    jobsQuery.error;
  if (branchesQuery.isLoading) {
    return <LoadingState label="Yazıcı yönetimi yükleniyor..." />;
  }
  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void branchesQuery.refetch();
          void stationsQuery.refetch();
          void devicesQuery.refetch();
          void bridgesQuery.refetch();
          void jobsQuery.refetch();
        }}
      />
    );
  }

  const stations = stationsQuery.data ?? [];
  const devices = devicesQuery.data ?? [];
  const bridges = bridgesQuery.data ?? [];
  const jobs = jobsQuery.data ?? [];
  const mappings = bridges.flatMap((bridge) => bridge.printer_mappings);
  const mappingByDevice = new Map(
    mappings.map((mapping) => [mapping.printer_device_id, mapping]),
  );
  const busy =
    updateMutation.isPending ||
    testMutation.isPending ||
    mapMutation.isPending ||
    unmapMutation.isPending ||
    retryMutation.isPending;

  return (
    <>
      <PageHeader
        eyebrow="Çıktı yönlendirme"
        title="Yazıcılar"
        description="Mutfak, bar ve kasa çıktılarını şubedeki yerel Print Bridge yazıcılarıyla eşleştirin."
        icon={Printer}
        actions={
          <>
            <Button
              variant="outline"
              disabled={!branchId}
              onClick={() => setStationCreateOpen(true)}
            >
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
        <div className="mb-4 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Yazdırma kapsamı</p>
            <p className="text-xs text-muted-foreground">
              Cihazlar, bridge bağlantıları ve kuyruk şube bazında ayrıdır.
            </p>
          </div>
          <Select
            items={branches.map((branch) => ({
              value: branch.id,
              label: branch.name,
            }))}
            value={branchId}
            onValueChange={(value) => setSelectedBranchId(value ?? null)}
          >
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {!branchId ? (
        <EmptyState
          title="Şube bulunamadı"
          description="Yazıcı eklemek için önce bir şube oluşturun."
          icon={Printer}
        />
      ) : devicesQuery.isLoading ||
        stationsQuery.isLoading ||
        bridgesQuery.isLoading ||
        jobsQuery.isLoading ? (
        <LoadingState label="Şube yazıcıları yükleniyor..." />
      ) : (
        <div className="space-y-5">
          <SectionCard
            title="Yerel Print Bridge"
            description="Şubedeki bilgisayarların son heartbeat ve işletim sistemi yazıcıları."
            action={
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void downloadInstaller("windows")}
                >
                  <MonitorDown />
                  Windows uygulamasını indir
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void downloadInstaller("macos")}
                >
                  <MonitorDown />
                  macOS uygulamasını indir
                </Button>
                <Button
                  size="sm"
                  disabled={enrollmentMutation.isPending}
                  onClick={() => enrollmentMutation.mutate()}
                >
                  {enrollmentMutation.isPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Link2 />
                  )}
                  Yeni Bridge bağla
                </Button>
              </div>
            }
          >
            {bridges.length ? (
              <div className="divide-y">
                {bridges.map((bridge) => (
                  <BridgeRow
                    key={bridge.id}
                    bridge={bridge}
                    pending={
                      revokeMutation.isPending &&
                      revokeMutation.variables === bridge.id
                    }
                    onRevoke={() => revokeMutation.mutate(bridge.id)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                title="Print Bridge kurulmadı"
                description="Bağlantı kodu oluşturup şubedeki Windows veya macOS bilgisayarda bridge'i eşleştirin."
                icon={Laptop}
              />
            )}
          </SectionCard>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <SectionCard
              title="Cihaz, istasyon ve yerel yazıcı"
              description={`${devices.length} kayıtlı cihaz`}
            >
              {devices.length ? (
                <div className="divide-y">
                  {devices.map((device) => (
                    <DeviceRow
                      key={device.id}
                      device={device}
                      stations={stations}
                      bridges={bridges}
                      mapping={mappingByDevice.get(device.id)}
                      pending={busy}
                      onRoute={(stationId) =>
                        updateMutation.mutate({
                          id: device.id,
                          input: {
                            preparation_station_id:
                              stationId === "GENERAL" ? null : stationId,
                          },
                        })
                      }
                      onPurposeChange={(purpose) =>
                        updateMutation.mutate({
                          id: device.id,
                          input: {
                            purpose,
                            ...(purpose === "CASHIER"
                              ? { preparation_station_id: null }
                              : {}),
                          },
                        })
                      }
                      onToggle={(isActive) =>
                        updateMutation.mutate({
                          id: device.id,
                          input: { is_active: isActive },
                        })
                      }
                      onTest={() => testMutation.mutate(device.id)}
                      onMappingChange={(value) => {
                        if (value === UNMAPPED_VALUE) {
                          const existing = mappingByDevice.get(device.id);
                          if (existing) {
                            unmapMutation.mutate({
                              bridgeId: existing.bridge_id,
                              deviceId: device.id,
                            });
                          }
                          return;
                        }
                        const parsed = parseMappingValue(value);
                        if (parsed) {
                          mapMutation.mutate({
                            bridgeId: parsed.bridgeId,
                            deviceId: device.id,
                            localPrinterName: parsed.localPrinterName,
                          });
                        }
                      }}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  compact
                  title="Yazıcı cihazı yok"
                  description="İlk cihazı ekleyip hazırlık veya kasa rolüne yönlendirin."
                  icon={Printer}
                />
              )}
            </SectionCard>

            <SectionCard
              title="Son yazdırma işleri"
              description="Kuyruk durumu 5 saniyede bir yenilenir"
              action={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void jobsQuery.refetch()}
                >
                  <RefreshCw
                    className={cn(jobsQuery.isFetching && "animate-spin")}
                  />
                  <span className="sr-only">İşleri yenile</span>
                </Button>
              }
            >
              {jobs.length ? (
                <div className="space-y-2">
                  {jobs.slice(0, 20).map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      devices={devices}
                      pending={
                        retryMutation.isPending &&
                        retryMutation.variables === job.id
                      }
                      onRetry={() => retryMutation.mutate(job.id)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  compact
                  title="Kuyruk boş"
                  description="Test veya sipariş çıktıları burada görünür."
                  icon={Clock3}
                />
              )}
            </SectionCard>
          </div>
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
      <EnrollmentCodeDialog
        enrollment={enrollment}
        onClose={() => setEnrollment(null)}
      />
    </>
  );
}

function BridgeRow({
  bridge,
  pending,
  onRevoke,
}: {
  bridge: PrintBridge;
  pending: boolean;
  onRevoke: () => void;
}) {
  const state = bridge.is_active
    ? bridge.is_online
      ? "online"
      : "offline"
    : "revoked";
  const label =
    state === "online"
      ? "Çevrimiçi"
      : state === "offline"
        ? "Çevrimdışı"
        : "Kaldırıldı";
  const tone =
    state === "online"
      ? "success"
      : state === "offline"
        ? "warning"
        : "neutral";

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 lg:flex-row lg:items-start">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          state === "online"
            ? "bg-emerald-500/10 text-emerald-700"
            : "bg-muted text-muted-foreground",
        )}
      >
        {state === "online" ? (
          <CheckCircle2 className="size-4" />
        ) : (
          <Laptop className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{bridge.name}</p>
          <StatusBadge tone={tone}>{label}</StatusBadge>
          {bridge.platform ? (
            <span className="text-xs text-muted-foreground">
              {platformLabel(bridge.platform)}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Son bağlantı:{" "}
          {bridge.last_seen_at
            ? new Date(bridge.last_seen_at).toLocaleString("tr-TR")
            : "Henüz heartbeat alınmadı"}
          {bridge.version ? ` · v${bridge.version}` : ""}
        </p>
        <div
          className="mt-2 flex flex-wrap gap-1.5"
          aria-label={`${bridge.name} işletim sistemi yazıcıları`}
        >
          {bridge.printer_inventory.length ? (
            bridge.printer_inventory.map((printer) => (
              <span
                key={printer}
                className="max-w-full truncate rounded-md border bg-muted/40 px-2 py-0.5 font-mono text-[0.68rem]"
                title={printer}
              >
                {printer}
              </span>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">
              Yazıcı listesi bekleniyor.
            </span>
          )}
        </div>
      </div>
      {bridge.is_active ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={onRevoke}
        >
          {pending ? <LoaderCircle className="animate-spin" /> : <Unlink />}
          Bağlantıyı kaldır
        </Button>
      ) : null}
    </div>
  );
}

function DeviceRow({
  device,
  stations,
  bridges,
  mapping,
  pending,
  onRoute,
  onPurposeChange,
  onToggle,
  onTest,
  onMappingChange,
}: {
  device: PrinterDevice;
  stations: Station[];
  bridges: PrintBridge[];
  mapping: PrintBridgePrinterMapping | undefined;
  pending: boolean;
  onRoute: (stationId: string) => void;
  onPurposeChange: (purpose: "PREPARATION" | "CASHIER") => void;
  onToggle: (active: boolean) => void;
  onTest: () => void;
  onMappingChange: (value: string) => void;
}) {
  const mappingValue = mapping
    ? createMappingValue(mapping.bridge_id, mapping.local_printer_name)
    : UNMAPPED_VALUE;
  const mappedBridge = mapping
    ? bridges.find((bridge) => bridge.id === mapping.bridge_id)
    : undefined;
  const canTest =
    Boolean(mapping && mappedBridge?.is_active && mappedBridge.is_online) &&
    device.is_active;

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
            <StatusBadge
              tone={device.purpose === "CASHIER" ? "warning" : "neutral"}
              dot={false}
            >
              {device.purpose === "CASHIER" ? "Kasa / hesap" : "Hazırlık"}
            </StatusBadge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {device.code} · {device.transport} ·{" "}
            {String(device.settings.paper_width ?? "-")} mm
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={device.is_active}
            disabled={pending}
            onCheckedChange={onToggle}
            aria-label={`${device.name} aktif`}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !canTest}
            onClick={onTest}
            title={
              canTest
                ? "Gerçek yerel yazıcıya test işi gönder"
                : "Önce çevrimiçi bir Bridge ve yerel yazıcı eşleştirin"
            }
          >
            {pending ? <LoaderCircle className="animate-spin" /> : <Printer />}
            Test çıktısı al
          </Button>
        </div>
      </div>
      <div className="mt-3 grid gap-2 pl-0 sm:pl-12 lg:grid-cols-3">
        <div className="flex min-w-0 items-center gap-2">
          <ReceiptText
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <Select
            items={[
              { value: "PREPARATION", label: "Hazırlık fişi" },
              { value: "CASHIER", label: "Kasa / hesap" },
            ]}
            value={device.purpose}
            onValueChange={(value) =>
              value && onPurposeChange(value as "PREPARATION" | "CASHIER")
            }
            disabled={pending}
          >
            <SelectTrigger className="h-9 w-full" aria-label="Yazıcı rolü">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PREPARATION">Hazırlık fişi</SelectItem>
              <SelectItem value="CASHIER">Kasa / hesap</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Route
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <Select
            items={[
              { value: "GENERAL", label: "Genel şube kuyruğu" },
              ...stations
                .filter((station) => station.is_active)
                .map((station) => ({ value: station.id, label: station.name })),
            ]}
            value={device.preparation_station_id ?? "GENERAL"}
            onValueChange={(value) => value && onRoute(value)}
            disabled={pending || device.purpose === "CASHIER"}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GENERAL">Genel şube kuyruğu</SelectItem>
              {stations
                .filter((station) => station.is_active)
                .map((station) => (
                  <SelectItem key={station.id} value={station.id}>
                    {station.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Link2
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <Select
            items={mappingItems(bridges)}
            value={mappingValue}
            onValueChange={(value) => value && onMappingChange(value)}
            disabled={pending}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNMAPPED_VALUE}>
                Yerel yazıcı eşleştirilmedi
              </SelectItem>
              {bridges
                .filter((bridge) => bridge.is_active)
                .flatMap((bridge) =>
                  bridge.printer_inventory.map((localPrinterName) => (
                    <SelectItem
                      key={createMappingValue(bridge.id, localPrinterName)}
                      value={createMappingValue(bridge.id, localPrinterName)}
                    >
                      {bridge.name} · {localPrinterName}
                    </SelectItem>
                  )),
                )}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function JobRow({
  job,
  devices,
  pending,
  onRetry,
}: {
  job: PrintJob;
  devices: PrinterDevice[];
  pending: boolean;
  onRetry: () => void;
}) {
  const printer = devices.find((device) => device.id === job.printer_device_id);
  const failed = job.status === "FAILED";
  return (
    <div className="border-b pb-3 last:border-0 last:pb-0">
      <div className="flex items-start gap-2">
        {failed ? (
          <TriangleAlert className="mt-0.5 size-4 text-destructive" />
        ) : (
          <Clock3 className="mt-0.5 size-4 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="truncate text-sm font-medium">
              {printer?.name ?? "Otomatik istasyon rotası"}
            </p>
            <StatusBadge tone={jobTone(job.status)}>
              {jobLabel(job.status)}
            </StatusBadge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            #{job.id.slice(0, 8)} ·{" "}
            {new Date(job.created_at).toLocaleString("tr-TR")}
          </p>
          {job.last_error ? (
            <p className="mt-1 text-xs text-destructive">{job.last_error}</p>
          ) : null}
          {job.manual_retry_required ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-amber-700 dark:text-amber-300">
                Fiziksel baskı sonucu belirsiz; otomatik tekrar kapatıldı.
              </span>
              <Button
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={onRetry}
              >
                {pending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <RotateCcw />
                )}
                Operatör olarak yeniden dene
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EnrollmentCodeDialog({
  enrollment,
  onClose,
}: {
  enrollment: PrintBridgeEnrollment | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={Boolean(enrollment)}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bridge bağlantı kodu</DialogTitle>
          <DialogDescription>
            Kodu şubedeki Print Bridge uygulamasına girin. Kod{" "}
            {enrollment
              ? new Date(enrollment.expires_at).toLocaleTimeString("tr-TR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : ""}{" "}
            saatine kadar bir kez kullanılabilir.
          </DialogDescription>
        </DialogHeader>
        {enrollment ? (
          <>
            <div className="flex items-center justify-between border-y py-4">
              <code className="font-mono text-xl font-semibold tracking-[0.08em]">
                {enrollment.code}
              </code>
              <Button
                size="icon-sm"
                variant="outline"
                onClick={() =>
                  void copyText(enrollment.code, "Bağlantı kodu kopyalandı.")
                }
                title="Bağlantı kodunu kopyala"
              >
                <Copy />
                <span className="sr-only">Bağlantı kodunu kopyala</span>
              </Button>
            </div>
            <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              <p>
                1. Bilgisayarınız için Print Bridge uygulamasını indirip kurun.
              </p>
              <p>2. Açılan Dixora Print Bridge uygulamasına bu kodu girin.</p>
              <p>
                3. Bağlantı tamamlanınca yerel yazıcıları bu ekrandan eşleyin.
              </p>
            </div>
          </>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
            Ürünleri mutfak, bar veya servis akışına yönlendirmek için istasyon
            oluşturun.
          </DialogDescription>
        </DialogHeader>
        <form
          id="station-create-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <div>
            <Label htmlFor="station-name">İstasyon adı</Label>
            <Input
              id="station-name"
              className="mt-1.5"
              placeholder="Sıcak mutfak"
              {...form.register("name")}
            />
            <FieldError>{form.formState.errors.name?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="station-code">İstasyon kodu</Label>
            <Input
              id="station-code"
              className="mt-1.5 uppercase"
              placeholder="HOT-KITCHEN"
              {...form.register("code")}
            />
            <FieldError>{form.formState.errors.code?.message}</FieldError>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="station-create-form" disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}
            İstasyonu kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    defaultValues: {
      name: "",
      code: "",
      purpose: "PREPARATION",
      preparation_station_id: "GENERAL",
      paper_width: "80",
    },
  });
  const purpose = useWatch({ control: form.control, name: "purpose" });
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yazıcı cihazı ekle</DialogTitle>
          <DialogDescription>
            Bu kayıt, hazırlık veya hesap çıktısının hangi yerel yazıcıya
            gideceğini belirler.
          </DialogDescription>
        </DialogHeader>
        <form
          id="printer-create-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <div>
            <Label htmlFor="printer-name">Cihaz adı</Label>
            <Input
              id="printer-name"
              className="mt-1.5"
              {...form.register("name")}
            />
            <FieldError>{form.formState.errors.name?.message}</FieldError>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="printer-code">Cihaz kodu</Label>
              <Input
                id="printer-code"
                className="mt-1.5 uppercase"
                placeholder="MUTFAK"
                {...form.register("code")}
              />
              <FieldError>{form.formState.errors.code?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="printer-width">Kağıt genişliği</Label>
              <select
                id="printer-width"
                className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm"
                {...form.register("paper_width")}
              >
                <option value="80">80 mm</option>
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="printer-purpose">Rol</Label>
            <Select
              items={[
                { value: "PREPARATION", label: "Mutfak / bar hazırlık fişi" },
                { value: "CASHIER", label: "Kasa / hesap fişi" },
              ]}
              value={purpose}
              onValueChange={(value) => {
                if (!value) return;
                form.setValue("purpose", value as PrinterValues["purpose"], {
                  shouldDirty: true,
                });
                if (value === "CASHIER") {
                  form.setValue("preparation_station_id", "GENERAL");
                }
              }}
            >
              <SelectTrigger id="printer-purpose" className="mt-1.5 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PREPARATION">
                  Mutfak / bar hazırlık fişi
                </SelectItem>
                <SelectItem value="CASHIER">Kasa / hesap fişi</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="printer-station">Yönlendirilen istasyon</Label>
            <select
              id="printer-station"
              className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm"
              disabled={purpose === "CASHIER"}
              {...form.register("preparation_station_id")}
            >
              <option value="GENERAL">Genel şube kuyruğu</option>
              {stations
                .filter((station) => station.is_active)
                .map((station) => (
                  <option key={station.id} value={station.id}>
                    {station.name}
                  </option>
                ))}
            </select>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="printer-create-form" disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}
            Cihazı kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function createMappingValue(
  bridgeId: string,
  localPrinterName: string,
): string {
  return `${bridgeId}|${encodeURIComponent(localPrinterName)}`;
}

function parseMappingValue(
  value: string,
): { bridgeId: string; localPrinterName: string } | null {
  const separator = value.indexOf("|");
  if (separator <= 0) return null;
  try {
    return {
      bridgeId: value.slice(0, separator),
      localPrinterName: decodeURIComponent(value.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

function mappingItems(
  bridges: PrintBridge[],
): Array<{ value: string; label: string }> {
  return [
    { value: UNMAPPED_VALUE, label: "Yerel yazıcı eşleştirilmedi" },
    ...bridges
      .filter((bridge) => bridge.is_active)
      .flatMap((bridge) =>
        bridge.printer_inventory.map((localPrinterName) => ({
          value: createMappingValue(bridge.id, localPrinterName),
          label: `${bridge.name} · ${localPrinterName}`,
        })),
      ),
  ];
}

function platformLabel(platform: string): string {
  if (platform === "windows") return "Windows";
  if (platform === "macos") return "macOS";
  return platform;
}

async function downloadInstaller(platform: "windows" | "macos"): Promise<void> {
  const installer =
    platform === "windows"
      ? "/downloads/Dixora-Print-Bridge-Setup.exe"
      : "/downloads/Dixora-Print-Bridge.dmg";
  try {
    const response = await fetch(installer, {
      method: "HEAD",
      cache: "no-store",
    });
    if (!response.ok) {
      toast.error(
        platform === "macos"
          ? "macOS masaüstü paketi henüz yayımlanmadı. Paketi macOS üzerinde oluşturup web imajını yenileyin."
          : "Windows kurulum paketi bulunamadı.",
      );
      return;
    }
  } catch {
    toast.error("Kurulum paketi denetlenemedi.");
    return;
  }
  const link = document.createElement("a");
  link.href = installer;
  link.download =
    platform === "windows"
      ? "Dixora-Print-Bridge-Setup.exe"
      : "Dixora-Print-Bridge.dmg";
  document.body.append(link);
  link.click();
  link.remove();
}

async function copyText(value: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error("Panoya kopyalanamadı.");
  }
}

function jobLabel(status: PrintJob["status"]) {
  return {
    PENDING: "Bekliyor",
    CLAIMED: "Alındı",
    SENT: "Gönderildi",
    PRINTED: "Yazdırıldı",
    FAILED: "Hata",
    CANCELLED: "İptal",
  }[status];
}

function jobTone(status: PrintJob["status"]) {
  if (status === "PRINTED") return "success" as const;
  if (status === "FAILED" || status === "CANCELLED") return "danger" as const;
  if (status === "PENDING") return "warning" as const;
  return "info" as const;
}
