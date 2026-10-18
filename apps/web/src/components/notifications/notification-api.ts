import { api } from "@/lib/api"

export type NotificationStatus = "PENDING" | "SENT" | "FAILED" | "CANCELLED"

export type CustomerNotification = {
  id: string
  notification_type: string
  recipient: string
  title: string
  status: NotificationStatus
  attempts: number
  retry_scheduled: boolean
  created_at: string
  sent_at: string | null
  next_attempt_at: string | null
}

export type NotificationOverview = {
  delivery_mode: "DEVELOPMENT" | "SMTP" | "RESEND" | "DISABLED"
  counts: Record<NotificationStatus, number>
  items: CustomerNotification[]
}

export const notificationApi = {
  list: (signal?: AbortSignal) =>
    api.get<NotificationOverview>("notifications", { signal }),
}
