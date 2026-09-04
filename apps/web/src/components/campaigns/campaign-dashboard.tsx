"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Megaphone, Pencil, Plus, Power } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import {
  AUDIENCE_LABELS,
  REWARD_KIND_LABELS,
  type Campaign,
  campaignApi,
  campaignKeys,
} from "@/components/campaigns/campaign-api"
import { CampaignFormDialog } from "@/components/campaigns/campaign-form-dialog"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function CampaignDashboard() {
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Campaign | null>(null)

  const campaignsQuery = useQuery({
    queryKey: campaignKeys.list(),
    queryFn: ({ signal }) => campaignApi.list(signal),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => campaignApi.deactivate(id),
    onSuccess: async () => {
      toast.success("Kampanya durduruldu")
      await queryClient.invalidateQueries({ queryKey: campaignKeys.root })
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Kampanya durdurulamadı."),
  })

  const campaigns = campaignsQuery.data ?? []

  function openNew() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(campaign: Campaign) {
    setEditing(campaign)
    setFormOpen(true)
  }

  return (
    <div className="min-h-full bg-muted/20 p-4 sm:p-6">
      <PageHeader
        eyebrow="Pazarlama"
        title="Kampanyalar"
        description="Şunu alana şunu ver kurgusunda teklifler. Sadakat programından bağımsızdır; aynı anda birden fazla kampanya çalışabilir."
        icon={Megaphone}
        actions={
          <Button size="lg" onClick={openNew}>
            <Plus aria-hidden="true" />
            Yeni Kampanya
          </Button>
        }
      />

      {formOpen ? (
        // Remounted per open so the form always starts from the row being
        // edited rather than whatever was typed last time.
        <CampaignFormDialog
          key={editing?.id ?? "new"}
          open={formOpen}
          onOpenChange={setFormOpen}
          editing={editing}
        />
      ) : null}

      {campaignsQuery.isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1].map((index) => (
            <div
              key={index}
              className="h-28 animate-pulse rounded-2xl border bg-card"
              aria-hidden="true"
            />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <EmptyState
          title="Henüz kampanya yok"
          description="Örneğin “kahve alana tatlı ikram” gibi bir teklif tanımlayın; kasada otomatik uygulanır."
          icon={Megaphone}
          action={
            <Button onClick={openNew}>
              <Plus aria-hidden="true" />
              Yeni Kampanya
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {campaigns.map((campaign) => (
            <li
              key={campaign.id}
              className={cn(
                "rounded-2xl border bg-card p-4",
                !campaign.is_active && "opacity-60",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{campaign.name}</h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {campaign.summary}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-lg px-2 py-1 text-[0.65rem] font-semibold",
                    campaign.is_active
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {campaign.is_active ? "Aktif" : "Durduruldu"}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5 text-[0.65rem]">
                <span className="rounded-lg bg-muted px-2 py-1 font-medium">
                  {REWARD_KIND_LABELS[campaign.reward_kind]}
                </span>
                <span className="rounded-lg bg-muted px-2 py-1 font-medium">
                  {AUDIENCE_LABELS[campaign.audience]}
                </span>
                <span className="rounded-lg bg-muted px-2 py-1 font-medium">
                  {campaign.branch_ids.length} şube
                </span>
              </div>

              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => openEdit(campaign)}
                >
                  <Pencil aria-hidden="true" />
                  Düzenle
                </Button>
                {campaign.is_active ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    disabled={deactivateMutation.isPending}
                    onClick={() => deactivateMutation.mutate(campaign.id)}
                  >
                    <Power aria-hidden="true" />
                    Durdur
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
