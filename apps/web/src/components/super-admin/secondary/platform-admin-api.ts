import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"

import type {
  AuditLogEntry,
  AuditLogFeed,
  PlatformBusiness,
  SubscriptionPlan,
  SubscriptionPortfolio,
  SupportModeCapability,
  SystemHealthSnapshot,
  TenantState,
  TenantSubscriptionRow,
} from "./types"

const PLATFORM_AUDIT_WINDOW = 250

export const secondaryAdminQueryKeys = {
  business: (businessId: string) =>
    ["secondary-admin", "business", businessId] as const,
  subscriptions: ["secondary-admin", "subscriptions"] as const,
  system: ["secondary-admin", "system"] as const,
  audit: ["secondary-admin", "audit"] as const,
}

export const supportModeCapability: SupportModeCapability = {
  available: false,
  contract: "platform-support-session-v1",
  explanation:
    "API henüz gerekçe, süre, tenant kapsamı ve çıkış kaydı üreten denetlenebilir bir destek oturumu endpointi sunmuyor.",
}

export async function getBusiness(
  businessId: string,
  signal?: AbortSignal,
): Promise<PlatformBusiness> {
  return api.get<PlatformBusiness>(`businesses/${businessId}`, { signal })
}

export async function setBusinessLifecycle(
  businessId: string,
  next: "activate" | "suspend",
): Promise<PlatformBusiness> {
  const body: { state: TenantState; is_active: boolean } =
    next === "activate"
      ? { state: "ACTIVE", is_active: true }
      : { state: "SUSPENDED", is_active: false }

  return api.patch<PlatformBusiness>(`businesses/${businessId}`, body)
}

export async function reactivateBusiness(
  businessId: string,
  input: { extendDays: number; note?: string },
): Promise<PlatformBusiness> {
  return api.post<PlatformBusiness>(`businesses/${businessId}/reactivate`, {
    extend_days: input.extendDays,
    note: input.note?.trim() || null,
  })
}

export interface BusinessUser {
  id: string
  username: string
  display_name: string
  email: string | null
  role: string
  is_active: boolean
}

export async function getBusinessUsers(
  businessId: string,
  signal?: AbortSignal,
): Promise<BusinessUser[]> {
  return api.get<BusinessUser[]>(`businesses/${businessId}/users`, { signal })
}

export async function resetBusinessUserPassword(
  businessId: string,
  userId: string,
  input: { newPassword: string; reason?: string },
): Promise<{ user_id: string; username: string; sessions_revoked: number }> {
  return api.post(`businesses/${businessId}/users/${userId}/password-reset`, {
    new_password: input.newPassword,
    reason: input.reason?.trim() || null,
  })
}

export async function getSubscriptionPortfolio(
  signal?: AbortSignal,
): Promise<SubscriptionPortfolio> {
  const [plansResult, portfolioResult] = await Promise.allSettled([
    api.get<SubscriptionPlan[]>("subscriptions/plans", { signal }),
    api.get<Array<Omit<TenantSubscriptionRow, "source">>>("subscriptions/portfolio", { signal }),
  ])

  if (signal?.aborted) {
    throw new DOMException("İstek iptal edildi.", "AbortError")
  }

  if (
    plansResult.status === "rejected" &&
    portfolioResult.status === "rejected"
  ) {
    throw plansResult.reason
  }

  const issues: string[] = []
  if (plansResult.status === "rejected") {
    issues.push(
      "Plan kataloğu alınamadı; canlı tenant-abonelik eşleşmeleri gösteriliyor.",
    )
  }
  if (portfolioResult.status === "rejected") {
    issues.push(
      "Tenant abonelik eşleşmeleri alınamadı; yalnız plan kataloğu gösteriliyor.",
    )
  }

  const businesses =
    portfolioResult.status === "fulfilled"
      ? portfolioResult.value.map((row) => ({
          ...row,
          source: "subscription-api" as const,
        }))
      : []

  return {
    businesses,
    plans: plansResult.status === "fulfilled" ? plansResult.value : [],
    issues,
    tenantSubscriptionSource: "subscription-api",
  }
}

export async function getAuditLogFeed(
  signal?: AbortSignal,
): Promise<AuditLogFeed> {
  try {
    const items = await api.get<AuditLogEntry[]>("audit-logs", {
      search: { limit: PLATFORM_AUDIT_WINDOW },
      signal,
    })

    return {
      items,
      availability: "live",
      scope: "current-identity",
      maxRecords: PLATFORM_AUDIT_WINDOW,
      limitation:
        "Mevcut API yalnız son 250 kaydı döndürüyor; filtreleme ve sayfalama bu canlı pencere üzerinde uygulanıyor.",
    }
  } catch (error) {
    if (
      isApiError(error) &&
      error.status === 400 &&
      error.code === "tenant_context_required"
    ) {
      return {
        items: [],
        availability: "tenant-scope-required",
        scope: "current-identity",
        maxRecords: PLATFORM_AUDIT_WINDOW,
        limitation:
          "Mevcut audit endpointi tenant bağlamı istiyor ve platform-geneli kayıt akışı sunmuyor. Adapter hazır; platform scope endpointi bağlandığında aynı filtre ve sayfalama kullanılacak.",
      }
    }

    throw error
  }
}

export async function getSystemHealth(
  signal?: AbortSignal,
): Promise<SystemHealthSnapshot> {
  const response = await fetch("/super-admin/system/status", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal,
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string }
    } | null
    throw new Error(
      body?.error?.message ?? "Sistem sağlık sinyalleri alınamadı.",
    )
  }

  return (await response.json()) as SystemHealthSnapshot
}
