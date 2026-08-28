"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Loader2, PartyPopper, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Onboarding = {
  offers_delivery: boolean | null;
  delivery_platforms: string[];
  payment_methods: string[];
  accepts_meal_cards: boolean | null;
  meal_card_providers: string[];
  monthly_order_volume: string | null;
  table_count: number | null;
  heard_from: string | null;
  completed: boolean;
  applied?: {
    tables_created: number;
    area_created: boolean;
    delivery_enabled: boolean;
    payment_methods: string[];
  } | null;
};

/** Platform codes must match DELIVERY_PLATFORMS on the API. */
const PLATFORMS = [
  ["GETIR", "Getir Yemek"],
  ["YEMEKSEPETI", "Yemeksepeti"],
  ["TRENDYOL_YEMEK", "Trendyol Yemek"],
  ["MIGROS_YEMEK", "Migros Yemek"],
  ["FUUDY", "Fuudy"],
  ["OTHER", "Diğer"],
] as const;

const PAYMENT_METHODS = [
  ["CASH", "Nakit"],
  ["CARD", "Kredi / banka kartı"],
  ["MEAL_CARD", "Yemek kartı"],
  ["ONLINE", "Online ödeme"],
  ["TRANSFER", "Havale / EFT"],
] as const;

/** Codes must match MEAL_CARD_PROVIDERS on the API. */
const MEAL_CARDS = [
  ["MULTINET", "Multinet"],
  ["SODEXO", "Sodexo"],
  ["SETCARD", "SetCard"],
  ["TICKET", "Ticket"],
  ["METROPOL", "Metropol"],
  ["PLUXEE", "Pluxee"],
  ["EDENRED", "Edenred"],
  ["OTHER", "Diğer"],
] as const;

const VOLUMES = [
  ["0-500", "Ayda 500'e kadar"],
  ["500-1000", "500 – 1.000"],
  ["1000-5000", "1.000 – 5.000"],
  ["5000+", "5.000 üzeri"],
] as const;

const SOURCES = [
  ["instagram", "Instagram"],
  ["google", "Google"],
  ["referral", "Tavsiye"],
  ["fair", "Fuar / etkinlik"],
  ["other", "Diğer"],
] as const;

export function OnboardingWizard() {
  const onboardingQuery = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => api.get<Onboarding>("registrations/onboarding"),
  });

  if (onboardingQuery.isLoading || !onboardingQuery.data) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Yükleniyor…
      </div>
    );
  }

  // Rendering the form only once the answers have loaded lets each field seed
  // itself directly from them, so a half-finished questionnaire resumes without
  // syncing state from an effect.
  return <OnboardingSteps initial={onboardingQuery.data} />;
}

