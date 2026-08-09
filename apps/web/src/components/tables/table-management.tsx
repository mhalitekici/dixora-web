"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Grid2X2,
  Loader2,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  QrCode,
  RotateCcw,
  Settings2,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { DataToolbar } from "@/components/shared/data-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentUser } from "@/hooks/use-auth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type TableState =
  | "AVAILABLE"
  | "OCCUPIED"
  | "ORDER_PENDING"
  | "PREPARING"
  | "READY"
  | "BILL_REQUESTED"
  | "PAYMENT_PENDING"
  | "CLEANING"
  | "DISABLED";

type Area = {
  id: string;
  name: string;
  sort_order?: number;
  is_active?: boolean;
};

type RestaurantTable = {
  id: string;
  area_id: string;
  name: string;
  capacity: number;
  state: TableState;
  current_total?: string | number | null;
  guest_count?: number | null;
  customer_name?: string | null;
  occupied_since?: string | null;
  qr_token?: string;
  is_active: boolean;
  sort_order?: number;
};

const tableSchema = z.object({
  name: z.string().trim().min(1, "Masa adı gerekli.").max(24),
  area_id: z.string().min(1, "Alan seçin."),
  capacity: z.coerce.number().int().min(1).max(50),
  is_active: z.boolean(),
});

type TableFormValues = z.infer<typeof tableSchema>;

const areaSchema = z.object({
  name: z.string().trim().min(1, "Alan adı gerekli.").max(100),
  sort_order: z.coerce
    .number()
    .int("Sıra tam sayı olmalı.")
    .min(0, "Sıra negatif olamaz.")
    .max(10_000),
});

type AreaFormValues = z.infer<typeof areaSchema>;

function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object" && "items" in payload) {
    const items = (payload as { items?: unknown }).items;
    return Array.isArray(items) ? (items as T[]) : [];
  }
  return [];
}

class ApiRequestError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await response.json().catch(() => null)) as
    | T
    | {
        detail?: unknown;
        message?: string;
        error?: { code?: string; message?: string };
      }
    | null;
  if (!response.ok) {
    const error = data as {
      detail?: unknown;
      message?: string;
      error?: { code?: string; message?: string };
    } | null;
    const detail =
      typeof error?.detail === "string" ? error.detail : undefined;
    throw new ApiRequestError(
      error?.error?.message ??
        detail ??
        error?.message ??
        "İşlem tamamlanamadı.",
      response.status,
      error?.error?.code,
    );
  }
  return data as T;
}

const stateMeta: Record<
  TableState,
  { label: string; tone: Parameters<typeof StatusBadge>[0]["tone"]; border: string; accent: string }
> = {
  AVAILABLE: {
    label: "Müsait",
    tone: "neutral",
    border: "hover:border-emerald-600/25",
    accent: "bg-emerald-500",
  },
  OCCUPIED: {
    label: "Oturum açık",
    tone: "info",
    border: "border-blue-600/20",
    accent: "bg-blue-500",
  },
  ORDER_PENDING: {
    label: "Sipariş bekliyor",
    tone: "warning",
    border: "border-amber-600/20",
    accent: "bg-amber-500",
  },
  PREPARING: {
    label: "Hazırlanıyor",
    tone: "brand",
    border: "border-brand/25",
    accent: "bg-brand",
  },
  READY: {
    label: "Hazır",
    tone: "success",
    border: "border-emerald-600/30",
    accent: "bg-emerald-500",
  },
  BILL_REQUESTED: {
    label: "Hesap istendi",
    tone: "purple",
    border: "border-violet-600/25",
    accent: "bg-violet-500",
  },
  PAYMENT_PENDING: {
    label: "Ödeme bekliyor",
    tone: "purple",
    border: "border-violet-600/25",
    accent: "bg-violet-500",
  },
  CLEANING: {
    label: "Temizleniyor",
    tone: "info",
    border: "border-cyan-600/20",
    accent: "bg-cyan-500",
  },
  DISABLED: {
    label: "Devre dışı",
    tone: "danger",
    border: "opacity-65",
    accent: "bg-red-500",
  },
};

