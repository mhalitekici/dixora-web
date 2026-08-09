"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Globe2,
  LoaderCircle,
  Save,
  Store,
} from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { ChangePasswordCard } from "@/components/admin/change-password-card";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
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
import { toErrorMessage } from "@/lib/api/errors";

import { adminApi, adminKeys } from "./admin-api";
import { dateTime, ErrorState, FieldError, LoadingState } from "./admin-utils";
import type { Tenant } from "./types";

const businessSchema = z.object({
  name: z.string().trim().min(2, "İşletme adı en az 2 karakter olmalı.").max(160),
  default_currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "Üç harfli para birimi kodu seçin."),
  prevent_negative_stock: z.boolean(),
});
type BusinessValues = z.infer<typeof businessSchema>;

const tenantStateLabels: Record<Tenant["state"], string> = {
  TRIAL: "Deneme",
  ACTIVE: "Aktif",
  PAST_DUE: "Ödeme gecikmiş",
  SUSPENDED: "Askıya alınmış",
  CANCELLED: "İptal",
  ARCHIVED: "Arşiv",
};

export function BusinessSettings() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: adminKeys.businesses(),
    queryFn: ({ signal }) => adminApi.businesses(signal),
  });
  const businesses = query.data?.items ?? [];
  const activeId = selectedId ?? businesses[0]?.id ?? "";
  const business = businesses.find((item) => item.id === activeId);

  const mutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: BusinessValues }) =>
      adminApi.updateBusiness(id, values),
    onSuccess: async () => {
      toast.success("İşletme adı güncellendi.");
      await queryClient.invalidateQueries({ queryKey: adminKeys.businesses() });
    },
    onError: (error) => toast.error(toErrorMessage(error)),
  });

  if (query.isLoading) return <LoadingState label="İşletme ayarları yükleniyor…" />;
  if (query.error) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  return (
    <>
      <PageHeader
        eyebrow="Tenant yapılandırması"
        title="İşletme ayarları"
        description="Backend’in desteklediği işletme kimliği ve temel profil alanlarını yönetin."
        icon={Building2}
      />

      {!business ? (
        <EmptyState
          title="İşletme kaydı bulunamadı"
          description="Oturumun bağlı olduğu tenant kaydı API tarafından döndürülmedi."
          icon={Building2}
        />
      ) : (
        <>
          {businesses.length > 1 ? (
            <div className="mb-4 flex items-center justify-between rounded-2xl border bg-card p-3">
              <p className="text-sm font-medium">Yönetilen işletme</p>
              <Select value={activeId} onValueChange={(value) => setSelectedId(value ?? null)}>
                <SelectTrigger className="h-10 min-w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {businesses.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="İşletme durumu"
              value={tenantStateLabels[business.state]}
              detail={business.is_active ? "Hizmete açık" : "Devre dışı"}
              icon={CheckCircle2}
              tone={business.is_active ? "success" : "warning"}
            />
            <StatCard
              title="İşletme türü"
              value={prettify(business.business_type)}
              detail="Backend sınıflandırması"
              icon={Store}
              tone="brand"
            />
            <StatCard
              title="Genel slug"
              value={business.slug}
              detail="QR ve tenant yönlendirmesinde kullanılır"
              icon={Globe2}
              tone="info"
            />
            <StatCard
              title="Oluşturulma"
              value={dateTime(business.created_at)}
              detail="Tenant kayıt zamanı"
              icon={CalendarDays}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1fr_0.8fr]">
            <SectionCard
              title="İşletme profili"
              description="Değiştirilebilir backend alanları"
            >
              <BusinessSettingsForm
                key={`${business.id}:${business.name}:${business.default_currency}:${business.prevent_negative_stock}`}
                business={business}
                pending={mutation.isPending}
                onSubmit={(values) => mutation.mutate({ id: business.id, values })}
              />
            </SectionCard>
            <SectionCard
              title="Sistem kimliği"
              description="Salt okunur tenant alanları"
            >
              <div className="space-y-3">
                <ReadOnlyField label="Tenant ID" value={business.id} mono />
                <ReadOnlyField label="Slug" value={business.slug} mono />
                <ReadOnlyField label="İşletme türü" value={business.business_type} />
                <div className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">Abonelik durumu</p>
                  <div className="mt-1">
                    <StatusBadge tone={stateTone(business.state)}>
                      {tenantStateLabels[business.state]}
                    </StatusBadge>
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_0.8fr]">
            <ChangePasswordCard />
          </div>
        </>
      )}
    </>
  );
}

function BusinessSettingsForm({
  business,
  pending,
  onSubmit,
}: {
  business: Tenant;
  pending: boolean;
  onSubmit: (values: BusinessValues) => void;
}) {
  const form = useForm<BusinessValues>({
    resolver: zodResolver(businessSchema),
    defaultValues: {
      name: business.name,
      default_currency: business.default_currency,
      prevent_negative_stock: business.prevent_negative_stock,
    },
  });
  return (
    <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
      <div>
        <Label htmlFor="business-name">İşletme adı</Label>
        <Input id="business-name" className="mt-1.5" {...form.register("name")} />
        <FieldError>{form.formState.errors.name?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="business-slug">Genel slug</Label>
        <Input id="business-slug" value={business.slug} readOnly disabled className="mt-1.5 font-mono" />
        <p className="mt-1 text-xs text-muted-foreground">
          QR bağlantılarını kırmamak için mevcut API’de değiştirilemez.
        </p>
      </div>
      <Controller
        control={form.control}
        name="default_currency"
        render={({ field, fieldState }) => (
          <div>
            <Label>Varsayılan para birimi</Label>
            <Select value={field.value} onValueChange={(value) => field.onChange(value ?? "TRY")}>
              <SelectTrigger className="mt-1.5 h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["TRY", "USD", "EUR", "GBP", "AED"].map((currency) => (
                  <SelectItem key={currency} value={currency}>
                    {currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError>{fieldState.error?.message}</FieldError>
          </div>
        )}
      />
      <Controller
        control={form.control}
        name="prevent_negative_stock"
        render={({ field }) => (
          <label className="flex items-center justify-between gap-4 rounded-xl border p-3">
            <span>
              <span className="block text-sm font-semibold">Negatif stoğu engelle</span>
              <span className="block text-xs text-muted-foreground">
                Yetkili istisna dışında bakiyenin sıfırın altına düşmesini önler.
              </span>
            </span>
            <Switch checked={field.value} onCheckedChange={field.onChange} />
          </label>
        )}
      />
      <Button type="submit" disabled={pending || !form.formState.isDirty}>
        {pending ? <LoaderCircle className="animate-spin" /> : <Save />}
        Değişiklikleri kaydet
      </Button>
    </form>
  );
}

function ReadOnlyField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={mono ? "mt-1 break-all font-mono text-xs" : "mt-1 font-medium"}>{value}</p>
    </div>
  );
}

function stateTone(state: Tenant["state"]) {
  if (state === "ACTIVE" || state === "TRIAL") return "success" as const;
  if (state === "PAST_DUE") return "warning" as const;
  if (state === "SUSPENDED" || state === "CANCELLED") return "danger" as const;
  return "neutral" as const;
}

function prettify(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .split("_")
    .map((part) => part.charAt(0).toLocaleUpperCase("tr-TR") + part.slice(1))
    .join(" ");
}
