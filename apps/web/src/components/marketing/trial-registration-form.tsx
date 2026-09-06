"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  LockKeyhole,
  MailCheck,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  type FieldErrors,
  type FieldPath,
  useForm,
} from "react-hook-form";
import { z } from "zod";

import { KVKK_NOTICE_VERSION } from "@/components/legal/documents/kvkk-notice";
import { MembershipAgreementDialog } from "@/components/marketing/membership-agreement-dialog";
import { MEMBERSHIP_AGREEMENT_VERSION } from "@/components/marketing/membership-agreement";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ADDITIONAL_BRANCH_PRICE_LABEL_VAT_INCLUSIVE,
  BASE_MONTHLY_PRICE_LABEL_VAT_INCLUSIVE,
} from "@/lib/pricing";

const registrationSchema = z.object({
  business_name: z.string().trim().min(2, "İşletme adını girin.").max(140),
  business_type: z.enum(["RESTAURANT", "CAFE", "BAR", "HOTEL"]),
  owner_name: z
    .string()
    .trim()
    .min(2, "Adınızı ve soyadınızı girin.")
    .max(160),
  email: z
    .string()
    .trim()
    .email("Geçerli bir e-posta adresi girin.")
    .max(255),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+()\s.-]{7,32}$/, "Geçerli bir telefon numarası girin."),
  password: z.string().min(10, "Parola en az 10 karakter olmalı.").max(256),
  terms_accepted: z
    .boolean()
    .refine(
      (value) => value,
      "Üyelik ve SaaS Hizmet Sözleşmesi'ni kabul etmeniz gerekiyor.",
    ),
  privacy_notice_acknowledged: z
    .boolean()
    .refine(
      (value) => value,
      "KVKK Aydınlatma Metni'ni okuduğunuzu onaylamanız gerekiyor.",
    ),
  // Opt-in, unticked by default, and never required to complete signup.
  marketing_consent: z.boolean(),
});

type RegistrationValues = z.infer<typeof registrationSchema>;

type PendingVerification = {
  verification_id: string;
  email: string;
  expires_in_seconds: number;
  development_code: string | null;
};

type RegistrationResult = {
  business_name: string;
  business_slug: string;
  owner_username: string;
  trial_ends_at: string;
};

const businessTypes = [
  ["RESTAURANT", "Restoran"],
  ["CAFE", "Kafe"],
  ["BAR", "Bar"],
  ["HOTEL", "Otel / konaklama"],
] as const;

const fieldIds = {
  business_name: "trial-business-name",
  business_type: "trial-business-type",
  owner_name: "trial-owner-name",
  email: "trial-email",
  phone: "trial-phone",
  password: "trial-password",
  terms_accepted: "trial-terms",
  privacy_notice_acknowledged: "trial-privacy-notice",
  marketing_consent: "trial-marketing-consent",
} as const;

