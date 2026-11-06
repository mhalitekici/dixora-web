"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShieldCheck, UtensilsCrossed, Wallet } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState, ErrorState } from "@/components/admin/admin-utils";
import { useCurrentUser } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import { useCartStore } from "@/stores/cart-store";
import { useUiStore } from "@/stores/ui-store";

export function OperationPanels() {
  const current = useCurrentUser();
  const router = useRouter();
  const cache = useQueryClient();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [verified, setVerified] = useState(false);
  const [changeAccount, setChangeAccount] = useState(false);
  const options = useQuery({
    queryKey: ["operation-options"],
    queryFn: () =>
      api.get<{ ready: boolean; waiter: boolean; cashier: boolean }>(
        "auth/operation-options",
      ),
  });
  const login = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/auth/panel-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: username.trim(), pin }),
      });
      if (!response.ok) throw await ApiError.fromResponse(response);
      return response.json();
    },
    onSuccess: async () => {
      setPin("");
      await cache.cancelQueries();
      cache.clear();
      useCartStore.getState().clear();
      useUiStore.getState().reset();
      await Promise.all([current.refetch(), options.refetch()]);
      setVerified(true);
      setChangeAccount(false);
      router.replace("/panels");
      router.refresh();
    },
    onError: () => setPin(""),
  });
  const select = useMutation({
    mutationFn: (panel: "waiter" | "cashier") =>
      api.post("auth/operation-select", { panel }),
    onSuccess: async (_, panel) => {
      await cache.invalidateQueries({ queryKey: ["operation-access"] });
      await cache.invalidateQueries({ queryKey: ["shifts"] });
      router.push(panel === "cashier" ? "/cashier" : "/waiter/tables");
    },
  });
  if (options.isPending)
    return <LoadingState label="Panel bilgileri yükleniyor…" />;
  if (options.error)
    return (
      <ErrorState
        error={options.error}
        onRetry={() => void options.refetch()}
      />
    );
  const choose = !changeAccount && (verified || options.data.ready);
  return (
    <>
      <PageHeader
        title="Paneller"
        eyebrow="Yönetici ve müdür girişi"
        icon={ShieldCheck}
        description={
          choose
            ? "Hangi panele girmek istersiniz?"
            : "Çalışan hesabınızın kullanıcı adı ve PIN’iyle giriş yapın."
        }
      />
      {choose ? (
        <div className="max-w-2xl space-y-5">
          <p className="text-sm text-muted-foreground">
            Giriş yapan: <strong>{current.data?.user.displayName}</strong>
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Button
              className="h-auto min-h-32 flex-col gap-3 whitespace-normal p-5"
              variant="outline"
              disabled={!options.data.waiter || select.isPending}
              onClick={() => select.mutate("waiter")}
            >
              <UtensilsCrossed className="size-7" />
              <span>Garson paneli</span>
              <span className="text-xs font-normal">Masalar ve siparişler</span>
            </Button>
            <Button
              className="h-auto min-h-32 flex-col gap-3 whitespace-normal p-5"
              variant="outline"
              disabled={!options.data.cashier || select.isPending}
              onClick={() => select.mutate("cashier")}
            >
              <Wallet className="size-7" />
              <span>Kasiyer paneli</span>
              <span className="text-xs font-normal">
                Kendi vardiyanız ve tahsilatlarınız
              </span>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Kasiyer panelinde kendi adınıza ayrı vardiya açarsınız. Diğer
            kasiyerlerin açık vardiyaları devam eder.
          </p>
          {select.error ? (
            <p role="alert" className="text-sm text-destructive">
              {select.error.message}
            </p>
          ) : null}
          <Button
            variant="ghost"
            onClick={() => {
              setChangeAccount(true);
              setVerified(false);
            }}
          >
            Başka yönetici veya müdürle giriş yap
          </Button>
        </div>
      ) : (
        <form
          method="post"
          className="max-w-md space-y-5 rounded-xl border bg-card p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!login.isPending) login.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">
            Çalışanlar bölümünde oluşturulan yönetici veya müdür hesabını
            kullanın. PIN, bu çalışana atanmış olmalıdır.
          </p>
          <div className="space-y-2">
            <Label htmlFor="panel-username">Kullanıcı adı</Label>
            <Input
              id="panel-username"
              name="username"
              autoComplete="username"
              required
              disabled={login.isPending}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="panel-pin">PIN</Label>
            <Input
              id="panel-pin"
              name="pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4,12}"
              minLength={4}
              maxLength={12}
              autoComplete="off"
              required
              disabled={login.isPending}
              value={pin}
              onChange={(event) => setPin(event.target.value)}
            />
          </div>
          {login.error ? (
            <p role="alert" className="text-sm text-destructive">
              {login.error.message}
            </p>
          ) : null}
          <Button
            type="submit"
            className="min-h-11 w-full"
            disabled={login.isPending}
          >
            {login.isPending ? "Giriş yapılıyor…" : "Giriş yap"}
          </Button>
        </form>
      )}
    </>
  );
}
