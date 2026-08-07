"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  Building2,
  Check,
  ChevronLeft,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Smartphone,
  UtensilsCrossed,
  Wifi,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const passwordSchema = z.object({
  business_slug: z.string().trim(),
  remember_me: z.boolean(),
  identifier: z.string().trim().min(2, "Kullanıcı adınızı veya e-postanızı girin."),
  password: z.string().min(6, "Parola en az 6 karakter olmalı."),
});

const pinSchema = z.object({
  business_slug: z.string().trim().min(2, "İşletme kodu gerekli."),
  branch_slug: z.string().trim().min(2, "Şube kodu gerekli."),
  username: z.string().trim().min(2, "Kullanıcı adı gerekli."),
  pin: z.string().regex(/^\d{4,12}$/, "4–12 haneli PIN girin."),
});

type PasswordValues = z.infer<typeof passwordSchema>;
type PinValues = z.infer<typeof pinSchema>;
export type LoginMode = "password" | "pin";

const pinLoginEnabled =
  process.env.NEXT_PUBLIC_ENABLE_PIN_LOGIN === "true";

function targetForRole(roleValue: unknown) {
  const role = String(roleValue ?? "").toUpperCase();
  if (role.includes("SUPER_ADMIN")) return "/super-admin";
  if (role.includes("WAITER")) return "/waiter/tables";
  if (role.includes("CASHIER")) return "/cashier";
  if (role.includes("KITCHEN") || role.includes("BAR")) return "/kitchen";
  return "/admin";
}

