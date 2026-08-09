"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, CheckCircle2, Loader2, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  type FieldErrors,
  type FieldPath,
  useForm,
} from "react-hook-form";
import { z } from "zod";

import { MembershipAgreementDialog } from "@/components/marketing/membership-agreement-dialog";
import { MEMBERSHIP_AGREEMENT_VERSION } from "@/components/marketing/membership-agreement";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ADDITIONAL_BRANCH_PRICE_LABEL,
  BASE_MONTHLY_PRICE_LABEL,
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
  password: z.string().min(10, "Parola en az 10 karakter olmalı.").max(256),
  terms_accepted: z
    .boolean()
    .refine((value) => value, "Koşulları kabul etmeniz gerekiyor."),
});

type RegistrationValues = z.infer<typeof registrationSchema>;

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
  password: "trial-password",
  terms_accepted: "trial-terms",
} as const;

export function TrialRegistrationForm() {
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<RegistrationValues>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      business_name: "",
      business_type: "RESTAURANT",
      owner_name: "",
      email: "",
      password: "",
      terms_accepted: false,
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
      setResult(body as RegistrationResult);
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
          İşletme paneline giriş yap
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
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
          <MembershipAgreementDialog /> ve gizlilik koşullarını okudum, kabul
          ediyorum. 30 günlük deneme sonunda devam etmek istersem Standard
          paketin 1 şube dahil aylık {BASE_MONTHLY_PRICE_LABEL} (KDV hariç),
          her ek aktif şubenin ise aylık {ADDITIONAL_BRANCH_PRICE_LABEL} (KDV
          hariç) olduğunu biliyorum.
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
        Kredi kartı gerekmez · Kurulum ücreti yoktur
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
