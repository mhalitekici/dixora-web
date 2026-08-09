"use client";

import { useMutation } from "@tanstack/react-query";
import { KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toErrorMessage } from "@/lib/api/errors";

const MIN_PASSWORD_LENGTH = 10;

export function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Client-side checks are convenience only — the server independently
  // verifies the current password and enforces the length policy.
  const tooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const sameAsCurrent =
    newPassword.length > 0 && currentPassword.length > 0 && newPassword === currentPassword;
  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    newPassword === confirmPassword &&
    !sameAsCurrent;

  const mutation = useMutation({
    mutationFn: () =>
      api.post<void>("auth/password", {
        current_password: currentPassword,
        new_password: newPassword,
      }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Şifreniz güncellendi", {
        description: "Diğer cihazlardaki oturumlarınız güvenlik için kapatıldı.",
      });
    },
    onError: (error) => toast.error(toErrorMessage(error)),
  });

  return (
    <SectionCard
      title="Şifre değiştir"
      description="Hesabınızın şifresini güncelleyin. Diğer cihazlardaki oturumlar kapatılır."
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="current-password">Mevcut şifre</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="h-11 rounded-xl"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-password">Yeni şifre</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            aria-invalid={tooShort || sameAsCurrent}
            className="h-11 rounded-xl"
          />
          <p className="text-xs text-muted-foreground">
            En az {MIN_PASSWORD_LENGTH} karakter kullanın.
          </p>
          {sameAsCurrent ? (
            <p role="alert" className="text-xs text-destructive">
              Yeni şifre mevcut şifrenizden farklı olmalı.
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Yeni şifre (tekrar)</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            aria-invalid={mismatch}
            className="h-11 rounded-xl"
          />
          {mismatch ? (
            <p role="alert" className="text-xs text-destructive">
              Şifreler eşleşmiyor.
            </p>
          ) : null}
        </div>
        <Button type="submit" disabled={!canSubmit || mutation.isPending}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
          Şifreyi güncelle
        </Button>
      </form>
    </SectionCard>
  );
}