function OnboardingSteps({ initial }: { initial: Onboarding }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [offersDelivery, setOffersDelivery] = useState<boolean | null>(
    initial.offers_delivery,
  );
  const [platforms, setPlatforms] = useState<string[]>(initial.delivery_platforms);
  const [volume, setVolume] = useState<string | null>(initial.monthly_order_volume);
  const [tableCount, setTableCount] = useState(
    initial.table_count ? String(initial.table_count) : "",
  );
  const [heardFrom, setHeardFrom] = useState<string | null>(initial.heard_from);
  const [summary, setSummary] = useState<Onboarding["applied"] | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<string[]>(initial.payment_methods);
  const [acceptsMealCards, setAcceptsMealCards] = useState<boolean | null>(
    initial.accepts_meal_cards,
  );
  const [mealCards, setMealCards] = useState<string[]>(initial.meal_card_providers);

  function toggle(list: string[], code: string): string[] {
    return list.includes(code)
      ? list.filter((item) => item !== code)
      : [...list, code];
  }

  const save = useMutation({
    mutationFn: (completed: boolean) =>
      api.put<Onboarding>("registrations/onboarding", {
        offers_delivery: offersDelivery,
        delivery_platforms: offersDelivery ? platforms : [],
        payment_methods: paymentMethods,
        accepts_meal_cards: acceptsMealCards,
        meal_card_providers: acceptsMealCards ? mealCards : [],
        monthly_order_volume: volume,
        table_count: tableCount ? Number(tableCount) : null,
        heard_from: heardFrom,
        completed,
      }),
    onSuccess: async (data, completed) => {
      await queryClient.invalidateQueries({ queryKey: ["onboarding"] });
      if (completed) setSummary(data.applied ?? null);
    },
  });

  function togglePlatform(code: string) {
    setPlatforms((current) =>
      current.includes(code)
        ? current.filter((item) => item !== code)
        : [...current, code],
    );
  }

  const steps = [
    {
      title: "Paket servisiniz var mı?",
      description:
        "Yanıtınız, hangi pazaryeri entegrasyonlarını önce geliştireceğimizi belirliyor.",
      body: (
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            [true, "Evet, paket servis yapıyoruz"],
            [false, "Hayır, sadece yerinde servis"],
          ].map(([value, label]) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => setOffersDelivery(value as boolean)}
              className={cn(
                "rounded-2xl border-2 p-4 text-left text-sm font-semibold transition-colors",
                offersDelivery === value
                  ? "border-brand bg-brand-soft/40 text-brand"
                  : "hover:bg-muted/50",
              )}
            >
              {label as string}
            </button>
          ))}
        </div>
      ),
    },
    {
      title: "Hangi platformlarla çalışıyorsunuz?",
      description: "Birden fazla seçebilirsiniz. Entegrasyonlar sırayla geliyor.",
      skip: offersDelivery !== true,
      body: (
        <div className="grid gap-2 sm:grid-cols-2">
          {PLATFORMS.map(([code, label]) => {
            const active = platforms.includes(code);
            return (
              <button
                key={code}
                type="button"
                onClick={() => togglePlatform(code)}
                className={cn(
                  "flex items-center justify-between rounded-xl border-2 px-4 py-3 text-sm font-medium transition-colors",
                  active ? "border-brand bg-brand-soft/40 text-brand" : "hover:bg-muted/50",
                )}
              >
                {label}
                {active ? <Check className="size-4" /> : null}
              </button>
            );
          })}
        </div>
      ),
    },
    {
      title: "Hangi ödeme yöntemlerini kabul ediyorsunuz?",
      description: "Kasada göreceğiniz ödeme seçeneklerini buna göre ayarlıyoruz.",
      body: (
        <div className="grid gap-2 sm:grid-cols-2">
          {PAYMENT_METHODS.map(([code, label]) => {
            const active = paymentMethods.includes(code);
            return (
              <button
                key={code}
                type="button"
                onClick={() => setPaymentMethods(toggle(paymentMethods, code))}
                className={cn(
                  "flex items-center justify-between rounded-xl border-2 px-4 py-3 text-sm font-medium transition-colors",
                  active ? "border-brand bg-brand-soft/40 text-brand" : "hover:bg-muted/50",
                )}
              >
                {label}
                {active ? <Check className="size-4" /> : null}
              </button>
            );
          })}
        </div>
      ),
    },
    {
      title: "Yemek kartı kabul ediyor musunuz?",
      description:
        "Hangi kartlarla çalıştığınız, sıradaki POS entegrasyonlarını belirliyor.",
      body: (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              [true, "Evet, yemek kartı geçiyoruz"],
              [false, "Hayır"],
            ].map(([value, label]) => (
              <button
                key={String(value)}
                type="button"
                onClick={() => setAcceptsMealCards(value as boolean)}
                className={cn(
                  "rounded-2xl border-2 p-4 text-left text-sm font-semibold transition-colors",
                  acceptsMealCards === value
                    ? "border-brand bg-brand-soft/40 text-brand"
                    : "hover:bg-muted/50",
                )}
              >
                {label as string}
              </button>
            ))}
          </div>
          {acceptsMealCards ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {MEAL_CARDS.map(([code, label]) => {
                const active = mealCards.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setMealCards(toggle(mealCards, code))}
                    className={cn(
                      "flex items-center justify-between rounded-xl border-2 px-4 py-3 text-sm font-medium transition-colors",
                      active ? "border-brand bg-brand-soft/40 text-brand" : "hover:bg-muted/50",
                    )}
                  >
                    {label}
                    {active ? <Check className="size-4" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: "İşletmenizin ölçeği",
      description: "Kurulumunuzu ve önerilerimizi buna göre ayarlıyoruz.",
      body: (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Aylık sipariş adedi</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {VOLUMES.map(([code, label]) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setVolume(code)}
                  className={cn(
                    "rounded-xl border-2 px-4 py-3 text-sm font-medium transition-colors",
                    volume === code
                      ? "border-brand bg-brand-soft/40 text-brand"
                      : "hover:bg-muted/50",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="onboarding-tables">Masa sayısı</Label>
            <Input
              id="onboarding-tables"
              inputMode="numeric"
              value={tableCount}
              onChange={(event) => setTableCount(event.target.value.replace(/\D/g, ""))}
              placeholder="Örn. 24"
              className="h-11 rounded-xl"
            />
          </div>
        </div>
      ),
    },
    {
      title: "Dixora'yı nereden duydunuz?",
      description: "İsteğe bağlı — bize çok yardımcı oluyor.",
      body: (
        <div className="grid gap-2 sm:grid-cols-2">
          {SOURCES.map(([code, label]) => (
            <button
              key={code}
              type="button"
              onClick={() => setHeardFrom(code)}
              className={cn(
                "rounded-xl border-2 px-4 py-3 text-sm font-medium transition-colors",
                heardFrom === code
                  ? "border-brand bg-brand-soft/40 text-brand"
                  : "hover:bg-muted/50",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ),
    },
  ].filter((item) => !("skip" in item && item.skip));

  if (summary !== undefined && summary !== null) {
    return (
      <div className="mx-auto w-full max-w-2xl p-4 sm:p-8">
        <div className="rounded-2xl border bg-card p-6">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600">
            <Check className="size-5" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">Kurulum tamam</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Verdiğiniz yanıtlara göre işletmeniz hazırlandı.
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {summary.tables_created > 0 ? (
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                <span>
                  <strong>{summary.tables_created} masa</strong> oluşturuldu
                  {summary.area_created ? " (Salon bölümü ile birlikte)" : ""}.
                </span>
              </li>
            ) : null}
            {summary.delivery_enabled ? (
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                <span>
                  Paket servis açıldı — <strong>Siparişler</strong> ekranından
                  telefon ve gel-al siparişi alabilirsiniz.
                </span>
              </li>
            ) : null}
            {summary.payment_methods.length > 0 ? (
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                <span>
                  {summary.payment_methods.length} ödeme yöntemi kaydedildi.
                </span>
              </li>
            ) : null}
          </ul>
          <Button className="mt-6 w-full" onClick={() => router.push("/admin")}>
            Panele git
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    );
  }

  const current = steps[Math.min(step, steps.length - 1)];
  const isLast = step >= steps.length - 1;

  return (
    <div className="mx-auto w-full max-w-2xl p-4 sm:p-8">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          {offersDelivery ? <Truck className="size-5" /> : <PartyPopper className="size-5" />}
        </span>
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-brand">
            Kuruluma başlayalım
          </p>
          <p className="text-sm text-muted-foreground">
            Adım {step + 1} / {steps.length}
          </p>
        </div>
      </div>

      <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-brand transition-all"
          style={{ width: `${((step + 1) / steps.length) * 100}%` }}
        />
      </div>

      <div className="rounded-2xl border bg-card p-5 sm:p-6">
        <h1 className="text-xl font-semibold tracking-tight">{current.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{current.description}</p>
        <div className="mt-5">{current.body}</div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          onClick={() => (step === 0 ? save.mutate(true) : setStep(step - 1))}
        >
          {step === 0 ? "Şimdilik atla" : "Geri"}
        </Button>
        <Button
          disabled={save.isPending}
          onClick={() => {
            if (isLast) {
              save.mutate(true);
            } else {
              save.mutate(false);
              setStep(step + 1);
            }
          }}
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : null}
          {isLast ? "Tamamla ve panele git" : "Devam"}
          {!isLast ? <ArrowRight className="size-4" /> : null}
        </Button>
      </div>
    </div>
  );
}
