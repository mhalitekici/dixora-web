"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Building2,
  Clock3,
  LoaderCircle,
  MapPin,
  Plus,
  Save,
  Store,
} from "lucide-react";
import { useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { adminApi, adminKeys } from "./admin-api";
import { ErrorState, FieldError, LoadingState } from "./admin-utils";
import type { Branch, DayHours, WorkingHours } from "./types";

const branchSchema = z.object({
  name: z.string().trim().min(2, "Şube adı en az 2 karakter olmalı.").max(160),
  slug: z
    .string()
    .trim()
    .min(2, "Slug en az 2 karakter olmalı.")
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Küçük harf, rakam ve tire kullanın."),
  timezone: z.string().trim().min(3, "Saat dilimi girin.").max(80),
  address: z.string().trim().max(500, "Adres en fazla 500 karakter olabilir."),
  phone: z.union([
    z.literal(""),
    z.string().trim().regex(/^[0-9+()\s.-]{7,32}$/, "Geçerli bir telefon girin."),
  ]),
});

type BranchValues = z.infer<typeof branchSchema>;
type DayKey = keyof WorkingHours;

const days: Array<{ key: DayKey; label: string }> = [
  { key: "monday", label: "Pazartesi" },
  { key: "tuesday", label: "Salı" },
  { key: "wednesday", label: "Çarşamba" },
  { key: "thursday", label: "Perşembe" },
  { key: "friday", label: "Cuma" },
  { key: "saturday", label: "Cumartesi" },
  { key: "sunday", label: "Pazar" },
];

export function BranchSettings() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const branchesQuery = useQuery({
    queryKey: adminKeys.branches(),
    queryFn: ({ signal }) => adminApi.branches(signal),
  });
  const usageQuery = useQuery({
    queryKey: adminKeys.branchUsage(),
    queryFn: ({ signal }) => adminApi.branchUsage(signal),
  });
  const pricingQuery = useQuery({
    queryKey: adminKeys.branchPricing(),
    queryFn: ({ signal }) => adminApi.branchPricing(signal),
  });
  const branches = branchesQuery.data ?? [];
  const selected = branches.find((branch) => branch.id === selectedId) ?? branches[0];

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.branches() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.branchUsage() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.branchPricing() }),
    ]);
  const createMutation = useMutation({
    mutationFn: adminApi.createBranch,
    onSuccess: async (branch) => {
      setSelectedId(branch.id);
      setCreateOpen(false);
      toast.success("Şube oluşturuldu.");
      await invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Şube oluşturulamadı."),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof adminApi.updateBranch>[1] }) =>
      adminApi.updateBranch(id, input),
    onSuccess: async () => {
      toast.success("Şube bilgileri güncellendi.");
      await invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Şube güncellenemedi."),
  });

  const archiveMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      adminApi.archiveBranch(id, reason),
    onSuccess: async () => {
      toast.success("Şube arşivlendi. Geçmiş kayıtları korunuyor.");
      await invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Şube arşivlenemedi."),
  });
  const restoreMutation = useMutation({
    mutationFn: (id: string) => adminApi.restoreBranch(id),
    onSuccess: async () => {
      toast.success("Şube yeniden açıldı.");
      await invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Şube geri alınamadı."),
  });

  const error = branchesQuery.error ?? usageQuery.error;
  if (branchesQuery.isLoading || usageQuery.isLoading) {
    return <LoadingState label="Şubeler yükleniyor…" />;
  }
  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void branchesQuery.refetch();
          void usageQuery.refetch();
        }}
      />
    );
  }

  const usage = usageQuery.data;
  const pricing = pricingQuery.data;
  const limitLabel = usage?.max_branches === null ? "Sınırsız" : `${usage?.active_branches ?? 0}/${usage?.max_branches ?? 0}`;
  const money = (value: string | number | undefined) =>
    value === undefined
      ? "—"
      : new Intl.NumberFormat("tr-TR", {
          style: "currency",
          currency: pricing?.currency ?? "TRY",
          minimumFractionDigits: 2,
        }).format(Number(value));

  return (
    <>
      <PageHeader
        eyebrow="Operasyon yapılandırması"
        title="Şubeler"
        description="Şube iletişimi, çalışma saatleri ve operasyon durumunu paket sınırlarıyla birlikte yönetin."
        icon={Store}
        actions={
          <Button disabled={!usage?.can_create} onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            Şube ekle
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Summary label="Paket" value={usage?.plan_name ?? "Plan yok"} icon={Building2} />
        <Summary label="Aktif şube limiti" value={limitLabel} icon={MapPin} />
        <Summary label="Toplam kayıt" value={String(usage?.total_branches ?? 0)} icon={Store} />
      </div>

      {pricing && Number(pricing.base_monthly_price) > 0 ? (
        <div className="mb-4 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Aylık abonelik tutarı</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {pricing.included_branches} şube pakete dahil · {pricing.active_branches} aktif şube
                {pricing.billable_extra_branches > 0
                  ? ` · ${pricing.billable_extra_branches} ek şube × ${money(pricing.additional_branch_price)}`
                  : ""}
              </p>
            </div>
            <p className="text-2xl font-semibold tabular-nums">
              {money(pricing.monthly_total)}
            </p>
          </div>
          <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
            Yeni bir şube açarsanız aylık tutar{" "}
            <strong className="text-foreground">
              {money(pricing.next_branch_monthly_total)}
            </strong>{" "}
            olur. Arşivlediğiniz şubeler ücretlendirilmez.
          </p>
        </div>
      ) : null}

      {!usage?.can_create ? (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <p className="font-medium">Paket şube sınırına ulaşıldı</p>
          <p className="mt-1 text-muted-foreground">
            Yeni şube açmak için mevcut aktif şubelerden birini kapatın veya paket limitini yükseltin.
          </p>
        </div>
      ) : null}

      {selected ? (
        <div className="grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <SectionCard title="Şube listesi" description={`${branches.length} kayıt`} contentClassName="p-2">
            <div className="space-y-1" role="list" aria-label="Şubeler">
              {branches.map((branch) => (
                <button
                  key={branch.id}
                  type="button"
                  onClick={() => setSelectedId(branch.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                    branch.id === selected.id ? "bg-muted" : "hover:bg-muted/60",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{branch.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{branch.slug}</span>
                  </span>
                  <StatusBadge tone={branch.is_active ? "success" : "neutral"}>
                    {branch.is_active ? "Aktif" : "Kapalı"}
                  </StatusBadge>
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title={selected.name} description="Profil, iletişim ve çalışma saatleri">
            <BranchEditor
              key={selected.id}
              branch={selected}
              pending={updateMutation.isPending}
              archivePending={archiveMutation.isPending || restoreMutation.isPending}
              onSubmit={(input) => updateMutation.mutate({ id: selected.id, input })}
              onArchive={() => archiveMutation.mutate({ id: selected.id })}
              onRestore={() => restoreMutation.mutate(selected.id)}
            />
          </SectionCard>
        </div>
      ) : (
        <EmptyState
          title="Şube bulunamadı"
          description="Paketiniz izin veriyorsa ilk şubeyi oluşturarak başlayın."
          icon={Store}
        />
      )}

      <BranchCreateDialog
        open={createOpen}
        pending={createMutation.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={(values, workingHours) =>
          createMutation.mutate({
            ...values,
            address: values.address || null,
            phone: values.phone || null,
            working_hours: workingHours,
          })
        }
      />
    </>
  );
}

function BranchEditor({
  branch,
  pending,
  archivePending,
  onSubmit,
  onArchive,
  onRestore,
}: {
  branch: Branch;
  pending: boolean;
  archivePending: boolean;
  onSubmit: (input: Parameters<typeof adminApi.updateBranch>[1]) => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const [workingHours, setWorkingHours] = useState<WorkingHours>(branch.working_hours);
  const form = useForm<BranchValues>({
    resolver: zodResolver(branchSchema),
    defaultValues: {
      name: branch.name,
      slug: branch.slug,
      timezone: branch.timezone,
      address: branch.address ?? "",
      phone: branch.phone ?? "",
    },
  });

  return (
    <form
      className="space-y-6"
      onSubmit={form.handleSubmit((values) =>
        onSubmit({
          name: values.name,
          timezone: values.timezone,
          address: values.address || null,
          phone: values.phone || null,
          working_hours: workingHours,
        }),
      )}
    >
      <BranchFields form={form} slugReadOnly />
      <WorkingHoursEditor value={workingHours} onChange={setWorkingHours} />
      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {branch.is_active ? (
            <Button
              type="button"
              variant="outline"
              disabled={archivePending}
              onClick={() => {
                if (
                  window.confirm(
                    `${branch.name} şubesi arşivlensin mi?

Yeni sipariş alınamaz ve şube değiştiricide görünmez. ` +
                      "Geçmiş siparişler, ödemeler ve raporlar korunur; şubeyi istediğiniz zaman geri açabilirsiniz. " +
                      "Arşivlenen şubeler faturalandırılmaz.",
                  )
                ) {
                  onArchive();
                }
              }}
            >
              {archivePending ? <LoaderCircle className="animate-spin" /> : <Archive />}
              Şubeyi arşivle
            </Button>
          ) : (
            <Button type="button" variant="outline" disabled={archivePending} onClick={onRestore}>
              {archivePending ? <LoaderCircle className="animate-spin" /> : <ArchiveRestore />}
              Şubeyi yeniden aç
            </Button>
          )}
          {!branch.is_active ? (
            <span className="text-xs text-muted-foreground">
              Arşivlenmiş · geçmiş kayıtlar korunuyor
            </span>
          ) : null}
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : <Save />}
          Bilgileri kaydet
        </Button>
      </div>
    </form>
  );
}

function BranchCreateDialog({
  open,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: BranchValues, hours: WorkingHours) => void;
}) {
  const [workingHours, setWorkingHours] = useState<WorkingHours>({});
  const form = useForm<BranchValues>({
    resolver: zodResolver(branchSchema),
    defaultValues: {
      name: "",
      slug: "",
      timezone: "Europe/Istanbul",
      address: "",
      phone: "",
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Yeni şube</DialogTitle>
          <DialogDescription>Şube kimliği, iletişim bilgileri ve haftalık çalışma düzeni.</DialogDescription>
        </DialogHeader>
        <form
          id="branch-create-form"
          className="space-y-6"
          onSubmit={form.handleSubmit((values) => onSubmit(values, workingHours))}
        >
          <BranchFields form={form} />
          <WorkingHoursEditor value={workingHours} onChange={setWorkingHours} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button type="submit" form="branch-create-form" disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}
            Şubeyi oluştur
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BranchFields({
  form,
  slugReadOnly = false,
}: {
  form: UseFormReturn<BranchValues>;
  slugReadOnly?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="branch-name">Şube adı</Label>
        <Input id="branch-name" className="mt-1.5" {...form.register("name")} />
        <FieldError>{form.formState.errors.name?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="branch-slug">Şube slug</Label>
        <Input
          id="branch-slug"
          className="mt-1.5 font-mono"
          readOnly={slugReadOnly}
          disabled={slugReadOnly}
          {...form.register("slug")}
        />
        <FieldError>{form.formState.errors.slug?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="branch-phone">Telefon</Label>
        <Input id="branch-phone" type="tel" className="mt-1.5" {...form.register("phone")} />
        <FieldError>{form.formState.errors.phone?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="branch-timezone">Saat dilimi</Label>
        <Input id="branch-timezone" className="mt-1.5" {...form.register("timezone")} />
        <FieldError>{form.formState.errors.timezone?.message}</FieldError>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="branch-address">Adres</Label>
        <Textarea id="branch-address" className="mt-1.5" rows={3} {...form.register("address")} />
        <FieldError>{form.formState.errors.address?.message}</FieldError>
      </div>
    </div>
  );
}

function WorkingHoursEditor({
  value,
  onChange,
}: {
  value: WorkingHours;
  onChange: (hours: WorkingHours) => void;
}) {
  const updateDay = (key: DayKey, next: DayHours) => onChange({ ...value, [key]: next });

  return (
    <fieldset>
      <legend className="flex items-center gap-2 text-sm font-semibold">
        <Clock3 className="size-4" aria-hidden="true" />
        Çalışma saatleri
      </legend>
      <div className="mt-3 divide-y rounded-xl border">
        {days.map((day) => {
          const hours = value[day.key] ?? { is_closed: true, opens_at: null, closes_at: null };
          const isOpen = !hours.is_closed;
          return (
            <div key={day.key} className="grid grid-cols-[7rem_1fr] items-center gap-3 p-3 sm:grid-cols-[8rem_5rem_1fr]">
              <span className="text-sm font-medium">{day.label}</span>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={isOpen}
                  onCheckedChange={(open) =>
                    updateDay(day.key, {
                      is_closed: !open,
                      opens_at: open ? hours.opens_at ?? "09:00" : null,
                      closes_at: open ? hours.closes_at ?? "23:00" : null,
                    })
                  }
                />
                {isOpen ? "Açık" : "Kapalı"}
              </label>
              <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                <Input
                  aria-label={`${day.label} açılış saati`}
                  type="time"
                  disabled={!isOpen}
                  value={hours.opens_at ?? ""}
                  onChange={(event) => updateDay(day.key, { ...hours, opens_at: event.target.value })}
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  aria-label={`${day.label} kapanış saati`}
                  type="time"
                  disabled={!isOpen}
                  value={hours.closes_at ?? ""}
                  onChange={(event) => updateDay(day.key, { ...hours, closes_at: event.target.value })}
                />
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function Summary({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Store;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
      <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 font-semibold">{value}</p>
      </div>
    </div>
  );
}
