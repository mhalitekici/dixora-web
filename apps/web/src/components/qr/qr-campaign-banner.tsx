"use client"

import { Gift } from "lucide-react"

import { usePublicQrCampaigns } from "@/components/qr/qr-hooks"
import { translate, type QrLocale } from "@/components/qr/qr-i18n"

interface QrCampaignBannerProps {
  businessSlug: string
  branchSlug: string
  locale: QrLocale
}

/**
 * The offers running at this branch, above the menu.
 *
 * Renders nothing at all when there is no offer, while loading, or when the
 * request failed: a guest came here to read the menu, and an empty box or an
 * error where an offer would be is worse than no strip at all.
 */
export function QrCampaignBanner({
  businessSlug,
  branchSlug,
  locale,
}: QrCampaignBannerProps) {
  const campaignsQuery = usePublicQrCampaigns(businessSlug, branchSlug)
  const campaigns = campaignsQuery.data ?? []

  if (campaigns.length === 0) {
    return null
  }

  return (
    <section
      aria-label={translate(locale, "campaigns_title")}
      className="mb-6 flex flex-col gap-2"
    >
      {campaigns.map((campaign) => {
        // Members-only offers are shown too, but a guest must not read one as
        // something they already qualify for.
        const prefix =
          campaign.audience === "MEMBERS_ONLY"
            ? translate(locale, "campaign_members_only")
            : translate(locale, "campaign_label")
        return (
          <article
            key={campaign.id}
            className="flex items-start gap-3 rounded-2xl border border-[var(--qr-primary)]/25 bg-[var(--qr-primary)]/8 px-4 py-3.5"
          >
            <Gift
              aria-hidden
              className="mt-0.5 size-5 shrink-0 text-[var(--qr-primary)]"
            />
            <div className="min-w-0">
              <p className="text-sm leading-6 font-medium text-foreground">
                <span className="text-[var(--qr-primary)]">{prefix}:</span>{" "}
                {campaign.summary}
              </p>
              {campaign.description ? (
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {campaign.description}
                </p>
              ) : null}
            </div>
          </article>
        )
      })}
    </section>
  )
}
