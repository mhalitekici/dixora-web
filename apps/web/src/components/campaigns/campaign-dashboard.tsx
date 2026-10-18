"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { Mail, Megaphone, Pencil, Plus, Power } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import {
  AUDIENCE_LABELS,
  REWARD_KIND_LABELS,
  type Campaign,
  type CampaignNotificationStatus,
  campaignApi,
  campaignKeys,
} from "@/components/campaigns/campaign-api"
import { CampaignFormDialog } from "@/components/campaigns/campaign-form-dialog"
import { ErrorState } from "@/components/admin/admin-utils"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const notificationLabels: Record<CampaignNotificationStatus, string> = {
  NOT_REQUESTED: "E-posta duyurusu kapalı",
  NO_RECIPIENTS: "E-posta izni veren uygun üye yok",
  PENDING: "E-posta duyurusu gönderiliyor",
  SENT: "E-posta duyurusu gönderildi",
  FAILED: "E-posta gönderiminde hata oluştu",
  CANCELLED: "E-posta duyurusu iptal edildi",
}

export function CampaignDashboard() {
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Campaign | null>(null)

  const campaignsQuery = useQuery({
    queryKey: campaignKeys.list(),
    queryFn: ({ signal }) => campaignApi.list(signal),
    refetchInterval: (query) =>
      query.state.data?.some((item) =>
        ["PENDING", "FAILED"].includes(item.email_notification_status),
      )
        ? 10_000
        : false,
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => campaignApi.deactivate(id),
    onSuccess: async () => {
      toast.success("Kampanya durduruldu")
      await queryClient.invalidateQueries({ queryKey: campaignKeys.root })
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Kampanya durdurulamadı.",
      ),
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
        eyebrow="Kampanyalar ve Sadakat"
        title="Kampanyalar"
        description="Üyelerinize özel teklifler oluşturun. Yayınladığınız kampanyalar e-posta izni veren üyelere otomatik duyurulur."
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
      ) : campaignsQuery.isError ? (
        <ErrorState
          error={campaignsQuery.error}
          onRetry={() => void campaignsQuery.refetch()}
        />
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

              <Link
                href="/admin/notifications"
                className="mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Mail className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {notificationLabels[campaign.email_notification_status]}
                  {campaign.email_notification_recipients > 0
                    ? ` · ${campaign.email_notification_recipients} üye`
                    : ""}
                </span>
              </Link>

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
