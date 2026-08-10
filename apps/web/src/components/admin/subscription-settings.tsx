"use client";

import { useQuery } from "@tanstack/react-query";
import { CreditCard, Loader2, Receipt, Store } from "lucide-react";

import { adminApi, adminKeys } from "@/components/admin/admin-api";
import { PageHeader } from "@/components/shared/page-header";
import { api } from "@/lib/api";

export function SubscriptionSettings() {
  const pricingQuery = useQuery({
    queryKey: adminKeys.branchPricing(),
    queryFn: ({ signal }) => adminApi.branchPricing(signal),
  });
  const meQuery = useQuery({
    queryKey: ["auth", "me", "subscription"],
    queryFn: () => api.get<{ tenant?: { state?: string } | null }>("auth/me"),
  });

  const pricing = pricingQuery.data;
  const state = meQuery.data?.tenant?.state;
  const money = (value: string | number | undefined) =>
    value === undefined
      ? "—"
      : new Intl.NumberFormat("tr-TR", {
          style: "currency",
          currency: pricing?.currency ?? "TRY",
          minimumFractionDigits: 2,
        }).format(Number(value));

  if (pricingQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Yükleniyor…
      </div>
    );
  }

  return (
    <div className="min-h-full bg-muted/20 p-4 sm:p-6">
      <PageHeader
        eyebrow="Abonelik"
        title="Üyelik ve ödeme"
        description="Paketinizi, aylık tutarınızı ve ödeme yönteminizi buradan görün."
        icon={CreditCard}
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border bg-card p-5 lg:col-span-2">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Aylık tutar
          </p>
          <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight">
            {money(pricing?.monthly_total)}
          </p>
          <div className="mt-4 space-y-1.5 border-t pt-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Temel paket ({pricing?.included_branches ?? 1} şube dahil)
              </span>
              <span className="tabular-nums">{money(pricing?.base_monthly_price)}</span>
            </div>
            {pricing && pricing.billable_extra_branches > 0 ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {pricing.billable_extra_branches} ek şube ×{" "}
                  {money(pricing.additional_branch_price)}
                </span>
                <span className="tabular-nums">
                  {money(
                    Number(pricing.additional_branch_price) *
                      pricing.billable_extra_branches,
                  )}
                </span>
              </div>
            ) : null}
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Store className="size-3.5" />
            {pricing?.active_branches ?? 0} aktif şube · arşivlenen şubeler
            ücretlendirilmez
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-5">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Durum
          </p>
          <p className="mt-2 text-lg font-semibold">
            {state === "TRIAL"
              ? "Deneme sürümü"
              : state === "ACTIVE"
                ? "Aktif"
                : (state ?? "—")}
          </p>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            {state === "TRIAL"
              ? "Deneme süreniz bittiğinde ödeme alınmadan hesabınız kısıtlanır; veriler silinmez."
              : "Aboneliğiniz devam ediyor."}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border bg-card p-5">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Receipt className="size-4 text-brand" />
          Ödeme yöntemi
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Şu anda ödemeler <strong className="text-foreground">banka havalesi / EFT</strong>{" "}
          ile alınmaktadır. Ödemenizi yaptıktan sonra dekontu bize iletin; hesabınız
          onay sonrası yenilenir.
        </p>
        <div className="mt-4 rounded-xl bg-muted/50 p-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Ödeme ve destek
          </p>
          <a
            href="mailto:info@dixoratech.com"
            className="mt-1.5 block font-medium text-brand underline underline-offset-4"
          >
            info@dixoratech.com
          </a>
        </div>
        <p className="mt-4 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
          Online kart ile ödeme (sanal POS) yakında bu ekrandan yapılabilecek.
        </p>
      </div>
    </div>
  );
}
