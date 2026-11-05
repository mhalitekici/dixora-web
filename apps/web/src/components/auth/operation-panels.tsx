"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentUser } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";

export function OperationPanels() {
  const current = useCurrentUser();
  const router = useRouter();
  const cache = useQueryClient();
  const [username, setUsername] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState<"password" | "pin">("password");
  const pinEnabled = process.env.NEXT_PUBLIC_ENABLE_PIN_LOGIN === "true";
  const [panel, setPanel] = useState<"waiter" | "cashier">("waiter");
  const authorize = useMutation({
    mutationFn: () =>
      api.post("auth/operation-grant", {
        username: (username ?? current.data?.user.username ?? "").trim(),
        ...(method === "pin" ? { pin: password } : { password }),
        panel,
      }),
    onSuccess: async () => {
      setPassword("");
      await cache.invalidateQueries();
      router.push(panel === "cashier" ? "/cashier" : "/waiter/tables");
    },
    onError: () => setPassword(""),
  });
  return (
    <>
      <PageHeader
        title="Paneller"
        eyebrow="Yetkili operasyon girişi"
        icon={ShieldCheck}
        description="Açık olan hesabın parolası veya PIN’iyle doğrulayın. Destek erişimi seçili şubede 10 dakika geçerlidir."
      />
      <form
        method="post"
        className="max-w-lg space-y-5 rounded-xl border bg-card p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!authorize.isPending) authorize.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">
          Aktif hesap: {current.data?.user.displayName}. Kasiyer desteği gözlem
          modunda açılır; başka çalışanın vardiyası devralınmaz.
        </p>
        <div className="space-y-2">
          <Label htmlFor="operation-username">Kullanıcı adı</Label>
          <Input
            id="operation-username"
            name="username"
            autoComplete="username"
            required
            value={username ?? current.data?.user.username ?? ""}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        {pinEnabled ? (
          <div className="space-y-2">
            <Label htmlFor="operation-method">Doğrulama yöntemi</Label>
            <select
              id="operation-method"
              className="min-h-11 w-full rounded-md border bg-background px-3 text-sm"
              value={method}
              disabled={authorize.isPending}
              onChange={(event) => {
                setMethod(event.target.value === "pin" ? "pin" : "password");
                setPassword("");
                authorize.reset();
              }}
            >
              <option value="password">Hesap parolası</option>
              <option value="pin">Çalışan PIN’i</option>
            </select>
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="operation-password">
            {method === "pin" ? "PIN" : "Parola"}
          </Label>
          <Input
            id="operation-password"
            name={method}
            type="password"
            autoComplete={method === "pin" ? "off" : "current-password"}
            inputMode={method === "pin" ? "numeric" : undefined}
            pattern={method === "pin" ? "[0-9]{4,12}" : undefined}
            maxLength={method === "pin" ? 12 : 512}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Yalnız aktif hesabın bilgileri geçerlidir. Başka bir müdür veya
          yönetici için önce o hesapla giriş yapın. PIN atanmamışsa hesap
          parolasını kullanın.
        </p>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Panel seçimi</legend>
          {(
            [
              ["waiter", "Garson", "orders.create"],
              ["cashier", "Kasiyer", "payments.manage"],
            ] as const
          ).map(([value, label, permission]) => (
            <label
              key={value}
              className="flex min-h-11 items-center gap-3 rounded-lg border px-3"
            >
              <input
                type="radio"
                name="panel"
                value={value}
                checked={panel === value}
                disabled={!hasPermission(current.data, permission)}
                onChange={() => setPanel(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {authorize.error ? (
          <p role="alert" className="text-sm text-destructive">
            {authorize.error.message}
          </p>
        ) : null}
        <Button
          type="submit"
          className="min-h-11 w-full"
          disabled={
            authorize.isPending ||
            !hasPermission(
              current.data,
              panel === "cashier" ? "payments.manage" : "orders.create",
            )
          }
        >
          {authorize.isPending ? "Doğrulanıyor…" : "Yetkili giriş"}
        </Button>
      </form>
    </>
  );
}
