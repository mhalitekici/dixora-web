"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CreditCard, Loader2, ShieldCheck, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type SavedCard = {
  id: string
  masked_number: string
  card_association: string | null
  card_family: string | null
  is_default: boolean
}

type Invoice = {
  id: string
  number: string
  amount: string
  currency: string
  status: string
  period_start: string
  period_end: string
  branch_count: number
  base_amount: string
  extra_branch_amount: string
  due_at: string | null
  paid_at: string | null
  failure_reason: string | null
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Taslak",
  ISSUED: "Ödeme bekliyor",
  PAID: "Ödendi",
  FAILED: "Ödenemedi",
  VOID: "İptal",
}

const money = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
})

const month = new Intl.DateTimeFormat("tr-TR", { year: "numeric", month: "long" })

const billingKeys = {
  cards: ["billing", "cards"] as const,
  invoices: ["billing", "invoices"] as const,
}

/**
 * Membership and payment, for the business owner.
 *
 * Card entry happens on the provider's own hosted page. Nothing here ever sees
 * a card number — sending one through this application would put the whole
 * server in PCI DSS scope even though none of it would be stored.
 */
export function BillingPanel() {
  const queryClient = useQueryClient()

  const cardsQuery = useQuery({
    queryKey: billingKeys.cards,
    queryFn: ({ signal }) => api.get<SavedCard[]>("billing/cards", { signal }),
  })
  const invoicesQuery = useQuery({
    queryKey: billingKeys.invoices,
    queryFn: ({ signal }) => api.get<Invoice[]>("billing/invoices", { signal }),
  })

  const checkoutMutation = useMutation({
    mutationFn: () => api.post<{ form_url: string }>("billing/cards/checkout", {}),
    onSuccess: (result) => {
      // The provider's page, not ours.
      window.location.href = result.form_url
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Kart formu açılamadı.",
      ),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`billing/cards/${id}`),
    onSuccess: async () => {
      toast.success("Kart kaldırıldı")
      await queryClient.invalidateQueries({ queryKey: billingKeys.cards })
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Kart kaldırılamadı."),
  })

  const cards = cardsQuery.data ?? []
  const invoices = invoicesQuery.data ?? []
  const unpaid = invoices.filter(
    (invoice) => invoice.status === "ISSUED" || invoice.status === "FAILED",
  )

  return (
    <section className="space-y-4" aria-labelledby="billing-heading">
      <div>
        <h2 id="billing-heading" className="text-lg font-semibold">
          Üyelik ve Ödeme
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Aboneliğiniz her ay kayıtlı kartınızdan tahsil edilir.
        </p>
      </div>

      {unpaid.length > 0 ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <p className="font-semibold">
            {unpaid.length} ödenmemiş fatura
          </p>
          {unpaid[0].failure_reason ? (
            <p className="mt-0.5 text-xs leading-5">
              Son deneme: {unpaid[0].failure_reason}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold">Kayıtlı kart</h3>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
              Kart bilgileriniz Dixora sunucularına hiç gelmez; ödeme
              kuruluşunun sayfasında girilir.
            </p>
          </div>
          <Button
            size="sm"
            className="shrink-0 rounded-xl"
            disabled={checkoutMutation.isPending}
            onClick={() => checkoutMutation.mutate()}
          >
            {checkoutMutation.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <CreditCard />
            )}
            {cards.length > 0 ? "Kartı değiştir" : "Kart ekle"}
          </Button>
        </div>

        {cardsQuery.isLoading ? (
          <div className="mt-3 h-14 animate-pulse rounded-xl bg-muted" aria-hidden="true" />
        ) : cards.length === 0 ? (
          <p className="mt-3 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
            Henüz kart eklenmemiş. Kart eklemeden aylık tahsilat yapılamaz.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {cards.map((card) => (
              <li
                key={card.id}
                className="flex items-center gap-3 rounded-xl border p-3"
              >
                <CreditCard className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-semibold">
                    {card.masked_number}
                  </p>
                  <p className="text-[0.7rem] text-muted-foreground">
                    {[card.card_association, card.card_family]
                      .filter(Boolean)
                      .join(" · ") || "Kart"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${card.masked_number} kartını kaldır`}
                  disabled={removeMutation.isPending}
                  onClick={() => removeMutation.mutate(card.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <h3 className="font-semibold">Faturalar</h3>
        {invoicesQuery.isLoading ? (
          <div className="mt-3 h-14 animate-pulse rounded-xl bg-muted" aria-hidden="true" />
        ) : invoices.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Henüz fatura kesilmedi.
          </p>
        ) : (
          <ul className="mt-3 divide-y">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {month.format(new Date(invoice.period_start))}
                  </p>
                  {/* What the amount is made of, so an increase is explainable. */}
                  <p className="text-[0.7rem] text-muted-foreground">
                    {invoice.branch_count} şube · temel{" "}
                    {money.format(Number(invoice.base_amount))}
                    {Number(invoice.extra_branch_amount) > 0
                      ? ` + ek ${money.format(Number(invoice.extra_branch_amount))}`
                      : ""}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-lg px-2 py-1 text-[0.65rem] font-semibold",
                    invoice.status === "PAID"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : invoice.status === "FAILED"
                        ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {STATUS_LABELS[invoice.status] ?? invoice.status}
                </span>
                <span className="w-24 shrink-0 text-right font-semibold tabular-nums">
                  {money.format(Number(invoice.amount))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