export function LoginPanel({
  superAdmin = false,
  returnTo,
  initialBusiness = "",
  initialEmail = "",
  initialMode = "password",
}: {
  superAdmin?: boolean;
  returnTo?: string;
  initialBusiness?: string;
  initialEmail?: string;
  initialMode?: LoginMode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>(() =>
    !superAdmin && pinLoginEnabled ? initialMode : "password",
  );
  const [showPassword, setShowPassword] = useState(false);
  const isPinMode = !superAdmin && pinLoginEnabled && mode === "pin";

  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      business_slug: superAdmin ? "" : initialBusiness,
      remember_me: false,
      identifier: superAdmin ? "" : initialEmail,
      password: "",
    },
  });

  const pinForm = useForm<PinValues>({
    resolver: zodResolver(pinSchema),
    defaultValues: {
      business_slug: initialBusiness,
      branch_slug: "",
      username: initialEmail,
      pin: "",
    },
  });

  async function onPasswordSubmit(values: PasswordValues) {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          business_slug: superAdmin ? null : values.business_slug,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | {
            user?: {
              role?: string;
              roleCode?: string;
              roles?: Array<{ code?: string } | string>;
            };
            error?: { code?: string; message?: string };
            detail?: string;
            message?: string;
          }
        | null;
      if (!response.ok) {
        throw new Error(
          data?.error?.message ??
            data?.detail ??
            data?.message ??
            "Giriş bilgileri doğrulanamadı.",
        );
      }

      const role =
        data?.user?.roleCode ??
        data?.user?.role ??
        (typeof data?.user?.roles?.[0] === "string"
          ? data.user.roles[0]
          : data?.user?.roles?.[0]?.code);
      toast.success("Giriş başarılı", {
        description: "Güvenli çalışma alanınız hazırlanıyor.",
      });
      router.replace(
        safeReturnTo(returnTo) ??
          (superAdmin ? "/super-admin" : targetForRole(role)),
      );
      router.refresh();
    } catch (error) {
      toast.error("Giriş yapılamadı", {
        description: error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
      });
    }
  }

  async function onPinSubmit(values: PinValues) {
    try {
      const response = await fetch("/api/auth/pin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = (await response.json().catch(() => null)) as
        | {
            user?: { role?: string; roleCode?: string };
            error?: { code?: string; message?: string };
            detail?: string;
            message?: string;
          }
        | null;
      if (!response.ok) {
        const deviceError =
          data?.error?.code === "trusted_device_required" ||
          data?.error?.code === "trusted_device_invalid";
        throw new Error(
          deviceError
            ? "Bu cihaz henüz PIN girişi için yetkili değil. Önce İşletme girişi sekmesinden parola ile bir kez giriş yapın."
            : (data?.error?.message ??
                data?.detail ??
                data?.message ??
                "PIN doğrulanamadı."),
        );
      }
      toast.success("Hızlı giriş tamamlandı");
      router.replace(
        safeReturnTo(returnTo) ??
          targetForRole(data?.user?.roleCode ?? data?.user?.role),
      );
      router.refresh();
    } catch (error) {
      toast.error("PIN girişi başarısız", {
        description: error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
      });
    }
  }

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-[#242121] p-10 text-white lg:flex lg:flex-col xl:p-14">
        <div className="pointer-events-none absolute inset-0 surface-grid opacity-[0.08]" />
        <div className="pointer-events-none absolute -left-20 top-24 size-96 rounded-full bg-brand/20 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 right-0 size-80 rounded-full bg-blue-500/10 blur-[100px]" />
        <Link href="/" className="relative z-10 inline-flex w-fit">
          <BrandLogo theme="dark" className="h-11 text-white" priority />
        </Link>

        <div className="relative z-10 my-auto max-w-xl">
          <div className="mb-7 flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
            Operasyon ağı çevrimiçi
          </div>
          <h1 className="text-5xl font-semibold leading-[1.06] tracking-[-0.055em] xl:text-6xl">
            Ekibin servise
            <span className="block text-brand">hazır.</span>
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-white/56">
            Masa, sipariş, mutfak ve stok akışlarını güvenli bir çalışma alanından
            yönetin. Her rol yalnız ihtiyaç duyduğu araçları görür.
          </p>
          <div className="mt-10 grid max-w-lg gap-3 sm:grid-cols-3">
            {[
              [Wifi, "Gerçek zaman", "Anlık senkronizasyon"],
              [ShieldCheck, "İzole", "Tenant güvenliği"],
              [UtensilsCrossed, "Hızlı", "Az dokunuşlu akış"],
            ].map(([Icon, title, detail]) => {
              const FeatureIcon = Icon as typeof Wifi;
              return (
                <div key={String(title)} className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                  <FeatureIcon className="size-4 text-brand" />
                  <p className="mt-4 text-sm font-semibold">{String(title)}</p>
                  <p className="mt-1 text-[0.68rem] text-white/40">{String(detail)}</p>
                </div>
              );
            })}
          </div>
        </div>

        <p className="relative z-10 text-xs text-white/35">
          Dixora Restaurant Operations · Güvenli erişim
        </p>
      </section>

      <section className="relative flex min-h-dvh items-center justify-center px-5 py-10 sm:px-8">
        <Link
          href="/"
          className="absolute left-5 top-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground sm:left-8 sm:top-8"
        >
          <ChevronLeft className="size-4" />
          Ana sayfa
        </Link>
        <div className="w-full max-w-[430px]">
          <BrandLogo className="mx-auto mb-8 h-12 w-fit text-foreground lg:hidden" priority />
          <div className="mb-8">
            <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border bg-card text-brand shadow-sm">
              {superAdmin ? (
                <ShieldCheck className="size-5" />
              ) : isPinMode ? (
                <Smartphone className="size-5" />
              ) : (
                <Building2 className="size-5" />
              )}
            </div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.17em] text-brand">
              {superAdmin
                ? "Dixora Platform"
                : isPinMode
                  ? "Ekip erişimi"
                  : "İşletme çalışma alanı"}
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.045em]">
              {superAdmin
                ? "Platform yönetimine giriş"
                : isPinMode
                  ? "Garson girişi"
                  : "İşletme girişi"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {superAdmin
                ? "Yalnız yetkili Dixora platform yöneticileri erişebilir."
                : isPinMode
                  ? "İşletme, şube ve kullanıcı kodunuzla birlikte yöneticinizin tanımladığı PIN’i girin."
                  : "İşletme kodunuz ve hesap parolanızla yönetim çalışma alanına erişin."}
            </p>
          </div>

          {!superAdmin && pinLoginEnabled ? (
            <div
              className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
              role="tablist"
              aria-label="Giriş türü"
            >
              <button
                id="password-login-tab"
                type="button"
                onClick={() => setMode("password")}
                role="tab"
                aria-selected={mode === "password"}
                aria-controls="password-login-panel"
                className={cn(
                  "flex h-10 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition-[color,background-color,box-shadow] sm:text-sm",
                  mode === "password"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <KeyRound className="size-4" />
                İşletme girişi
              </button>
              <button
                id="pin-login-tab"
                type="button"
                onClick={() => setMode("pin")}
                role="tab"
                aria-selected={mode === "pin"}
                aria-controls="pin-login-panel"
                className={cn(
                  "flex h-10 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition-[color,background-color,box-shadow] sm:text-sm",
                  mode === "pin"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Smartphone className="size-4" />
                Garson girişi
              </button>
            </div>
          ) : null}

          {!isPinMode ? (
            <form
              id="password-login-panel"
              role={!superAdmin && pinLoginEnabled ? "tabpanel" : undefined}
              aria-labelledby={
                !superAdmin && pinLoginEnabled ? "password-login-tab" : undefined
              }
              className="space-y-4"
              onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
            >
              {!superAdmin ? (
                <div className="space-y-2">
                  <Label htmlFor="business_slug">İşletme kodu</Label>
                  <div className="relative">
                    <Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="business_slug"
                      autoComplete="organization"
                      className="h-12 rounded-xl pl-10"
                      aria-invalid={Boolean(passwordForm.formState.errors.business_slug)}
                      {...passwordForm.register("business_slug")}
                    />
                  </div>
                  {passwordForm.formState.errors.business_slug ? (
                    <p className="text-xs text-destructive">
                      {passwordForm.formState.errors.business_slug.message}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="identifier">Kullanıcı adı veya e-posta</Label>
                <Input
                  id="identifier"
                  autoComplete="username"
                  className="h-12 rounded-xl"
                  aria-invalid={Boolean(passwordForm.formState.errors.identifier)}
                  {...passwordForm.register("identifier")}
                />
                {passwordForm.formState.errors.identifier ? (
                  <p className="text-xs text-destructive">
                    {passwordForm.formState.errors.identifier.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Parola</Label>
                  <button
                    type="button"
                    disabled
                    title="Parola sıfırlama için işletme yöneticinizle iletişime geçin"
                    className="cursor-not-allowed text-xs font-medium text-muted-foreground"
                  >
                    Parolamı unuttum
                  </button>
                </div>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    className="h-12 rounded-xl px-10"
                    aria-invalid={Boolean(passwordForm.formState.errors.password)}
                    {...passwordForm.register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Parolayı gizle" : "Parolayı göster"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {passwordForm.formState.errors.password ? (
                  <p className="text-xs text-destructive">
                    {passwordForm.formState.errors.password.message}
                  </p>
                ) : null}
              </div>
              {!superAdmin ? (
                <label
                  htmlFor="remember_me"
                  className="flex cursor-pointer items-start gap-3 rounded-xl border bg-card px-3.5 py-3 text-sm"
                >
                  <input
                    id="remember_me"
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-brand"
                    aria-describedby="remember_me_hint"
                    {...passwordForm.register("remember_me")}
                  />
                  <span>
                    <span className="block font-medium text-foreground">Beni hatırla</span>
                    <span
                      id="remember_me_hint"
                      className="mt-0.5 block text-xs leading-5 text-muted-foreground"
                    >
                      Bu cihazda oturumunuzu 30 güne kadar güvenli tutar.
                    </span>
                  </span>
                </label>
              ) : null}
              <Button
                type="submit"
                className="h-12 w-full rounded-xl"
                disabled={passwordForm.formState.isSubmitting}
              >
                {passwordForm.formState.isSubmitting ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <LockKeyhole />
                )}
                Güvenli giriş yap
                {!passwordForm.formState.isSubmitting ? <ArrowRight className="ml-auto" /> : null}
              </Button>
            </form>
          ) : (
            <form
              id="pin-login-panel"
              role="tabpanel"
              aria-labelledby="pin-login-tab"
              className="space-y-4"
              onSubmit={pinForm.handleSubmit(onPinSubmit)}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pin_business_slug">İşletme kodu</Label>
                  <Input
                    id="pin_business_slug"
                    autoComplete="organization"
                    placeholder="ör. dixora-lab"
                    className="h-12 rounded-xl"
                    aria-invalid={Boolean(pinForm.formState.errors.business_slug)}
                    aria-describedby={
                      pinForm.formState.errors.business_slug
                        ? "pin_business_slug_error"
                        : undefined
                    }
                    {...pinForm.register("business_slug")}
                  />
                  {pinForm.formState.errors.business_slug ? (
                    <p id="pin_business_slug_error" className="text-xs text-destructive">
                      {pinForm.formState.errors.business_slug.message}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="branch_slug">Şube kodu</Label>
                  <Input
                    id="branch_slug"
                    autoComplete="off"
                    placeholder="ör. merkez"
                    className="h-12 rounded-xl"
                    aria-invalid={Boolean(pinForm.formState.errors.branch_slug)}
                    aria-describedby={
                      pinForm.formState.errors.branch_slug ? "branch_slug_error" : undefined
                    }
                    {...pinForm.register("branch_slug")}
                  />
                  {pinForm.formState.errors.branch_slug ? (
                    <p id="branch_slug_error" className="text-xs text-destructive">
                      {pinForm.formState.errors.branch_slug.message}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pin_username">Kullanıcı adı</Label>
                <Input
                  id="pin_username"
                  autoComplete="username"
                  placeholder="ör. ahmet"
                  className="h-12 rounded-xl"
                  aria-invalid={Boolean(pinForm.formState.errors.username)}
                  aria-describedby={
                    pinForm.formState.errors.username ? "pin_username_error" : undefined
                  }
                  {...pinForm.register("username")}
                />
                {pinForm.formState.errors.username ? (
                  <p id="pin_username_error" className="text-xs text-destructive">
                    {pinForm.formState.errors.username.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="pin">PIN</Label>
                <Input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={12}
                  autoComplete="current-password"
                  className="h-14 rounded-xl text-center text-2xl font-semibold tracking-[0.5em]"
                  aria-invalid={Boolean(pinForm.formState.errors.pin)}
                  aria-describedby="pin_hint"
                  {...pinForm.register("pin")}
                />
                {pinForm.formState.errors.pin ? (
                  <p id="pin_hint" className="text-xs text-destructive">
                    {pinForm.formState.errors.pin.message}
                  </p>
                ) : (
                  <p id="pin_hint" className="text-xs text-muted-foreground">
                    PIN’iniz işletme yöneticiniz tarafından çalışan hesabınıza tanımlanır.
                  </p>
                )}
              </div>
              <div
                role="note"
                className="flex gap-3 rounded-xl border border-brand/20 bg-brand/[0.06] p-3.5 text-xs leading-5 text-muted-foreground"
              >
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
                <div>
                  <p className="font-medium text-foreground">Bu cihazda ilk giriş mi?</p>
                  <p className="mt-0.5">
                    Yetkili bir işletme hesabıyla parola üzerinden bir kez giriş yapın. Çıkış
                    sonrasında güvenli cihaz yetkisi korunur ve çalışanlar PIN kullanabilir.
                  </p>
                  <button
                    type="button"
                    onClick={() => setMode("password")}
                    className="mt-1.5 font-semibold text-brand underline-offset-4 hover:underline"
                  >
                    İşletme girişine geç
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="h-12 w-full rounded-xl"
                disabled={pinForm.formState.isSubmitting}
              >
                {pinForm.formState.isSubmitting ? <Loader2 className="animate-spin" /> : <Check />}
                PIN ile devam et
              </Button>
            </form>
          )}

          <p className="mt-7 text-center text-[0.68rem] leading-5 text-muted-foreground">
            Devam ederek güvenli oturum ve denetim kaydı politikasını kabul etmiş olursunuz.
          </p>
        </div>
      </section>
    </div>
  );
}

function safeReturnTo(value: string | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : undefined;
}