function durationLabel(value?: string | null) {
  if (!value) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  return `${minutes} dk`;
}

function money(value?: string | number | null) {
  if (value === undefined || value === null) return null;
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export function TableManagement() {
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const [activeArea, setActiveArea] = useState("all");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"all" | TableState>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RestaurantTable | null>(null);
  const [areasDialogOpen, setAreasDialogOpen] = useState(false);
  const [areaEditorOpen, setAreaEditorOpen] = useState(false);
  const [editingArea, setEditingArea] = useState<Area | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Area | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const form = useForm<TableFormValues>({
    resolver: zodResolver(tableSchema),
    defaultValues: { name: "", area_id: "", capacity: 4, is_active: true },
  });
  const formValues = useWatch({ control: form.control });
  const areaForm = useForm<AreaFormValues>({
    resolver: zodResolver(areaSchema),
    defaultValues: { name: "", sort_order: 0 },
  });

  const areasQuery = useQuery({
    queryKey: ["areas"],
    queryFn: async () =>
      unwrapList<Area>(await fetchJson<unknown>("/tables/areas")),
    staleTime: 20_000,
  });

  const tablesQuery = useQuery({
    queryKey: ["tables"],
    queryFn: async () =>
      unwrapList<RestaurantTable>(await fetchJson<unknown>("/tables")),
    staleTime: 8_000,
    refetchInterval: 20_000,
  });

  const areas = areasQuery.data ?? [];
  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (values: TableFormValues) => {
      if (editing) {
        return fetchJson<RestaurantTable>(`/tables/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(values),
        });
      }
      return fetchJson<RestaurantTable>("/tables", {
        method: "POST",
        body: JSON.stringify(values),
      });
    },
    onSuccess: () => {
      toast.success(editing ? "Masa güncellendi" : "Masa oluşturuldu");
      setDialogOpen(false);
      setEditing(null);
      form.reset();
      void queryClient.invalidateQueries({ queryKey: ["tables"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Masa kaydedilemedi."),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ table, isActive }: { table: RestaurantTable; isActive: boolean }) => {
      return fetchJson<RestaurantTable>(`/tables/${table.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          is_active: isActive,
          state: isActive ? "AVAILABLE" : "DISABLED",
        }),
      });
    },
    onSuccess: () => {
      toast.success("Masa durumu güncellendi");
      void queryClient.invalidateQueries({ queryKey: ["tables"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Durum güncellenemedi."),
  });

  const sortMutation = useMutation({
    mutationFn: async ({
      table,
      direction,
    }: {
      table: RestaurantTable;
      direction: -1 | 1;
    }) => {
      return fetchJson<RestaurantTable>(`/tables/${table.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          sort_order: Math.max(0, (table.sort_order ?? 0) + direction),
        }),
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["tables"] }),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Masa sırası güncellenemedi."),
  });

  const areaSaveMutation = useMutation({
    mutationFn: async (values: AreaFormValues) => {
      if (editingArea) {
        return fetchJson<Area>(`/tables/areas/${editingArea.id}`, {
          method: "PATCH",
          body: JSON.stringify(values),
        });
      }
      return fetchJson<Area>("/tables/areas", {
        method: "POST",
        body: JSON.stringify(values),
      });
    },
    onSuccess: async () => {
      toast.success(editingArea ? "Alan güncellendi" : "Alan oluşturuldu");
      setAreaEditorOpen(false);
      setEditingArea(null);
      areaForm.reset({ name: "", sort_order: 0 });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["areas"] }),
        queryClient.invalidateQueries({ queryKey: ["tables"] }),
      ]);
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Alan kaydedilemedi.",
      ),
  });

  const archiveAreaMutation = useMutation({
    mutationFn: async (area: Area) => {
      await fetchJson<void>(`/tables/areas/${area.id}`, {
        method: "DELETE",
      });
    },
    onMutate: () => setArchiveError(null),
    onSuccess: async (_data, area) => {
      toast.success(`${area.name} alanı arşivlendi`);
      setArchiveTarget(null);
      setArchiveError(null);
      if (activeArea === area.id) setActiveArea("all");
      if (editingArea?.id === area.id) {
        setEditingArea(null);
        setAreaEditorOpen(false);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["areas"] }),
        queryClient.invalidateQueries({ queryKey: ["tables"] }),
      ]);
    },
    onError: (error) => {
      const message =
        error instanceof ApiRequestError &&
        (error.status === 409 || error.code === "area_not_empty")
          ? "Bu alanda aktif masalar bulunuyor. Arşivlemeden önce masaları başka bir alana taşıyın veya devre dışı bırakın."
          : error instanceof Error
            ? error.message
            : "Alan arşivlenemedi.";
      setArchiveError(message);
      toast.error("Alan arşivlenemedi", { description: message });
    },
  });

  const filteredTables = useMemo(
    () =>
      tables.filter((table) => {
        const areaMatch = activeArea === "all" || table.area_id === activeArea;
        const stateMatch = stateFilter === "all" || table.state === stateFilter;
        const searchMatch =
          table.name.toLocaleLowerCase("tr-TR").includes(search.toLocaleLowerCase("tr-TR")) ||
          table.customer_name?.toLocaleLowerCase("tr-TR").includes(search.toLocaleLowerCase("tr-TR"));
        return areaMatch && stateMatch && searchMatch;
      }),
    [activeArea, search, stateFilter, tables],
  );

  const counts = useMemo(
    () => ({
      available: tables.filter((table) => table.state === "AVAILABLE").length,
      active: tables.filter((table) => !["AVAILABLE", "DISABLED"].includes(table.state)).length,
      bill: tables.filter((table) =>
        ["BILL_REQUESTED", "PAYMENT_PENDING"].includes(table.state),
      ).length,
    }),
    [tables],
  );

  function openCreate() {
    setEditing(null);
    form.reset({
      name: "",
      area_id: activeArea === "all" ? areas[0]?.id ?? "" : activeArea,
      capacity: 4,
      is_active: true,
    });
    setDialogOpen(true);
  }

  function openEdit(table: RestaurantTable) {
    setEditing(table);
    form.reset({
      name: table.name,
      area_id: table.area_id,
      capacity: table.capacity,
      is_active: table.is_active,
    });
    setDialogOpen(true);
  }

  function openCreateArea() {
    const nextSortOrder =
      areas.length > 0
        ? Math.max(...areas.map((area) => area.sort_order ?? 0)) + 1
        : 0;
    setEditingArea(null);
    areaForm.reset({ name: "", sort_order: nextSortOrder });
    setAreaEditorOpen(true);
  }

  function openEditArea(area: Area) {
    setEditingArea(area);
    areaForm.reset({
      name: area.name,
      sort_order: area.sort_order ?? 0,
    });
    setAreaEditorOpen(true);
  }

  function requestAreaArchive(area: Area) {
    setArchiveError(null);
    setArchiveTarget(area);
  }

  const dataLoading = areasQuery.isLoading || tablesQuery.isLoading;
  const dataError = areasQuery.error ?? tablesQuery.error;
  const dataRefreshing = areasQuery.isFetching || tablesQuery.isFetching;

  if (dataLoading) {
    return (
      <>
        <PageHeader
          eyebrow="Alan ve masa yönetimi"
          title="Canlı masa planı"
          description="Masa durumlarını gerçek zamanlı izleyin; alan, kapasite, QR erişimi ve kullanım durumunu yönetin."
          icon={Grid2X2}
        />
        <div className="flex min-h-72 items-center justify-center" role="status">
          <Loader2 className="size-6 animate-spin text-brand" />
          <span className="sr-only">Masa planı yükleniyor</span>
        </div>
      </>
    );
  }

  if (dataError) {
    return (
      <>
        <PageHeader
          eyebrow="Alan ve masa yönetimi"
          title="Canlı masa planı"
          description="Masa durumlarını gerçek zamanlı izleyin; alan, kapasite, QR erişimi ve kullanım durumunu yönetin."
          icon={Grid2X2}
        />
        <EmptyState
          title="Masa planı yüklenemedi"
          description="Alan veya masa verilerine ulaşılamıyor. Bağlantınızı kontrol edip yeniden deneyin."
          icon={AlertTriangle}
          action={
            <Button
              variant="outline"
              disabled={dataRefreshing}
              onClick={() => {
                void Promise.all([areasQuery.refetch(), tablesQuery.refetch()]);
              }}
            >
              {dataRefreshing ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RotateCcw />
              )}
              Yeniden dene
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Alan ve masa yönetimi"
        title="Canlı masa planı"
        description="Masa durumlarını gerçek zamanlı izleyin; alan, kapasite, QR erişimi ve kullanım durumunu yönetin."
        icon={Grid2X2}
        actions={
          <>
            <StatusBadge tone="success" pulse className="h-9 rounded-xl px-3">
              Canlı
            </StatusBadge>
            <Button
              variant="outline"
              className="h-10 rounded-xl"
              onClick={() => setAreasDialogOpen(true)}
              disabled={areasQuery.isLoading}
            >
              <Settings2 />
              Alanları yönet
            </Button>
            <Button
              className="h-10 rounded-xl"
              onClick={openCreate}
              disabled={areas.length === 0}
            >
              <Plus />
              Yeni masa
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          ["Müsait", counts.available, "bg-emerald-500"],
          ["Aktif", counts.active, "bg-brand"],
          ["Hesap bekliyor", counts.bill, "bg-violet-500"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="flex items-center gap-3 rounded-2xl border bg-card p-3.5">
            <span className={cn("size-2.5 rounded-full", String(color))} />
            <div>
              <p className="text-lg font-semibold tabular-nums">{String(value)}</p>
              <p className="text-[0.68rem] text-muted-foreground">{String(label)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-4 overflow-x-auto rounded-2xl border bg-card p-2">
        <div className="flex min-w-max gap-1">
          <button
            type="button"
            onClick={() => setActiveArea("all")}
            className={cn(
              "h-10 rounded-xl px-4 text-sm font-semibold transition-colors",
              activeArea === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            Tüm alanlar
            <span className="ml-2 text-xs opacity-55">{tables.length}</span>
          </button>
          {areas.map((area) => {
            const count = tables.filter((table) => table.area_id === area.id).length;
            return (
              <button
                key={area.id}
                type="button"
                onClick={() => setActiveArea(area.id)}
                className={cn(
                  "h-10 rounded-xl px-4 text-sm font-semibold transition-colors",
                  activeArea === area.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {area.name}
                <span className="ml-2 text-xs opacity-55">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <DataToolbar
        value={search}
        onValueChange={setSearch}
        placeholder="Masa veya müşteri adı ara…"
        filters={
          <Select value={stateFilter} onValueChange={(value) => setStateFilter(value as typeof stateFilter)}>
            <SelectTrigger className="h-10 min-w-44 rounded-xl">
              <SelectValue placeholder="Tüm durumlar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm durumlar</SelectItem>
              {(Object.entries(stateMeta) as Array<[TableState, (typeof stateMeta)[TableState]]>).map(
                ([state, meta]) => (
                  <SelectItem key={state} value={state}>
                    {meta.label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        }
      />

      {tablesQuery.isLoading ? (
        <div className="flex min-h-72 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-brand" />
        </div>
      ) : filteredTables.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filteredTables.map((table) => {
            const meta = stateMeta[table.state] ?? stateMeta.AVAILABLE;
            return (
              <article
                key={table.id}
                className={cn(
                  "relative overflow-hidden rounded-2xl border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5",
                  meta.border,
                )}
              >
                <span className={cn("absolute inset-x-0 top-0 h-1", meta.accent)} />
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-bold tracking-[-0.03em]">{table.name}</h3>
                      {table.customer_name ? (
                        <span className="max-w-20 truncate text-xs text-muted-foreground">
                          · {table.customer_name}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-[0.68rem] text-muted-foreground">
                      <Users className="size-3" />
                      {table.guest_count ?? 0}/{table.capacity}
                      {durationLabel(table.occupied_since) ? (
                        <>
                          <span>·</span>
                          <span>{durationLabel(table.occupied_since)}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon-sm" aria-label={`${table.name} işlemleri`} />
                      }
                    >
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => openEdit(table)}
                      >
                        <Settings2 />
                        Düzenle
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          void navigator.clipboard?.writeText(
                            `${window.location.origin}/m/${encodeURIComponent(currentUser.data?.tenant?.slug ?? "")}/${encodeURIComponent(currentUser.data?.branch?.slug ?? process.env.NEXT_PUBLIC_QR_BRANCH_SLUG ?? "merkez")}/table/${encodeURIComponent(table.qr_token ?? table.id)}`,
                          );
                          toast.success("QR bağlantısı kopyalandı");
                        }}
                      >
                        <Copy />
                        QR bağlantısını kopyala
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant={table.is_active ? "destructive" : "default"}
                        disabled={statusMutation.isPending}
                        onClick={() => statusMutation.mutate({ table, isActive: !table.is_active })}
                      >
                        <RotateCcw />
                        {table.is_active ? "Devre dışı bırak" : "Yeniden etkinleştir"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="mt-5 flex items-center justify-between gap-2">
                  <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                  {money(table.current_total) ? (
                    <span className="text-sm font-semibold tabular-nums">{money(table.current_total)}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Hesap yok</span>
                  )}
                </div>
                <div className="mt-4 grid grid-cols-[1fr_auto_auto] gap-2 border-t pt-3">
                  <Button
                    variant={table.state === "AVAILABLE" ? "default" : "outline"}
                    className="h-9 min-w-0 rounded-xl"
                    onClick={() => openEdit(table)}
                  >
                    {table.state === "AVAILABLE" ? "Düzenle" : "Detay"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 rounded-xl"
                    aria-label="Yukarı taşı"
                    disabled={sortMutation.isPending}
                    onClick={() => sortMutation.mutate({ table, direction: -1 })}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 rounded-xl"
                    aria-label="Aşağı taşı"
                    disabled={sortMutation.isPending}
                    onClick={() => sortMutation.mutate({ table, direction: 1 })}
                  >
                    <ArrowDown />
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-4">
          <EmptyState
            title="Bu filtrede masa yok"
            description="Arama veya durum filtresini temizleyin ya da seçili alana yeni bir masa ekleyin."
            icon={Grid2X2}
            action={
              <Button
                className="h-10 rounded-xl"
                onClick={openCreate}
                disabled={areas.length === 0}
              >
                <Plus />
                Yeni masa
              </Button>
            }
          />
        </div>
      )}

      <Dialog
        open={areasDialogOpen}
        onOpenChange={(open) => {
          if (areaSaveMutation.isPending) return;
          setAreasDialogOpen(open);
          if (!open) {
            setAreaEditorOpen(false);
            setEditingArea(null);
            areaForm.reset({ name: "", sort_order: 0 });
          }
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Alanları yönet</DialogTitle>
            <DialogDescription>
              Şubenin servis alanlarını oluşturun, görünüm sırasını düzenleyin
              veya kullanılmayan alanları arşivleyin.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
            <section className="min-w-0 rounded-2xl border bg-card">
              <div className="flex items-center justify-between gap-3 border-b p-3">
                <div>
                  <h3 className="text-sm font-semibold">Aktif alanlar</h3>
                  <p className="text-[0.66rem] text-muted-foreground">
                    {areas.length} alan · {tables.length} masa
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="rounded-lg"
                  disabled={areaSaveMutation.isPending}
                  onClick={openCreateArea}
                >
                  <Plus />
                  Yeni alan
                </Button>
              </div>

              {areasQuery.isLoading ? (
                <div className="flex min-h-52 items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-brand" />
                </div>
              ) : areas.length ? (
                <div className="max-h-[48dvh] space-y-2 overflow-y-auto p-3">
                  {areas.map((area) => {
                    const activeTableCount = tables.filter(
                      (table) => table.area_id === area.id && table.is_active,
                    ).length;
                    return (
                      <article
                        key={area.id}
                        className={cn(
                          "flex items-center gap-3 rounded-xl border p-3 transition-colors",
                          editingArea?.id === area.id
                            ? "border-brand/30 bg-brand-soft/45"
                            : "bg-background",
                        )}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <MapPin className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">
                            {area.name}
                          </p>
                          <p className="text-[0.66rem] text-muted-foreground">
                            Sıra {area.sort_order ?? 0} · {activeTableCount} aktif
                            masa
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${area.name} alanını düzenle`}
                          disabled={areaSaveMutation.isPending}
                          onClick={() => openEditArea(area)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`${area.name} alanını arşivle`}
                          disabled={
                            areaSaveMutation.isPending ||
                            archiveAreaMutation.isPending
                          }
                          onClick={() => requestAreaArchive(area)}
                        >
                          <Archive />
                        </Button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="p-3">
                  <EmptyState
                    compact
                    title="Aktif alan bulunmuyor"
                    description="Masa oluşturmadan önce ilk servis alanını ekleyin."
                    icon={MapPin}
                    action={
                      <Button
                        type="button"
                        size="sm"
                        onClick={openCreateArea}
                      >
                        <Plus />
                        İlk alanı oluştur
                      </Button>
                    }
                  />
                </div>
              )}
            </section>

            {areaEditorOpen ? (
              <section className="rounded-2xl border bg-muted/25 p-4">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold">
                    {editingArea ? "Alanı düzenle" : "Yeni alan"}
                  </h3>
                  <p className="mt-1 text-[0.66rem] text-muted-foreground">
                    Sıra değeri düşük olan alan önce görünür.
                  </p>
                </div>
                <form
                  id="area-form"
                  className="space-y-4"
                  onSubmit={areaForm.handleSubmit((values) =>
                    areaSaveMutation.mutate(values),
                  )}
                >
                  <div className="space-y-2">
                    <Label htmlFor="area-name">Alan adı</Label>
                    <Input
                      id="area-name"
                      className="h-11 rounded-xl bg-card"
                      placeholder="Örn. Teras"
                      autoFocus
                      aria-invalid={Boolean(areaForm.formState.errors.name)}
                      {...areaForm.register("name")}
                    />
                    {areaForm.formState.errors.name ? (
                      <p className="text-xs text-destructive">
                        {areaForm.formState.errors.name.message}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="area-sort-order">Görünüm sırası</Label>
                    <Input
                      id="area-sort-order"
                      type="number"
                      min={0}
                      max={10_000}
                      className="h-11 rounded-xl bg-card"
                      aria-invalid={Boolean(
                        areaForm.formState.errors.sort_order,
                      )}
                      {...areaForm.register("sort_order")}
                    />
                    {areaForm.formState.errors.sort_order ? (
                      <p className="text-xs text-destructive">
                        {areaForm.formState.errors.sort_order.message}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={areaSaveMutation.isPending}
                      onClick={() => {
                        setAreaEditorOpen(false);
                        setEditingArea(null);
                        areaForm.reset({ name: "", sort_order: 0 });
                      }}
                    >
                      Vazgeç
                    </Button>
                    <Button
                      type="submit"
                      disabled={areaSaveMutation.isPending}
                    >
                      {areaSaveMutation.isPending ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Check />
                      )}
                      {editingArea ? "Değişiklikleri kaydet" : "Alanı oluştur"}
                    </Button>
                  </div>
                </form>
              </section>
            ) : (
              <EmptyState
                compact
                title="Bir alan seçin"
                description="Düzenlemek için listeden bir alan seçin veya yeni alan oluşturun."
                icon={Settings2}
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openCreateArea}
                  >
                    <Plus />
                    Yeni alan
                  </Button>
                }
              />
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={areaSaveMutation.isPending}
              onClick={() => {
                setAreasDialogOpen(false);
                setAreaEditorOpen(false);
                setEditingArea(null);
                areaForm.reset({ name: "", sort_order: 0 });
              }}
            >
              Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (archiveAreaMutation.isPending) return;
          if (!open) {
            setArchiveTarget(null);
            setArchiveError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Alanı arşivle</DialogTitle>
            <DialogDescription>
              {archiveTarget
                ? `${archiveTarget.name} alanı aktif alan listesinden kaldırılacak.`
                : "Seçili alan aktif alan listesinden kaldırılacak."}
            </DialogDescription>
          </DialogHeader>

          {archiveTarget ? (
            <div className="space-y-3">
              <div className="flex gap-3 rounded-xl bg-amber-500/8 p-3 text-xs leading-5 text-amber-800 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Bu alanda{" "}
                  <strong>
                    {
                      tables.filter(
                        (table) =>
                          table.area_id === archiveTarget.id && table.is_active,
                      ).length
                    }{" "}
                    aktif masa
                  </strong>{" "}
                  bulunuyor. Aktif masası olan alanlar API tarafından
                  arşivlenmez.
                </span>
              </div>
              {archiveError ? (
                <div
                  role="alert"
                  className="flex gap-3 rounded-xl bg-destructive/8 p-3 text-xs leading-5 text-destructive"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {archiveError}
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={archiveAreaMutation.isPending}
              onClick={() => {
                setArchiveTarget(null);
                setArchiveError(null);
              }}
            >
              Vazgeç
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                !archiveTarget ||
                archiveAreaMutation.isPending
              }
              onClick={() => {
                if (archiveTarget) archiveAreaMutation.mutate(archiveTarget);
              }}
            >
              {archiveAreaMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Archive />
              )}
              Alanı arşivle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `${editing.name} masasını düzenle` : "Yeni masa oluştur"}</DialogTitle>
            <DialogDescription>
              Masa kimliği, alanı ve kapasitesi tüm operasyon ekranlarında aynı kaydı kullanır.
            </DialogDescription>
          </DialogHeader>
          <form
            id="table-form"
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
          >
            <div className="space-y-2">
              <Label htmlFor="table-name">Masa adı veya numarası</Label>
              <Input
                id="table-name"
                className="h-11 rounded-xl"
                placeholder="Örn. R12"
                autoFocus
                aria-invalid={Boolean(form.formState.errors.name)}
                {...form.register("name")}
              />
              {form.formState.errors.name ? (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              ) : null}
            </div>
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div className="space-y-2">
                <Label>Alan</Label>
                <Select
                  value={formValues.area_id}
                  onValueChange={(value) =>
                    form.setValue("area_id", value ?? "", {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger className="h-11 w-full rounded-xl">
                    <SelectValue placeholder="Alan seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {areas.map((area) => (
                      <SelectItem key={area.id} value={area.id}>
                        {area.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="capacity">Kapasite</Label>
                <Input
                  id="capacity"
                  type="number"
                  min={1}
                  max={50}
                  className="h-11 rounded-xl"
                  {...form.register("capacity")}
                />
              </div>
            </div>
            <label className="flex items-center justify-between rounded-xl border p-3">
              <span>
                <span className="block text-sm font-semibold">Aktif masa</span>
                <span className="block text-xs text-muted-foreground">Operasyon ekranlarında görünür.</span>
              </span>
              <Switch
                checked={Boolean(formValues.is_active)}
                onCheckedChange={(checked) => form.setValue("is_active", checked)}
              />
            </label>
            {editing ? (
              <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3">
                <QrCode className="size-4 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold">Güvenli masa QR kimliği</p>
                  <p className="truncate text-[0.66rem] text-muted-foreground">
                    {editing.qr_token ?? "İlk kayıt sırasında üretilecek"}
                  </p>
                </div>
              </div>
            ) : null}
          </form>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>
              Vazgeç
            </Button>
            <Button
              form="table-form"
              type="submit"
              disabled={saveMutation.isPending || areas.length === 0}
            >
              {saveMutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
              {editing ? "Değişiklikleri kaydet" : "Masayı oluştur"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
