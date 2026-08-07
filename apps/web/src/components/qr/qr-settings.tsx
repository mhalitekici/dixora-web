"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import {
  AlertCircle,
  Eye,
  ImageIcon,
  Loader2,
  Save,
  Settings2,
} from "lucide-react"
import { useEffect } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { QrAdminNav } from "@/components/qr/qr-admin-nav"
import { QrImageUpload } from "@/components/qr/qr-image-upload"
import {
  useQrConfig,
  useUpdateQrConfig,
} from "@/components/qr/qr-hooks"
import type { QrConfigInput } from "@/components/qr/types"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ApiError } from "@/lib/api"

const settingsSchema = z.object({
  menu_name: z.string().trim().min(2, "Menü adı en az 2 karakter olmalı.").max(160),
  is_enabled: z.boolean(),
  order_mode: z.enum([
    "MENU_ONLY",
    "WAITER_APPROVAL",
    "AUTOMATIC_ACCEPTANCE",
    "DISABLED",
  ]),
  logo_url: z.string().trim().url("Geçerli bir logo adresi girin.").or(z.literal("")),
  cover_image_url: z
    .string()
    .trim()
    .url("Geçerli bir kapak görseli adresi girin.")
    .or(z.literal("")),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "HEX renk kodu girin."),
  language: z.string().trim().min(2).max(12),
  customer_notes_enabled: z.boolean(),
  allergens_visible: z.boolean(),
})

type SettingsValues = z.infer<typeof settingsSchema>

const defaults: SettingsValues = {
  menu_name: "Dijital Menü",
  is_enabled: false,
  order_mode: "WAITER_APPROVAL",
  logo_url: "",
  cover_image_url: "",
  primary_color: "#ec5a20",
  language: "tr",
  customer_notes_enabled: true,
  allergens_visible: true,
}

