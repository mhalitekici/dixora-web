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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [panel, setPanel] = useState<"waiter" | "cashier">("waiter");
  const authorize = useMutation({
    mutationFn: () =>
      api.post("auth/operation-grant", { username, password, panel }),
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
        description="Kendi işletme hesabınızla doğrulama yapın. Destek erişimi seçili şubede 10 dakika geçerlidir."
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
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="operation-password">Parola</Label>
          <Input
            id="operation-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
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
