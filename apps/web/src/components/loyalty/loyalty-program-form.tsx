"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import {
  CalendarDays,
  Gift,
  LoaderCircle,
  MapPin,
  Save,
  ShieldCheck,
  Sparkles,
  Store,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"
import { Controller, useForm, useWatch, type Control } from "react-hook-form"
import { z } from "zod"

import { FieldError } from "@/components/admin/admin-utils"
import { LoyaltyPresetPicker } from "@/components/loyalty/loyalty-presets"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

import { StampProgress } from "./stamp-progress"
import type {
  LoyaltyProgram,
  LoyaltyProgramInput,
  LoyaltySetupOptions,
} from "./types"

const schema = z
  .object({
    name: z.string().trim().min(2, "Program adı en az 2 karakter olmalı.").max(160),
    is_active: z.boolean(),
    show_on_qr: z.boolean(),
    campaign_type: z.enum(["VISIT_COUNT", "PRODUCT_QUANTITY"]),
    threshold: z.coerce.number().int().min(1, "Hedef en az 1 olmalı.").max(10_000),
    branch_ids: z.array(z.string().uuid()).min(1, "En az bir şube seçin."),
    qualifying_type: z.enum(["PRODUCT", "CATEGORY"]),
    qualifying_id: z.string(),
    reward_type: z.enum(["PRODUCT", "CATEGORY"]),
    reward_id: z.string().min(1, "Ödül ürünü veya kategorisi seçin."),
    minimum_order_amount: z
      .string()
      .regex(/^\d+(?:[.,]\d{1,2})?$/, "Geçerli bir minimum tutar girin."),
    allow_multiple_same_day: z.boolean(),
    reward_same_order: z.boolean(),
    starts_at: z.string(),
    ends_at: z.string(),
  })
  .superRefine((values, context) => {
    if (values.campaign_type === "PRODUCT_QUANTITY" && !values.qualifying_id) {
      context.addIssue({
        code: "custom",
        path: ["qualifying_id"],
        message: "Sayılacak ürün veya kategoriyi seçin.",
      })
    }
    if (values.starts_at && values.ends_at && values.ends_at <= values.starts_at) {
      context.addIssue({
        code: "custom",
        path: ["ends_at"],
        message: "Bitiş tarihi başlangıçtan sonra olmalı.",
      })
    }
  })

type FormValues = z.infer<typeof schema>