export function QrSettings() {
  const configQuery = useQrConfig()
  const updateConfig = useUpdateQrConfig()
  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: defaults,
  })

  useEffect(() => {
    if (configQuery.data) {
      form.reset({
        menu_name: configQuery.data.menu_name,
        is_enabled: configQuery.data.is_enabled,
        order_mode: configQuery.data.order_mode,
        logo_url: configQuery.data.logo_url ?? "",
        cover_image_url: configQuery.data.cover_image_url ?? "",
        primary_color: configQuery.data.primary_color,
        language: configQuery.data.language,
        customer_notes_enabled:
          configQuery.data.customer_notes_enabled ?? true,
        allergens_visible: configQuery.data.allergens_visible ?? true,
      })
    }
  }, [configQuery.data, form])

  const watched = useWatch({ control: form.control })
  const configMissing =
    configQuery.error instanceof ApiError &&
    configQuery.error.code === "qr_config_not_found"

  async function onSubmit(values: SettingsValues) {
    const payload: QrConfigInput = {
      menu_name: values.menu_name,
      is_enabled: values.is_enabled,
      order_mode: values.order_mode,
      primary_color: values.primary_color,
      language: values.language,
      customer_notes_enabled: values.customer_notes_enabled,
      allergens_visible: values.allergens_visible,
    }
    try {
      await updateConfig.mutateAsync(payload)
      toast.success("QR menü ayarları kaydedildi")
      form.reset(values)
    } catch (error) {
      toast.error("Ayarlar kaydedilemedi", {
        description:
          error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
      })
    }
  }

  return (
    <div>
      <QrAdminNav />
      <PageHeader
        eyebrow="Görünüm ve kurallar"
        title="QR Menü Ayarları"
        description="Menünün yayın durumunu, sipariş kabul politikasını ve müşteri görünümünü düzenleyin."
        icon={Settings2}
      />

      {configQuery.isLoading ? (
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <Skeleton className="h-[620px] rounded-xl" />
          <Skeleton className="h-[420px] rounded-xl" />
        </div>
      ) : (
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid items-start gap-5 xl:grid-cols-[1fr_360px]"
        >
          <div className="space-y-5">
            {configQuery.isError && !configMissing ? (
              <div className="flex gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
                <AlertCircle className="size-5 shrink-0 text-destructive" />
                <div>
                  <p className="font-semibold">Mevcut ayarlar alınamadı</p>
                  <p className="mt-1 text-muted-foreground">
                    {configQuery.error.message}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => void configQuery.refetch()}
                  >
                    Tekrar dene
                  </Button>
                </div>
              </div>
            ) : null}

            {configMissing ? (
              <div className="rounded-xl border border-brand/20 bg-brand-soft p-4 text-sm">
                <p className="font-semibold">İlk yapılandırma oluşturulacak</p>
                <p className="mt-1 text-muted-foreground">
                  Kaydettiğinizde bu şube için QR menü ayarları sunucuda
                  oluşturulur.
                </p>
              </div>
            ) : null}

            <SectionCard
              title="Yayın ve sipariş modu"
              description="Menünün müşterilere açık olup olmadığını ve siparişlerin nasıl işleneceğini belirleyin."
              contentClassName="space-y-5"
            >
              <Controller
                name="is_enabled"
                control={form.control}
                render={({ field }) => (
                  <label className="flex items-start justify-between gap-5 rounded-xl border p-4">
                    <span>
                      <span className="block font-semibold">QR menüyü yayınla</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        Kapalı olduğunda public menü endpointi içerik döndürmez.
                      </span>
                    </span>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      aria-label="QR menüyü yayınla"
                    />
                  </label>
                )}
              />

              <div className="space-y-2">
                <Label htmlFor="qr-order-mode">Sipariş modu</Label>
                <Controller
                  name="order_mode"
                  control={form.control}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) =>
                        field.onChange(value ?? "WAITER_APPROVAL")
                      }
                    >
                      <SelectTrigger
                        id="qr-order-mode"
                        className="h-11 w-full rounded-xl"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MENU_ONLY">Yalnız menü</SelectItem>
                        <SelectItem value="WAITER_APPROVAL">
                          Personel onayı gerekli
                        </SelectItem>
                        <SelectItem value="AUTOMATIC_ACCEPTANCE">
                          Otomatik kabul
                        </SelectItem>
                        <SelectItem value="DISABLED">Devre dışı</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  Güvenli başlangıç seçeneği personel onayıdır.
                </p>
              </div>
            </SectionCard>

            <SectionCard
              title="Marka görünümü"
              description="Public mobil menüde gösterilecek ad, renk ve görseller."
              contentClassName="grid gap-4 sm:grid-cols-2"
            >
              <Field
                label="Menü adı"
                id="qr-menu-name"
                error={form.formState.errors.menu_name?.message}
              >
                <Input
                  id="qr-menu-name"
                  className="h-11 rounded-xl"
                  {...form.register("menu_name")}
                />
              </Field>
              <Field
                label="Dil"
                id="qr-language"
                error={form.formState.errors.language?.message}
              >
                <Input
                  id="qr-language"
                  className="h-11 rounded-xl"
                  placeholder="tr"
                  {...form.register("language")}
                />
              </Field>
              <Field
                label="Ana renk"
                id="qr-primary-color"
                error={form.formState.errors.primary_color?.message}
              >
                <div className="flex gap-2">
                  <Input
                    id="qr-primary-color-picker"
                    type="color"
                    className="h-11 w-14 rounded-xl p-1"
                    aria-label="Ana renk seçici"
                    value={watched.primary_color}
                    onChange={(event) =>
                      form.setValue("primary_color", event.target.value, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                  />
                  <Input
                    id="qr-primary-color"
                    className="h-11 rounded-xl font-mono"
                    {...form.register("primary_color")}
                  />
                </div>
              </Field>
              <div />
              <div className="sm:col-span-2">
                <QrImageUpload
                  assetKind="logo"
                  label="İşletme logosu"
                  description="Kare veya yatay logonuzu JPEG, PNG ya da WebP olarak yükleyin. En fazla 5 MB."
                  value={watched.logo_url || null}
                  onChange={(value) =>
                    form.setValue("logo_url", value ?? "", {
                      shouldDirty: false,
                      shouldValidate: true,
                    })
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <QrImageUpload
                  assetKind="cover"
                  label="Kapak görseli"
                  description="Menünün üst alanında kullanılacak yatay görseli yükleyin. En fazla 5 MB."
                  value={watched.cover_image_url || null}
                  onChange={(value) =>
                    form.setValue("cover_image_url", value ?? "", {
                      shouldDirty: false,
                      shouldValidate: true,
                    })
                  }
                />
              </div>
            </SectionCard>

            <SectionCard
              title="Müşteri seçenekleri"
              description="Bu alanlar backend tarafından kaydedilir; mevcut API yanıtında dönmediğinde son kaydedilen istemci değeri korunur."
              contentClassName="space-y-3"
            >
              <Controller
                name="customer_notes_enabled"
                control={form.control}
                render={({ field }) => (
                  <ToggleRow
                    label="Müşteri sipariş notu"
                    detail="Müşteri tüm sipariş için serbest metin notu ekleyebilir."
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <Controller
                name="allergens_visible"
                control={form.control}
                render={({ field }) => (
                  <ToggleRow
                    label="Alerjenleri göster"
                    detail="Ürün kartlarında katalogdaki alerjen bilgilerini gösterir."
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </SectionCard>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-5">
            <SectionCard
              title="Mobil önizleme"
              description="Kaydedilmemiş form değerlerinin hızlı görünümü."
              contentClassName="p-0"
            >
              <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[2rem] border-[6px] border-[#242121] bg-white shadow-lg">
                <div
                  className="relative h-40 overflow-hidden p-4 text-white"
                  style={{ backgroundColor: watched.primary_color }}
                >
                  {watched.cover_image_url ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={watched.cover_image_url}
                        alt=""
                        className="absolute inset-0 size-full object-cover opacity-45"
                      />
                      <div className="absolute inset-0 bg-black/35" />
                    </>
                  ) : null}
                  <div className="relative">
                    {watched.logo_url ? (
                      <div className="flex size-10 items-center justify-center rounded-xl bg-white p-1.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={watched.logo_url}
                          alt=""
                          className="max-h-full max-w-full"
                        />
                      </div>
                    ) : (
                      <div className="flex size-10 items-center justify-center rounded-xl bg-white/20">
                        <ImageIcon className="size-5" />
                      </div>
                    )}
                    <p className="mt-7 text-xs opacity-70">Şube menüsü</p>
                    <p className="mt-1 text-xl font-semibold">
                      {watched.menu_name || "Dijital Menü"}
                    </p>
                  </div>
                </div>
                <div className="space-y-3 p-4">
                  <div className="h-10 rounded-xl bg-[#f3f1ee]" />
                  {[1, 2, 3].map((item) => (
                    <div
                      key={item}
                      className="flex h-16 items-center gap-3 rounded-xl border p-2"
                    >
                      <div className="size-11 rounded-lg bg-[#f0eeeb]" />
                      <div className="flex-1 space-y-2">
                        <div className="h-2.5 w-2/3 rounded bg-[#d9d4cf]" />
                        <div className="h-2 w-1/3 rounded bg-[#ebe7e3]" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>

            <Button
              type="submit"
              className="h-12 w-full rounded-xl"
              disabled={updateConfig.isPending || !form.formState.isDirty}
            >
              {updateConfig.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Save />
              )}
              {updateConfig.isPending ? "Kaydediliyor…" : "Değişiklikleri kaydet"}
            </Button>
            <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <Eye className="mt-0.5 size-3.5 shrink-0" />
              Önizleme yalnız görsel kontroldür; public menü gerçek katalog
              verisini kullanır.
            </p>
          </aside>
        </form>
      )}
    </div>
  )
}

function Field({
  label,
  id,
  error,
  className,
  children,
}: {
  label: string
  id: string
  error?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-2">{children}</div>
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function ToggleRow({
  label,
  detail,
  checked,
  onCheckedChange,
}: {
  label: string
  detail: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-start justify-between gap-5 rounded-xl border p-4">
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {detail}
        </span>
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </label>
  )
}
