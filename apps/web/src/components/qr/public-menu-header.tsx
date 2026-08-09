import { MapPin } from "lucide-react"
import Image from "next/image"

import { BrandLogo } from "@/components/brand/brand-logo"
import { QR_LOCALES, translate, type QrLocale } from "@/components/qr/qr-i18n"
import type { PublicQrMenuDto } from "@/components/qr/types"
import { cn } from "@/lib/utils"

interface PublicMenuHeaderProps {
  menu: PublicQrMenuDto
  locale: QrLocale
  onLocaleChange: (locale: QrLocale) => void
}

export function PublicMenuHeader({ menu, locale, onLocaleChange }: PublicMenuHeaderProps) {
  const menuName = menu.config.menu_name || menu.business

  return (
    <header className="relative isolate overflow-hidden text-white">
      {menu.config.cover_image_url ? (
        <>
          <Image
            src={menu.config.cover_image_url}
            alt=""
            fill
            priority
            sizes="100vw"
            className="-z-20 object-cover"
          />
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/85 via-black/45 to-black/10" />
        </>
      ) : (
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(135deg, var(--qr-primary), color-mix(in srgb, var(--qr-primary) 55%, black))",
          }}
        />
      )}

      <div className="mx-auto flex min-h-56 max-w-4xl flex-col px-5 pb-7 pt-5 sm:min-h-64 sm:px-8 sm:pb-9 sm:pt-7">
        <div className="flex items-center justify-between gap-4">
          {menu.config.logo_url ? (
            <div className="relative size-12 overflow-hidden rounded-2xl border border-white/20 bg-white p-2 sm:size-14">
              <Image
                src={menu.config.logo_url}
                alt={`${menu.business} logosu`}
                fill
                sizes="56px"
                className="object-contain p-1.5"
              />
            </div>
          ) : (
            <BrandLogo
              theme="dark"
              withWordmark={false}
              className="size-11 rounded-2xl border border-white/20 bg-white/10 p-2 sm:size-13"
            />
          )}

          <div className="flex shrink-0 items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold backdrop-blur-sm">
              <MapPin className="size-3.5" />
              {menu.table_name || menu.branch}
            </span>
            <div
              role="group"
              aria-label="Language / Dil / Язык"
              className="flex items-center gap-0.5 rounded-full bg-white/15 p-1 backdrop-blur-sm"
            >
              {QR_LOCALES.map((option) => (
                <button
                  key={option.code}
                  type="button"
                  onClick={() => onLocaleChange(option.code)}
                  aria-pressed={locale === option.code}
                  className={cn(
                    "min-h-6 rounded-full px-2 text-[0.65rem] font-bold transition-colors",
                    locale === option.code
                      ? "bg-white text-black"
                      : "text-white/85 hover:bg-white/10",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-auto max-w-2xl pt-10">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
            {menu.branch}
          </p>
          <h1 className="mt-1.5 max-w-xl text-3xl font-bold tracking-[-0.03em] text-balance sm:text-4xl">
            {menuName}
          </h1>
          <p className="mt-2.5 max-w-lg text-sm leading-6 text-white/70">
            {translate(locale, "tagline", { business: menu.business })}
          </p>
        </div>
      </div>
    </header>
  )
}