export function LoyaltyProgramForm({
  program,
  options,
  pending,
  onSubmit,
}: {
  program: LoyaltyProgram | null
  options: LoyaltySetupOptions
  pending: boolean
  onSubmit: (input: LoyaltyProgramInput) => void
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults(program, options),
  })
  const [presetId, setPresetId] = useState<string | null>(null)
  const campaignType = useWatch({ control: form.control, name: "campaign_type" })
  const qualifyingType = useWatch({ control: form.control, name: "qualifying_type" })
  const rewardType = useWatch({ control: form.control, name: "reward_type" })
  const watched = useWatch({ control: form.control })
  const qualifyingOptions =
    qualifyingType === "PRODUCT" ? options.products : options.categories
  const rewardOptions = rewardType === "PRODUCT" ? options.products : options.categories
  const rewardName = rewardOptions.find((item) => item.id === watched.reward_id)?.name
  const threshold = Math.max(1, Number(watched.threshold) || 1)
  const selectedBranchNames = options.branches
    .filter((branch) => watched.branch_ids?.includes(branch.id))
    .map((branch) => branch.name)

  const submit = (values: FormValues) => {
    const minimum = values.minimum_order_amount.replace(",", ".")
    onSubmit({
      name: values.name,
      is_active: values.is_active,
      show_on_qr: values.show_on_qr,
      campaign_type: values.campaign_type,
      threshold: values.threshold,
      branch_ids: values.branch_ids,
      qualifying_product_id:
        values.campaign_type === "PRODUCT_QUANTITY" && values.qualifying_type === "PRODUCT"
          ? values.qualifying_id
          : null,
      qualifying_category_id:
        values.campaign_type === "PRODUCT_QUANTITY" && values.qualifying_type === "CATEGORY"
          ? values.qualifying_id
          : null,
      reward_product_id: values.reward_type === "PRODUCT" ? values.reward_id : null,
      reward_category_id: values.reward_type === "CATEGORY" ? values.reward_id : null,
      minimum_order_amount: minimum,
      allow_multiple_same_day: values.allow_multiple_same_day,
      reward_same_order: values.reward_same_order,
      starts_at: values.starts_at ? new Date(values.starts_at).toISOString() : null,
      ends_at: values.ends_at ? new Date(values.ends_at).toISOString() : null,
      expected_version: program?.version ?? null,
    })
  }

  return (
    <form
      className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]"
      onSubmit={form.handleSubmit(submit)}
      aria-label="Sadakat programı ayarları"
    >
      <div className="min-w-0">
        <div className="mb-4">
          <LoyaltyPresetPicker
            activePresetId={presetId}
            onSelect={(preset) => {
              setPresetId(preset.id)
              // Fill the mechanics; the owner still picks the actual product and
              // reward, which is the only part a template cannot know.
              form.setValue("campaign_type", preset.values.campaign_type, {
                shouldDirty: true,
              })
              form.setValue("threshold", preset.values.threshold, { shouldDirty: true })
              form.setValue(
                "minimum_order_amount",
                preset.values.minimum_order_amount,
                { shouldDirty: true },
              )
              form.setValue(
                "allow_multiple_same_day",
                preset.values.allow_multiple_same_day,
                { shouldDirty: true },
              )
            }}
          />
        </div>
        <div className="overflow-hidden rounded-3xl border bg-card shadow-sm">
          <StepSection
            number="01"
            icon={Sparkles}
            title="Programın kimliği"
            description="Müşterinin göreceği adı yazın ve yayına hazır olup olmadığını belirleyin."
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
              <div>
                <Label htmlFor="loyalty-name">Program adı</Label>
                <Input
                  id="loyalty-name"
                  className="mt-1.5"
                  placeholder="Örn. Mahallenin Müdavimi"
                  {...form.register("name")}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Bu ad QR menüde ve müşterinin ödül biletinde görünür.
                </p>
                <FieldError>{form.formState.errors.name?.message}</FieldError>
              </div>
              <Controller
                control={form.control}
                name="is_active"
                render={({ field }) => (
                  <div className={`rounded-2xl border p-4 ${field.value ? "border-emerald-500/25 bg-emerald-500/[0.07]" : "bg-muted/35"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="loyalty-active" className="font-semibold">
                        {field.value ? "Program aktif" : "Program kapalı"}
                      </Label>
                      <Switch
                        id="loyalty-active"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        aria-describedby="loyalty-active-description"
                      />
                    </div>
                    <p id="loyalty-active-description" className="mt-2 text-xs leading-5 text-muted-foreground">
                      {field.value
                        ? "Uygun ödemeler ilerleme kazandırır."
                        : "Ayarlar saklanır; yeni ilerleme oluşmaz."}
                    </p>
                  </div>
                )}
              />
            </div>
          </StepSection>

          <StepSection
            number="02"
            icon={Gift}
            title="Kazanma kuralı ve ödül"
            description="Müşterinin ne yapacağını ve hedefe ulaştığında ne kazanacağını eşleştirin."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="campaign_type"
                render={({ field }) => (
                  <div>
                    <Label htmlFor="loyalty-campaign-type">Neyi sayalım?</Label>
                    <Select
                      value={field.value}
                      onValueChange={(value) => field.onChange(value ?? "VISIT_COUNT")}
                    >
                      <SelectTrigger id="loyalty-campaign-type" className="mt-1.5 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="VISIT_COUNT">Geçerli ziyaretleri</SelectItem>
                        <SelectItem value="PRODUCT_QUANTITY">Seçili ürün adetlerini</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              />
              <div>
                <Label htmlFor="loyalty-threshold">
                  {campaignType === "VISIT_COUNT" ? "Kaç ziyarette ödül?" : "Kaç üründe ödül?"}
                </Label>
                <Input
                  id="loyalty-threshold"
                  type="number"
                  min={1}
                  max={10_000}
                  className="mt-1.5"
                  {...form.register("threshold")}
                />
                <FieldError>{form.formState.errors.threshold?.message}</FieldError>
              </div>

              {campaignType === "PRODUCT_QUANTITY" ? (
                <TargetSelector
                  label="Sayılacak seçim"
                  typeName="qualifying_type"
                  idName="qualifying_id"
                  options={qualifyingOptions}
                  control={form.control}
                  error={form.formState.errors.qualifying_id?.message}
                  onTypeChange={() => form.setValue("qualifying_id", "", { shouldDirty: true })}
                />
              ) : null}

              <TargetSelector
                label="Hedef tamamlanınca verilecek ödül"
                typeName="reward_type"
                idName="reward_id"
                options={rewardOptions}
                control={form.control}
                error={form.formState.errors.reward_id?.message}
                onTypeChange={() => form.setValue("reward_id", "", { shouldDirty: true })}
              />

              <div>
                <Label htmlFor="loyalty-minimum">Minimum sipariş tutarı (₺)</Label>
                <Input
                  id="loyalty-minimum"
                  inputMode="decimal"
                  className="mt-1.5"
                  {...form.register("minimum_order_amount")}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">0 girerseniz tutar sınırı uygulanmaz.</p>
                <FieldError>{form.formState.errors.minimum_order_amount?.message}</FieldError>
              </div>
              <div className="rounded-2xl border border-brand/20 bg-brand-soft/55 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">Kural özeti</p>
                <p className="mt-2 text-sm font-medium leading-6">
                  {campaignType === "VISIT_COUNT"
                    ? `${threshold} uygun ziyareti tamamla`
                    : `${threshold} uygun ürün satın al`}
                  {rewardName ? `, ${rewardName} kazan.` : "."}
                </p>
              </div>
            </div>
          </StepSection>

          <StepSection
            number="03"
            icon={ShieldCheck}
            title="Sınırlar ve zamanlama"
            description="Kampanyanın ne zaman işleyeceğini ve tekrarları nasıl değerlendireceğini belirleyin."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="loyalty-start">Başlangıç (isteğe bağlı)</Label>
                <div className="relative mt-1.5">
                  <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="loyalty-start"
                    type="datetime-local"
                    className="pl-9"
                    {...form.register("starts_at")}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="loyalty-end">Bitiş (isteğe bağlı)</Label>
                <div className="relative mt-1.5">
                  <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="loyalty-end"
                    type="datetime-local"
                    className="pl-9"
                    {...form.register("ends_at")}
                  />
                </div>
                <FieldError>{form.formState.errors.ends_at?.message}</FieldError>
              </div>
            </div>

            <div className="mt-5 divide-y rounded-2xl border">
              <Controller
                control={form.control}
                name="allow_multiple_same_day"
                render={({ field }) => (
                  <label htmlFor="loyalty-multiple-day" className="flex items-start gap-3 p-4 text-sm">
                    <Checkbox
                      id="loyalty-multiple-day"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                    <span>
                      <span className="font-medium">Aynı gün birden fazla ilerleme ver</span>
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                        Kapalıysa aynı üyenin yalnızca ilk uygun ziyareti sayılır.
                      </span>
                    </span>
                  </label>
                )}
              />
              <div className="flex items-start gap-3 p-4 text-sm opacity-65">
                <Checkbox
                  id="loyalty-same-order"
                  checked={false}
                  disabled
                  aria-describedby="loyalty-same-order-description"
                />
                <span>
                  <Label htmlFor="loyalty-same-order">Kazanılan ödülü aynı siparişte kullan</Label>
                  <span id="loyalty-same-order-description" className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    Yeni ödüller ödeme tamamlandıktan sonra oluşur ve sonraki uygun siparişte kullanılır.
                  </span>
                </span>
              </div>
            </div>
          </StepSection>

          <StepSection
            number="04"
            icon={MapPin}
            title="Şubeler ve QR görünürlüğü"
            description="Programın çalışacağı noktaları seçin ve müşteriye ne zaman gösterileceğini belirleyin."
          >
            <Controller
              control={form.control}
              name="branch_ids"
              render={({ field }) => (
                <fieldset>
                  <legend className="text-sm font-medium">Geçerli şubeler</legend>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {options.branches.map((branch) => {
                      const checked = field.value.includes(branch.id)
                      return (
                        <label
                          htmlFor={`loyalty-branch-${branch.id}`}
                          key={branch.id}
                          className={`flex items-center gap-3 rounded-2xl border p-3 text-sm transition-colors ${checked ? "border-brand/30 bg-brand-soft/45" : "hover:bg-muted/40"}`}
                        >
                          <Checkbox
                            id={`loyalty-branch-${branch.id}`}
                            checked={checked}
                            onCheckedChange={(nextChecked) =>
                              field.onChange(
                                nextChecked
                                  ? [...field.value, branch.id]
                                  : field.value.filter((id) => id !== branch.id),
                              )
                            }
                          />
                          <Store className="size-4 text-muted-foreground" />
                          <span className="font-medium">{branch.name}</span>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
              )}
            />
            <FieldError>{form.formState.errors.branch_ids?.message}</FieldError>

            <Controller
              control={form.control}
              name="show_on_qr"
              render={({ field }) => (
                <label
                  htmlFor="loyalty-show-qr"
                  className={`mt-5 flex items-start gap-3 rounded-2xl border p-4 text-sm ${field.value ? "border-emerald-500/25 bg-emerald-500/[0.07]" : "bg-muted/25"}`}
                >
                  <Checkbox
                    id="loyalty-show-qr"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                  <span>
                    <span className="font-medium">QR menüde katılım biletini göster</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                      Program aktif ve şube seçili olduğunda müşteriler telefonla doğrulanarak katılabilir.
                    </span>
                  </span>
                </label>
              )}
            />
          </StepSection>
        </div>

        <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted-foreground">
            Değişiklikler kaydedilene kadar müşterilere yansımaz.
          </p>
          <Button type="submit" size="lg" disabled={pending || !form.formState.isDirty}>
            {pending ? <LoaderCircle className="animate-spin" /> : <Save />}
            {pending ? "Kaydediliyor…" : "Programı kaydet"}
          </Button>
        </div>
      </div>

      <aside className="h-fit overflow-hidden rounded-3xl border border-[#eadfce] bg-[#fffaf1] text-[#292524] shadow-[0_16px_45px_-32px_rgba(41,37,36,0.6)] dark:border-white/10 dark:bg-[#292522] dark:text-stone-50 xl:sticky xl:top-24">
        <div className="border-b border-dashed border-current/20 p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-brand">
              <Gift className="size-4" />
              Müşteri önizlemesi
            </span>
            <span className={`rounded-full px-2.5 py-1 text-[0.65rem] font-semibold ${watched.is_active ? "bg-emerald-600 text-white" : "bg-stone-200 text-stone-700 dark:bg-white/10 dark:text-stone-200"}`}>
              {watched.is_active ? "Yayında" : "Taslak"}
            </span>
          </div>
          <h3 className="mt-5 text-2xl font-semibold tracking-tight">
            {watched.name || "Sadakat programı"}
          </h3>
          <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-300">
            {campaignType === "VISIT_COUNT"
              ? `${threshold} uygun ziyareti tamamla.`
              : `${threshold} uygun ürün satın al.`}
          </p>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between text-xs font-medium">
            <span>Ödül yolculuğu</span>
            <span className="tabular-nums">0 / {threshold}</span>
          </div>
          <StampProgress
            value={0}
            target={threshold}
            className="mt-4"
            stampClassName="bg-[#fffaf1] dark:bg-[#292522]"
          />

          <div className="mt-6 rounded-2xl bg-[#292524] p-4 text-stone-50 dark:bg-black/25">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-orange-300">Hedef ödülü</p>
            <p className="mt-1.5 font-semibold">{rewardName || "Henüz ödül seçilmedi"}</p>
          </div>

          <dl className="mt-5 space-y-3 text-xs">
            <PreviewRow label="Geçerli yer" value={selectedBranchNames.length ? selectedBranchNames.join(", ") : "Şube seçilmedi"} />
            <PreviewRow
              label="Minimum sepet"
              value={formatCurrency(watched.minimum_order_amount)}
            />
            <PreviewRow
              label="QR menü"
              value={watched.show_on_qr ? "Katılıma açık" : "Gizli"}
            />
          </dl>
        </div>
      </aside>
    </form>
  )
}

function StepSection({
  number,
  icon: Icon,
  title,
  description,
  children,
}: {
  number: string
  icon: LucideIcon
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="border-b last:border-b-0">
      <header className="flex items-start gap-3 bg-muted/20 px-4 py-4 sm:px-6 sm:py-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#292524] text-stone-50">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[0.65rem] font-semibold tracking-wider text-brand">ADIM {number}</span>
            <h2 className="font-semibold">{title}</h2>
          </div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="p-4 sm:p-6">{children}</div>
    </section>
  )
}

function TargetSelector({
  label,
  typeName,
  idName,
  options,
  control,
  error,
  onTypeChange,
}: {
  label: string
  typeName: "qualifying_type" | "reward_type"
  idName: "qualifying_id" | "reward_id"
  options: Array<{ id: string; name: string }>
  control: Control<FormValues>
  error?: string
  onTypeChange: () => void
}) {
  return (
    <div className="sm:col-span-2">
      <Label>{label}</Label>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-[10rem_1fr]">
        <Controller
          control={control}
          name={typeName}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={(value) => {
                field.onChange(value ?? "PRODUCT")
                onTypeChange()
              }}
            >
              <SelectTrigger className="w-full" aria-label={`${label} türü`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PRODUCT">Ürün</SelectItem>
                <SelectItem value="CATEGORY">Kategori</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        <Controller
          control={control}
          name={idName}
          render={({ field }) => (
            <Select value={field.value} onValueChange={(value) => field.onChange(value ?? "")}>
              <SelectTrigger className="w-full" aria-label={label}>
                <SelectValue placeholder="Seçin" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
      <FieldError>{error}</FieldError>
    </div>
  )
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-dashed border-current/15 pb-3 last:border-0 last:pb-0">
      <dt className="text-stone-500 dark:text-stone-400">{label}</dt>
      <dd className="max-w-[60%] text-right font-medium">{value}</dd>
    </div>
  )
}

function formatCurrency(value: string | undefined): string {
  const amount = Number((value ?? "0").replace(",", "."))
  if (!Number.isFinite(amount) || amount <= 0) return "Sınır yok"
  return amount.toLocaleString("tr-TR", { style: "currency", currency: "TRY" })
}

function defaults(
  program: LoyaltyProgram | null,
  options: LoyaltySetupOptions,
): FormValues {
  const rule = program?.rule
  return {
    name: program?.name ?? "Dixora Müdavim",
    is_active: program?.is_active ?? false,
    show_on_qr: program?.show_on_qr ?? false,
    campaign_type: rule?.campaign_type ?? "VISIT_COUNT",
    threshold: rule?.threshold ?? 5,
    branch_ids: program?.branch_ids ?? (options.branches[0] ? [options.branches[0].id] : []),
    qualifying_type: rule?.qualifying_category_id ? "CATEGORY" : "PRODUCT",
    qualifying_id: rule?.qualifying_product_id ?? rule?.qualifying_category_id ?? "",
    reward_type: rule?.reward_category_id ? "CATEGORY" : "PRODUCT",
    reward_id: rule?.reward_product_id ?? rule?.reward_category_id ?? "",
    minimum_order_amount: rule?.minimum_order_amount ?? "0.00",
    allow_multiple_same_day: rule?.allow_multiple_same_day ?? false,
    reward_same_order: false,
    starts_at: toLocalDateTime(program?.starts_at),
    ends_at: toLocalDateTime(program?.ends_at),
  }
}

function toLocalDateTime(value: string | null | undefined): string {
  if (!value) return ""
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
