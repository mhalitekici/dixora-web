"use client";

import { useMutation } from "@tanstack/react-query";
import { BadgeCheck, Copy, Loader2, Mail, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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

import { loyaltyApi } from "./loyalty-api";

type Step = "details" | "code" | "done";

type Enrolled = {
  member_code: string;
  display_name: string;
  program_name: string;
  progress_target: number;
  card_email_sent: boolean;
};

/**
 * Till-side loyalty sign-up: the cashier types the customer's details, the
 * customer reads back the code from their inbox, and the card code appears for
 * the cashier to hand over verbally while the email is on its way.
 */
export function LoyaltyEnrollmentDialog({
  open,
  onOpenChange,
  onEnrolled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new member code so the caller can attach it to an order. */
  onEnrolled?: (memberCode: string) => void;
}) {
  const [step, setStep] = useState<Step>("details");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [code, setCode] = useState("");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [result, setResult] = useState<Enrolled | null>(null);

  function reset() {
    setStep("details");
    setFirstName("");
    setLastName("");
    setEmail("");
    setBirthDate("");
    setCode("");
    setVerificationId(null);
    setDevCode(null);
    setResult(null);
  }

  const startMutation = useMutation({
    mutationFn: () =>
      loyaltyApi.startEnrollment({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        birth_date: birthDate || null,
      }),
    onSuccess: (data) => {
      setVerificationId(data.verification_id);
      setDevCode(data.development_code);
      setStep("code");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Kod gönderilemedi."),
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      loyaltyApi.confirmEnrollment({
        verification_id: verificationId ?? "",
        code: code.trim(),
      }),
    onSuccess: (data) => {
      setResult(data);
      setStep("done");
      onEnrolled?.(data.member_code);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Kod doğrulanamadı."),
  });

  const detailsValid =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-5 text-brand" />
            Sadakat kaydı
          </DialogTitle>
          <DialogDescription>
            {step === "details"
              ? "Müşterinin bilgilerini girin; e-postasına bir doğrulama kodu göndereceğiz."
              : step === "code"
                ? "Müşteri e-postasına gelen 6 haneli kodu size okusun."
                : "Kayıt tamamlandı."}
          </DialogDescription>
        </DialogHeader>

        {step === "details" ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="loyalty-first-name">Ad</Label>
                <Input
                  id="loyalty-first-name"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  className="h-11 rounded-xl"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loyalty-last-name">Soyad</Label>
                <Input
                  id="loyalty-last-name"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loyalty-email">E-posta</Label>
              <Input
                id="loyalty-email"
                type="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="ornek@eposta.com"
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loyalty-birth-date">Doğum tarihi (isteğe bağlı)</Label>
              <Input
                id="loyalty-birth-date"
                type="date"
                value={birthDate}
                onChange={(event) => setBirthDate(event.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
          </div>
        ) : null}

        {step === "code" ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-xl border bg-muted/40 p-3 text-sm">
              <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">{email}</span> adresine
                kod gönderildi. Kod 15 dakika geçerli.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loyalty-code">Doğrulama kodu</Label>
              <Input
                id="loyalty-code"
                inputMode="numeric"
                value={code}
                maxLength={6}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && code.length >= 4) confirmMutation.mutate();
                }}
                placeholder="000000"
                className="h-14 rounded-xl text-center text-2xl font-bold tracking-[0.4em]"
                autoFocus
              />
            </div>
            {devCode ? (
              // Only ever present with the development mail sender.
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                Geliştirme modu · kod: <strong>{devCode}</strong>
              </p>
            ) : null}
          </div>
        ) : null}

        {step === "done" && result ? (
          <div className="space-y-3 text-center">
            <BadgeCheck className="mx-auto size-10 text-emerald-600" />
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{result.display_name}</span>{" "}
              · {result.program_name}
            </p>
            <div className="rounded-2xl border-2 border-dashed border-brand/40 bg-brand-soft/30 p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Üyelik kodu
              </p>
              <p className="mt-1 text-3xl font-bold tracking-[0.2em] text-brand">
                {result.member_code}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => {
                  void navigator.clipboard?.writeText(result.member_code);
                  toast.success("Kod kopyalandı.");
                }}
              >
                <Copy className="size-3.5" />
                Kopyala
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {result.card_email_sent
                ? "Üyelik kartı müşterinin e-postasına gönderildi."
                : "Kart e-postası gönderilemedi — kodu müşteriye siz iletin."}{" "}
              {result.progress_target} ziyarette ödül kazanılır.
            </p>
          </div>
        ) : null}

        <DialogFooter>
          {step === "details" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Vazgeç
              </Button>
              <Button
                disabled={!detailsValid || startMutation.isPending}
                onClick={() => startMutation.mutate()}
              >
                {startMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Mail className="size-4" />
                )}
                Kodu gönder
              </Button>
            </>
          ) : null}
          {step === "code" ? (
            <>
              <Button
                variant="outline"
                disabled={startMutation.isPending}
                onClick={() => startMutation.mutate()}
              >
                Kodu tekrar gönder
              </Button>
              <Button
                disabled={code.length < 4 || confirmMutation.isPending}
                onClick={() => confirmMutation.mutate()}
              >
                {confirmMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <BadgeCheck className="size-4" />
                )}
                Doğrula ve kaydet
              </Button>
            </>
          ) : null}
          {step === "done" ? (
            <Button onClick={() => onOpenChange(false)}>Kapat</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
