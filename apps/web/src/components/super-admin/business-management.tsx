"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CircleCheck,
  Copy,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldCheck,
  Store,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

type Business = {
  id: string;
  name: string;
  slug: string;
  business_type: string;
  state: string;
  is_active: boolean;
  created_at: string;
};

type SubscriptionPlan = {
  id: string;
  code: string;
  name: string;
  monthly_price: string | number;
  currency: string;
  max_branches: number | null;
  max_users: number | null;
  is_active: boolean;
};

const emptyBusinesses: Business[] = [];

const initialForm = {
  name: "",
  slug: "",
  businessType: "RESTAURANT",
  branchName: "",
  branchSlug: "",
  timezone: "Europe/Istanbul",
  ownerName: "",
  ownerUsername: "",
  ownerEmail: "",
  temporaryPassword: "",
  plan: "",
};

function slugify(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function listBusinesses(): Promise<Business[]> {
  const response = await fetch("/api/backend/businesses?limit=200");
  if (!response.ok) throw new Error("İşletmeler yüklenemedi.");
  const payload = (await response.json()) as Business[] | { items?: Business[] };
  return Array.isArray(payload) ? payload : payload.items ?? [];
}

async function listSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const response = await fetch("/api/backend/subscriptions/plans");
  if (!response.ok) throw new Error("Abonelik planları yüklenemedi.");
  const payload = (await response.json()) as
    | SubscriptionPlan[]
    | { items?: SubscriptionPlan[] };
  return Array.isArray(payload) ? payload : payload.items ?? [];
}

function formatPlanPrice(plan: SubscriptionPlan) {
  if (Number(plan.monthly_price) === 0) return "Ücretsiz";
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: plan.currency,
    maximumFractionDigits: 0,
  }).format(Number(plan.monthly_price));
}