export function TrialRegistrationForm() {
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [pending, setPending] = useState<PendingVerification | null>(null);
  const [code, setCode] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  async function confirmCode() {
    if (!pending) return;
    setConfirming(true);
    setServerError(null);
    try {
      const response = await fetch("/api/register/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verification_id: pending.verification_id,
          code: code.trim(),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | RegistrationResult
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(
          (body && "error" in body ? body.error?.message : undefined) ??
            "Kod doğrulanamadı.",
        );
      }
      setResult(body as RegistrationResult);
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
      );
    } finally {
      setConfirming(false);
    }
  }
  const form = useForm<RegistrationValues>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      business_name: "",
      business_type: "RESTAURANT",
      owner_name: "",
      email: "",
      phone: "",
      password: "",
      terms_accepted: false,
      privacy_notice_acknowledged: false,
      marketing_consent: false,
    },
  });

  async function onSubmit(values: RegistrationValues) {
    setServerError(null);
    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          contract_version: MEMBERSHIP_AGREEMENT_VERSION,
          privacy_notice_version: KVKK_NOTICE_VERSION,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | RegistrationResult
        | { error?: { message?: string }; detail?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          (body && "error" in body ? body.error?.message : undefined) ??
            (body && "detail" in body ? body.detail : undefined) ??
            "İşletme kaydı oluşturulamadı.",
        );
      }
      setPending(body as PendingVerification);
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
      );
    }
  }

  function onInvalid(errors: FieldErrors<RegistrationValues>) {
    const firstField = Object.keys(errors)[0] as
      | FieldPath<RegistrationValues>
      | undefined;
    if (firstField) {
      form.setFocus(firstField);
    }
  }

  if (result) {
    const loginHref =
      "/login?business=" +
      encodeURIComponent(result.business_slug) +
      "&email=" +
      encodeURIComponent(result.owner_username);

    return (
      <div
        className="border border-emerald-700/25 bg-emerald-500/8 p-6 sm:p-8"
        role="status"
        aria-live="polite"
      >
        <span className="flex size-12 items-center justify-center bg-emerald-700 text-white">
          <CheckCircle2 className="size-6" aria-hidden="true" />
        </span>
        <h3 className="mt-5 text-2xl font-semibold tracking-[-0.035em]">
          {result.business_name} hazır.
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          30 günlük ücretsiz kullanımınız başladı. İşletme kodunuz:
        </p>
        <code className="mt-3 block w-fit border bg-white px-3 py-2 text-sm font-semibold text-foreground">
          {result.business_slug}
        </code>
        <p className="mt-4 text-xs text-muted-foreground">
          Ücretsiz dönem sonu: {formatTrialDate(result.trial_ends_at)}
        </p>
        <Link
          href={loginHref}
          className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Giriş yap ve kuruluma başla
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="border bg-white p-6 sm:p-8" role="group" aria-live="polite">
        <span className="flex size-12 items-center justify-center bg-primary text-primary-foreground">
          <MailCheck className="size-6" aria-hidden="true" />
        </span>
        <h3 className="mt-5 text-2xl font-semibold tracking-[-0.035em]">
          E-postanızı doğrulayın
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          <span className="font-medium text-foreground">{pending.email}</span>{" "}
          adresine 6 haneli bir kod gönderdik. İşletmeniz kod doğrulandıktan
          sonra oluşturulur.
        </p>

        <label className="mt-5 block text-sm font-medium" htmlFor="register-code">
          Doğrulama kodu
        </label>
        <input
          id="register-code"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && code.length >= 4) void confirmCode();
          }}
          placeholder="000000"
          className="mt-2 h-14 w-full border bg-white text-center text-2xl font-bold tracking-[0.4em] outline-none [color-scheme:light] focus-visible:ring-3 focus-visible:ring-ring/50"
          autoFocus
        />

        {pending.development_code ? (
          <p className="mt-3 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
            Geliştirme modu · kod: <strong>{pending.development_code}</strong>
          </p>
        ) : null}

        {serverError ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {serverError}
          </p>
        ) : null}

        <button
          type="button"
          disabled={code.length < 4 || confirming}
          onClick={() => void confirmCode()}
          className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {confirming ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="size-4" aria-hidden="true" />
          )}
          Doğrula ve işletmemi oluştur
        </button>
        <button
          type="button"
          onClick={() => {
            setPending(null);
            setCode("");
            setServerError(null);
          }}
          className="mt-3 w-full text-xs text-muted-foreground underline underline-offset-4"
        >
          Bilgileri düzenle
        </button>
      </div>
    );
  }

  const errors = form.formState.errors;

  return (
    <form
      className="space-y-4"
      noValidate
      aria-busy={form.formState.isSubmitting}
      onSubmit={form.handleSubmit(onSubmit, onInvalid)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={fieldIds.business_name}
          label="İşletme adı"
          error={errors.business_name?.message}
        >
          <Input
            id={fieldIds.business_name}
            autoComplete="organization"
            spellCheck={false}
            aria-invalid={Boolean(errors.business_name)}
            aria-describedby={errorId(fieldIds.business_name, errors.business_name?.message)}
            className="h-12 rounded-none bg-white"
            placeholder="Örn. Sahil Restoran…"
            {...form.register("business_name")}
          />
        </Field>
        <Field
          id={fieldIds.business_type}
          label="İşletme türü"
          error={errors.business_type?.message}
        >
          <select
            id={fieldIds.business_type}
            autoComplete="organization-title"
            aria-invalid={Boolean(errors.business_type)}
            aria-describedby={errorId(fieldIds.business_type, errors.business_type?.message)}
            className="h-12 w-full rounded-none border bg-white px-3 text-sm text-[#252222] outline-none [color-scheme:light] focus-visible:ring-3 focus-visible:ring-ring/50"
            {...form.register("business_type")}
          >
            {businessTypes.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        id={fieldIds.owner_name}
        label="Yetkili adı ve soyadı"
        error={errors.owner_name?.message}
      >
        <Input
          id={fieldIds.owner_name}
          autoComplete="name"
          aria-invalid={Boolean(errors.owner_name)}
          aria-describedby={errorId(fieldIds.owner_name, errors.owner_name?.message)}
          className="h-12 rounded-none bg-white"
          {...form.register("owner_name")}
        />
      </Field>

      <Field
        id={fieldIds.email}
        label="E-posta adresi"
        error={errors.email?.message}
      >
        <Input
          id={fieldIds.email}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errorId(fieldIds.email, errors.email?.message)}
          className="h-12 rounded-none bg-white"
          placeholder="siz@isletmeniz.com"
          {...form.register("email")}
        />
      </Field>

      <Field
        id={fieldIds.phone}
        label="Telefon numarası"
        error={errors.phone?.message}
      >
        <Input
          id={fieldIds.phone}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          aria-invalid={Boolean(errors.phone)}
          aria-describedby={errorId(fieldIds.phone, errors.phone?.message)}
          className="h-12 rounded-none bg-white"
          placeholder="Örn. 0555 111 22 33"
          {...form.register("phone")}
        />
      </Field>

      <Field
        id={fieldIds.password}
        label="Parola"
        error={errors.password?.message}
      >
        <div className="relative">
          <LockKeyhole
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id={fieldIds.password}
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            aria-describedby={passwordDescription(errors.password?.message)}
            className="h-12 rounded-none bg-white pl-10"
            placeholder="En az 10 karakter…"
            {...form.register("password")}
          />
        </div>
        <p id={fieldIds.password + "-hint"} className="text-xs text-muted-foreground">
          En az 10 karakter kullanın.
        </p>
      </Field>

      <label
        htmlFor={fieldIds.terms_accepted}
        className="flex cursor-pointer items-start gap-3 border bg-white/70 p-3 text-xs leading-5 text-muted-foreground"
      >
        <input
          id={fieldIds.terms_accepted}
          type="checkbox"
          aria-invalid={Boolean(errors.terms_accepted)}
          aria-describedby={errorId(
            fieldIds.terms_accepted,
            errors.terms_accepted?.message,
          )}
          className="mt-0.5 size-4 shrink-0 accent-brand"
          {...form.register("terms_accepted")}
        />
        <span>
          <MembershipAgreementDialog />
          &apos;ni okudum ve kabul ediyorum. 30 günlük deneme sonunda devam
          etmek istersem Standard paketin{" "}
          {BASE_MONTHLY_PRICE_LABEL_VAT_INCLUSIVE} / ay tutarında olduğunu, 1
          şube dahil bu ücrete her ek aktif şube için ayrıca{" "}
          {ADDITIONAL_BRANCH_PRICE_LABEL_VAT_INCLUSIVE} eklendiğini biliyorum.
        </span>
      </label>
      {errors.terms_accepted ? (
        <p
          id={fieldIds.terms_accepted + "-error"}
          role="alert"
          className="text-xs text-destructive"
        >
          {errors.terms_accepted.message}
        </p>
      ) : null}

      <label
        htmlFor={fieldIds.privacy_notice_acknowledged}
        className="flex cursor-pointer items-start gap-3 border bg-white/70 p-3 text-xs leading-5 text-muted-foreground"
      >
        <input
          id={fieldIds.privacy_notice_acknowledged}
          type="checkbox"
          aria-invalid={Boolean(errors.privacy_notice_acknowledged)}
          aria-describedby={errorId(
            fieldIds.privacy_notice_acknowledged,
            errors.privacy_notice_acknowledged?.message,
          )}
          className="mt-0.5 size-4 shrink-0 accent-brand"
          {...form.register("privacy_notice_acknowledged")}
        />
        <span>
          <a
            href="/kvkk-aydinlatma-metni"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-foreground underline underline-offset-2 hover:text-brand"
          >
            KVKK Aydınlatma Metni
          </a>
          &apos;ni okudum.
        </span>
      </label>
      {errors.privacy_notice_acknowledged ? (
        <p
          id={fieldIds.privacy_notice_acknowledged + "-error"}
          role="alert"
          className="text-xs text-destructive"
        >
          {errors.privacy_notice_acknowledged.message}
        </p>
      ) : null}

      <label
        htmlFor={fieldIds.marketing_consent}
        className="flex cursor-pointer items-start gap-3 border bg-white/70 p-3 text-xs leading-5 text-muted-foreground"
      >
        <input
          id={fieldIds.marketing_consent}
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-brand"
          {...form.register("marketing_consent")}
        />
        <span>
          Dixora tarafından kampanya, duyuru ve tanıtım amaçlı ticari
          elektronik ileti gönderilmesine izin veriyorum. (İsteğe bağlıdır;
          işletme hesabı açmak için gerekli değildir.)
        </span>
      </label>

      <div aria-live="assertive" aria-atomic="true">
        {serverError ? (
          <p
            role="alert"
            className="border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive"
          >
            {serverError}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        className="h-12 w-full rounded-none text-sm"
        disabled={form.formState.isSubmitting}
      >
        {form.formState.isSubmitting ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <ArrowRight aria-hidden="true" />
        )}
        {form.formState.isSubmitting
          ? "İşletmeniz oluşturuluyor…"
          : "30 gün ücretsiz başla"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Kurulum ücreti yoktur
      </p>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={id + "-error"} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function errorId(id: string, error?: string) {
  return error ? id + "-error" : undefined;
}

function passwordDescription(error?: string) {
  return error
    ? fieldIds.password + "-hint " + fieldIds.password + "-error"
    : fieldIds.password + "-hint";
}

function formatTrialDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "long",
    timeZone: "Europe/Istanbul",
  }).format(new Date(value));
}
