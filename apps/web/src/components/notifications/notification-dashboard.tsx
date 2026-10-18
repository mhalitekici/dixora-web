"use client"

import { useQuery } from "@tanstack/react-query"
import { Bell, Gift, Megaphone, RefreshCw } from "lucide-react"

import {
  dateTime,
  ErrorState,
  LoadingState,
  number,
} from "@/components/admin/admin-utils"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { notificationApi, type NotificationStatus } from "./notification-api"

const statuses = {
  PENDING: { label: "Sırada", tone: "warning" },
  SENT: { label: "Gönderildi", tone: "success" },
  FAILED: { label: "Gönderilemedi", tone: "danger" },
  CANCELLED: { label: "İptal edildi", tone: "neutral" },
} as const

export function NotificationDashboard() {
  const query = useQuery({
    queryKey: ["customer-notifications"],
    queryFn: ({ signal }) => notificationApi.list(signal),
    refetchInterval: 10_000,
  })

  return (
    <>
      <PageHeader
        eyebrow="Kampanyalar ve Sadakat"
        title="Müşteri Bildirimleri"
        description="Kampanya duyuruları ve kazanılan sadakat ödülleri e-posta ile otomatik gönderilir. Gönderim durumlarını buradan takip edin."
        icon={Bell}
        actions={
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw
              className={query.isFetching ? "animate-spin" : ""}
              aria-hidden="true"
            />
            Yenile
          </Button>
        }
      />
      {query.isLoading ? (
        <LoadingState label="Bildirimler yükleniyor…" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data ? (
        <div className="space-y-5">
          {query.data.delivery_mode === "DEVELOPMENT" ? (
            <p role="status" className="rounded-xl border bg-muted p-3 text-sm">
              Geliştirme modu açık. Bildirimler kaydedilir; gerçek e-posta
              gönderilmez.
            </p>
          ) : query.data.delivery_mode === "DISABLED" ? (
            <p
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm"
            >
              E-posta gönderimi kapalı. Gönderim sağlayıcısı
              yapılandırılmalıdır.
            </p>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(Object.keys(statuses) as NotificationStatus[]).map((status) => (
              <div key={status} className="rounded-xl border bg-card p-4">
                <dt className="text-sm text-muted-foreground">
                  {statuses[status].label}
                </dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">
                  {number(query.data!.counts[status])}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-sm leading-6 text-muted-foreground">
            Kampanyalar yalnızca seçili şubelerdeki e-posta izni veren üyelere
            duyurulur. Kazanılan ödüller müşterinin doğrulanmış e-posta adresine
            bildirilir. Başarısız gönderimler otomatik olarak yeniden denenir.
          </p>
          {query.data.items.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="Henüz bildirim yok"
              description="İlk kampanya yayınlandığında veya bir müşteri ödül kazandığında gönderimler burada görünür."
            />
          ) : (
            <section
              aria-label="Son bildirimler"
              className="rounded-xl border bg-card"
            >
              <h2 className="border-b px-4 py-3 text-sm font-semibold">
                Son {number(query.data.items.length)} bildirim
              </h2>
              <ul className="divide-y">
                {query.data.items.map((item) => {
                  const reward =
                    item.notification_type === "LOYALTY_REWARD_AVAILABLE"
                  const Icon = reward ? Gift : Megaphone
                  const status = statuses[item.status]
                  return (
                    <li
                      key={item.id}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="flex min-w-0 gap-3">
                        <Icon
                          className="mt-0.5 size-4 shrink-0 text-brand"
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">
                            {reward ? "Sadakat ödülü" : "Kampanya duyurusu"}
                          </p>
                          <h3 className="mt-0.5 break-words text-sm font-semibold">
                            {item.title}
                          </h3>
                          <p className="mt-1 break-all text-xs text-muted-foreground">
                            {item.recipient} · {dateTime(item.created_at)}
                          </p>
                          {item.retry_scheduled ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {item.next_attempt_at
                                ? `Sonraki deneme: ${dateTime(item.next_attempt_at)}`
                                : "Yeniden gönderim sırada"}
                            </p>
                          ) : item.sent_at ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Gönderim: {dateTime(item.sent_at)}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                        <StatusBadge
                          tone={item.retry_scheduled ? "warning" : status.tone}
                        >
                          {item.retry_scheduled
                            ? "Yeniden denenecek"
                            : status.label}
                        </StatusBadge>
                        {item.attempts > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            {item.attempts} deneme
                          </span>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </div>
      ) : null}
    </>
  )
}