export function BusinessManagement() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [open, setOpen] = useState(() => searchParams.get("create") === "1");
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(initialForm);
  const [created, setCreated] = useState<Business | null>(null);

  const businessesQuery = useQuery({
    queryKey: ["platform", "businesses"],
    queryFn: listBusinesses,
  });
  const plansQuery = useQuery({
    queryKey: ["platform", "subscription-plans"],
    queryFn: listSubscriptionPlans,
  });
  const businesses = businessesQuery.data ?? emptyBusinesses;
  const availablePlans = useMemo(
    () => (plansQuery.data ?? []).filter((plan) => plan.is_active),
    [plansQuery.data],
  );
  const defaultPlan = availablePlans[0];
  const selectedPlan =
    availablePlans.find((plan) => plan.code === form.plan) ?? defaultPlan;
  const selectedPlanCode = selectedPlan?.code ?? "";
  const canCreate =
    businessesQuery.isSuccess &&
    plansQuery.isSuccess &&
    availablePlans.length > 0;

  const filtered = useMemo(
    () =>
      businesses.filter((business) => {
        const text = `${business.name} ${business.slug}`.toLocaleLowerCase("tr-TR");
        const searchMatch = text.includes(search.toLocaleLowerCase("tr-TR"));
        const stateMatch = stateFilter === "all" || business.state === stateFilter;
        return searchMatch && stateMatch;
      }),
    [businesses, search, stateFilter],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!canCreate || !selectedPlan) {
        throw new Error(
          "Canlı işletme ve abonelik planı verisi doğrulanmadan işletme oluşturulamaz.",
        );
      }
      const response = await fetch("/api/backend/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          slug: form.slug,
          business_type: form.businessType,
          first_branch: {
            name: form.branchName,
            slug: form.branchSlug,
            timezone: form.timezone,
          },
          owner: {
            username: form.ownerUsername,
            email: form.ownerEmail || null,
            display_name: form.ownerName,
            temporary_password: form.temporaryPassword,
          },
          subscription_plan_code: selectedPlan.code,
        }),
      });
      const payload = (await response.json().catch(() => null)) as Business | { detail?: string; message?: string } | null;
      if (!response.ok) {
        const error = payload as { detail?: string; message?: string } | null;
        throw new Error(error?.detail ?? error?.message ?? "İşletme oluşturulamadı.");
      }
      return payload as Business;
    },
    onSuccess: (business) => {
      setCreated(business);
      setStep(5);
      void queryClient.invalidateQueries({ queryKey: ["platform", "businesses"] });
      toast.success("İşletme etkinleştirildi");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "İşletme oluşturulamadı."),
  });

  function startCreate() {
    if (!canCreate || !defaultPlan) {
      toast.error("İşletme oluşturma şu anda kullanılamıyor.", {
        description:
          plansQuery.isSuccess && availablePlans.length === 0
            ? "Aktif abonelik planı bulunamadı."
            : "Canlı işletme ve plan verilerinin yüklenmesini bekleyin.",
      });
      return;
    }
    setForm({
      ...initialForm,
      plan: defaultPlan.code,
      temporaryPassword: temporaryPassword(),
    });
    setCreated(null);
    setStep(1);
    setOpen(true);
  }

  function nextDisabled() {
    if (step === 1) return !form.name.trim() || !form.slug.trim();
    if (step === 2) return !form.branchName.trim() || !form.branchSlug.trim();
    if (step === 3)
      return (
        !form.ownerName.trim() ||
        form.ownerUsername.trim().length < 3 ||
        form.temporaryPassword.length < 10
      );
    return false;
  }

  return (
    <>
      <PageHeader
        eyebrow="Tenant yaşam döngüsü"
        title="İşletmeler"
        description="İşletme, ilk şube, sahip hesabı ve abonelik kaydını tek güvenli onboarding akışında yönetin."
        icon={Building2}
        actions={
          <>
            {businessesQuery.isPending || plansQuery.isPending ? (
              <StatusBadge tone="info">Canlı veri yükleniyor</StatusBadge>
            ) : businessesQuery.isError ? (
              <StatusBadge tone="danger">İşletme verisi alınamadı</StatusBadge>
            ) : plansQuery.isError ? (
              <StatusBadge tone="danger">Plan verisi alınamadı</StatusBadge>
            ) : availablePlans.length === 0 ? (
              <StatusBadge tone="warning">Aktif plan yok</StatusBadge>
            ) : (
              <StatusBadge tone="success" pulse>Canlı API</StatusBadge>
            )}
            <Button
              className="h-10 rounded-xl"
              disabled={!canCreate}
              title={
                canCreate
                  ? undefined
                  : "Canlı işletme listesi ve aktif abonelik planı gerekli."
              }
              onClick={startCreate}
            >
              <Plus />
              İşletme oluştur
            </Button>
          </>
        }
      />
      <DataToolbar
        value={search}
        onValueChange={setSearch}
        placeholder="İşletme adı veya kodu ara…"
        filters={
          <Select value={stateFilter} onValueChange={(value) => setStateFilter(value ?? "all")}>
            <SelectTrigger className="h-10 min-w-40 rounded-xl">
              <SelectValue placeholder="Tüm durumlar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm durumlar</SelectItem>
              <SelectItem value="ACTIVE">Aktif</SelectItem>
              <SelectItem value="TRIAL">Deneme</SelectItem>
              <SelectItem value="PAST_DUE">Ödeme gecikmiş</SelectItem>
              <SelectItem value="SUSPENDED">Askıda</SelectItem>
              <SelectItem value="ARCHIVED">Arşiv</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      <div className="mt-4 overflow-hidden rounded-2xl border bg-card">
        {businessesQuery.isLoading ? (
          <div className="flex min-h-72 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-brand" />
          </div>
        ) : businessesQuery.isError ? (
          <div className="p-4">
            <EmptyState
              title="Canlı işletme verisi alınamadı"
              description="Sahte kayıt gösterilmedi ve veri doğrulanana kadar işletme oluşturma kapatıldı."
              icon={AlertTriangle}
              action={
                <Button
                  variant="outline"
                  onClick={() => void businessesQuery.refetch()}
                  disabled={businessesQuery.isFetching}
                >
                  {businessesQuery.isFetching ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RefreshCw />
                  )}
                  Yeniden dene
                </Button>
              }
            />
          </div>
        ) : filtered.length ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>İşletme</TableHead>
                <TableHead>Tür</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="hidden md:table-cell">Oluşturulma</TableHead>
                <TableHead className="hidden lg:table-cell">Kod</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((business) => (
                <TableRow key={business.id}>
                  <TableCell>
                    <Link href={`/super-admin/businesses/${business.id}`} className="flex items-center gap-3">
                      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-xs font-bold">
                        {business.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span>
                        <span className="block text-sm font-semibold">{business.name}</span>
                        <span className="text-[0.65rem] text-muted-foreground">{business.slug}</span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">{business.business_type}</TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={
                        business.state === "SUSPENDED"
                          ? "danger"
                          : business.state === "TRIAL"
                            ? "warning"
                            : business.is_active
                              ? "success"
                              : "neutral"
                      }
                    >
                      {business.state}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {new Intl.DateTimeFormat("tr-TR", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    }).format(new Date(business.created_at))}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                    {business.id.slice(0, 8)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="İşletme işlemleri" />}>
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem render={<Link href={`/super-admin/businesses/${business.id}`} />}>
                          <Building2 />
                          İşletmeyi aç
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-4">
            <EmptyState
              title="İşletme bulunamadı"
              description="Filtreleri temizleyin veya yeni bir işletme oluşturun."
              icon={Building2}
              action={
                <Button disabled={!canCreate} onClick={startCreate}>
                  <Plus />
                  İşletme oluştur
                </Button>
              }
            />
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <div className="mb-3 flex items-center gap-1">
              {[1, 2, 3, 4].map((item) => (
                <span
                  key={item}
                  className={`h-1.5 flex-1 rounded-full ${
                    step >= item ? "bg-brand" : "bg-muted"
                  }`}
                />
              ))}
            </div>
            <DialogTitle>
              {step === 1
                ? "İşletme bilgileri"
                : step === 2
                  ? "İlk şube"
                  : step === 3
                    ? "İşletme sahibi"
                    : step === 4
                      ? "Abonelik ve onay"
                      : "Onboarding hazır"}
            </DialogTitle>
            <DialogDescription>
              {step < 5
                ? `Adım ${step} / 4 · Tenant, şube ve sahip hesabı tek transaction içinde oluşturulur.`
                : "Geçici parola yalnız bu ekranda bir kez görüntülenir."}
            </DialogDescription>
          </DialogHeader>

          {step === 1 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="business-name">İşletme adı</Label>
                <Input
                  id="business-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                      slug: slugify(event.target.value),
                    }))
                  }
                  className="h-11 rounded-xl"
                  placeholder="Örn. Luna Terrace"
                  autoFocus
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="business-slug">İşletme kodu</Label>
                  <Input
                    id="business-slug"
                    value={form.slug}
                    onChange={(event) => setForm((current) => ({ ...current, slug: slugify(event.target.value) }))}
                    className="h-11 rounded-xl font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label>İşletme türü</Label>
                  <Select
                    value={form.businessType}
                    onValueChange={(value) => setForm((current) => ({ ...current, businessType: value ?? "RESTAURANT" }))}
                  >
                    <SelectTrigger className="h-11 w-full rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RESTAURANT">Restoran</SelectItem>
                      <SelectItem value="CAFE">Kafe</SelectItem>
                      <SelectItem value="BAR">Bar</SelectItem>
                      <SelectItem value="HOTEL">Butik otel</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="branch-name">Şube adı</Label>
                <Input
                  id="branch-name"
                  value={form.branchName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      branchName: event.target.value,
                      branchSlug: slugify(event.target.value),
                    }))
                  }
                  className="h-11 rounded-xl"
                  placeholder={`${form.name || "İşletme"} Ana Şube`}
                  autoFocus
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="branch-slug">Şube kodu</Label>
                  <Input
                    id="branch-slug"
                    value={form.branchSlug}
                    onChange={(event) => setForm((current) => ({ ...current, branchSlug: slugify(event.target.value) }))}
                    className="h-11 rounded-xl font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Saat dilimi</Label>
                  <Select
                    value={form.timezone}
                    onValueChange={(value) => setForm((current) => ({ ...current, timezone: value ?? "Europe/Istanbul" }))}
                  >
                    <SelectTrigger className="h-11 w-full rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Europe/Istanbul">Europe/Istanbul</SelectItem>
                      <SelectItem value="Europe/Moscow">Europe/Moscow</SelectItem>
                      <SelectItem value="Europe/London">Europe/London</SelectItem>
                      <SelectItem value="Asia/Dubai">Asia/Dubai</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="owner-name">Ad soyad</Label>
                <Input
                  id="owner-name"
                  value={form.ownerName}
                  onChange={(event) => setForm((current) => ({ ...current, ownerName: event.target.value }))}
                  className="h-11 rounded-xl"
                  autoFocus
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="owner-username">Kullanıcı adı</Label>
                  <Input
                    id="owner-username"
                    value={form.ownerUsername}
                    onChange={(event) => setForm((current) => ({ ...current, ownerUsername: event.target.value.toLowerCase() }))}
                    className="h-11 rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="owner-email">E-posta</Label>
                  <Input
                    id="owner-email"
                    type="email"
                    value={form.ownerEmail}
                    onChange={(event) => setForm((current) => ({ ...current, ownerEmail: event.target.value }))}
                    className="h-11 rounded-xl"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="temp-password">Tek kullanımlık geçici parola</Label>
                <div className="flex gap-2">
                  <Input
                    id="temp-password"
                    value={form.temporaryPassword}
                    onChange={(event) => setForm((current) => ({ ...current, temporaryPassword: event.target.value }))}
                    className="h-11 rounded-xl font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-xl"
                    onClick={() => setForm((current) => ({ ...current, temporaryPassword: temporaryPassword() }))}
                  >
                    Yenile
                  </Button>
                </div>
                <p className="text-[0.65rem] text-muted-foreground">
                  İlk girişte parola değiştirme akışı zorunlu tutulmalıdır.
                </p>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Abonelik planı</Label>
                {plansQuery.isPending ? (
                  <div className="flex h-11 items-center gap-2 rounded-xl border px-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Plan kataloğu yükleniyor
                  </div>
                ) : plansQuery.isError ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-red-600/20 bg-red-500/5 p-3">
                    <div className="flex min-w-0 items-center gap-2 text-sm text-red-700 dark:text-red-300">
                      <AlertTriangle className="size-4 shrink-0" />
                      <span>Plan kataloğu alınamadı; oluşturma kapalı.</span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={plansQuery.isFetching}
                      onClick={() => void plansQuery.refetch()}
                    >
                      <RefreshCw />
                      Tekrar dene
                    </Button>
                  </div>
                ) : availablePlans.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-600/20 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="size-4 shrink-0" />
                    Aktif abonelik planı bulunamadı; işletme oluşturulamaz.
                  </div>
                ) : (
                  <Select
                    value={selectedPlanCode}
                    onValueChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        plan: value ?? "",
                      }))
                    }
                  >
                    <SelectTrigger className="h-11 w-full rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availablePlans.map((plan) => (
                        <SelectItem key={plan.id} value={plan.code}>
                          {plan.name} · {formatPlanPrice(plan)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="grid gap-3 rounded-2xl border bg-muted/30 p-4 sm:grid-cols-2">
                {[
                  [Building2, "İşletme", form.name],
                  [Store, "İlk şube", form.branchName],
                  [UserRound, "Sahip hesabı", form.ownerUsername],
                  [
                    ShieldCheck,
                    "Plan",
                    selectedPlan
                      ? `${selectedPlan.name} (${selectedPlan.code})`
                      : "Plan seçilmedi",
                  ],
                ].map(([Icon, label, value]) => {
                  const ReviewIcon = Icon as typeof Building2;
                  return (
                    <div key={String(label)} className="flex items-center gap-3">
                      <span className="flex size-9 items-center justify-center rounded-xl bg-card">
                        <ReviewIcon className="size-4 text-brand" />
                      </span>
                      <span>
                        <span className="block text-[0.62rem] text-muted-foreground">{String(label)}</span>
                        <span className="block text-xs font-semibold">{String(value)}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
              {mutation.isError ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-red-600/20 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {mutation.error instanceof Error
                      ? mutation.error.message
                      : "İşletme oluşturulamadı."}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 5 ? (
            <div className="space-y-5">
              <div className="flex flex-col items-center rounded-2xl bg-emerald-500/8 p-6 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-700">
                  <CircleCheck className="size-7" />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{created?.name ?? form.name} etkinleştirildi</h3>
                <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                  Tenant, ilk şube, sahip rolü ve abonelik kaydı oluşturuldu.
                </p>
              </div>
              <div className="rounded-2xl border p-4">
                <p className="mb-3 text-xs font-semibold">Tek seferlik onboarding bilgisi</p>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between gap-4 rounded-xl bg-muted/45 px-3 py-2">
                    <span className="text-muted-foreground">İşletme kodu</span>
                    <code>{form.slug}</code>
                  </div>
                  <div className="flex justify-between gap-4 rounded-xl bg-muted/45 px-3 py-2">
                    <span className="text-muted-foreground">Kullanıcı</span>
                    <code>{form.ownerUsername}</code>
                  </div>
                  <div className="flex justify-between gap-4 rounded-xl bg-muted/45 px-3 py-2">
                    <span className="text-muted-foreground">Geçici parola</span>
                    <code>{form.temporaryPassword}</code>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="mt-3 h-10 w-full rounded-xl"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      `İşletme: ${form.slug}\nKullanıcı: ${form.ownerUsername}\nGeçici parola: ${form.temporaryPassword}`,
                    );
                    toast.success("Onboarding bilgisi panoya kopyalandı");
                  }}
                >
                  <Copy />
                  Güvenli olarak kopyala
                </Button>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            {step > 1 && step < 5 ? (
              <Button variant="outline" onClick={() => setStep((current) => current - 1)}>
                <ArrowLeft />
                Geri
              </Button>
            ) : null}
            {step < 4 ? (
              <Button disabled={nextDisabled()} onClick={() => setStep((current) => current + 1)}>
                Devam
                <ArrowRight />
              </Button>
            ) : step === 4 ? (
              <Button
                disabled={!canCreate || !selectedPlan || mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                {mutation.isPending
                  ? "İşletme oluşturuluyor"
                  : "İşletmeyi oluştur ve etkinleştir"}
              </Button>
            ) : (
              <Button
                onClick={() => {
                  setOpen(false);
                  setCreated(null);
                  setForm(initialForm);
                }}
              >
                Tamamla
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
