import { MapPin, UtensilsCrossed } from "lucide-react"
import Image from "next/image"

import { BrandLogo } from "@/components/brand/brand-logo"
import type { PublicQrMenuDto } from "@/components/qr/types"

interface PublicMenuHeaderProps {
  menu: PublicQrMenuDto
}

export function PublicMenuHeader({ menu }: PublicMenuHeaderProps) {
  const menuName = menu.config.menu_name || menu.business

  return (
    <header className="relative isolate overflow-hidden bg-[#24201e] text-[#fffaf2]">
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
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(25,21,19,.94)_0%,rgba(25,21,19,.72)_52%,rgba(25,21,19,.38)_100%)]" />
        </>
      ) : (
        <div className="absolute inset-0 -z-10 opacity-20 [background-image:repeating-linear-gradient(135deg,transparent_0,transparent_18px,rgba(255,250,242,.08)_18px,rgba(255,250,242,.08)_19px)]" />
      )}

      <div className="mx-auto flex min-h-64 max-w-4xl flex-col px-5 pb-9 pt-5 sm:min-h-72 sm:px-8 sm:pb-11 sm:pt-7">
        <div className="flex items-start justify-between gap-4">
          {menu.config.logo_url ? (
            <div className="relative size-14 overflow-hidden rounded-xl border border-white/15 bg-[#fffaf2] p-2 sm:size-16">
              <Image
                src={menu.config.logo_url}
                alt={`${menu.business} logosu`}
                fill
                sizes="64px"
                className="object-contain p-2"
              />
            </div>
          ) : (
            <BrandLogo
              theme="dark"
              withWordmark={false}
              className="size-12 rounded-xl border border-white/15 bg-white/8 p-2"
            />
          )}

          <div className="flex items-center gap-2 border-b border-white/20 pb-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-white/70">
            <UtensilsCrossed className="size-3.5 text-[var(--qr-primary)]" />
            Günlük menü
          </div>
        </div>

        <div className="mt-auto max-w-2xl pt-12">
          <p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--qr-primary)]">
            {menu.branch} · Servise hazır
          </p>
          <h1 className="mt-2 max-w-xl font-serif text-4xl font-semibold leading-[0.98] tracking-[-0.04em] text-balance sm:text-5xl">
            {menuName}
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-white/65">
            {menu.business} mutfağından güncel lezzetler ve masa servisi.
          </p>
        </div>
      </div>

      <div className="absolute bottom-0 right-4 min-w-40 bg-[#fffaf2] px-5 py-3 text-[#24201e] [clip-path:polygon(9px_0,100%_0,100%_100%,9px_100%,0_calc(100%_-_9px),0_9px)] sm:right-8">
        <p className="font-mono text-[0.6rem] font-bold uppercase tracking-[0.16em] text-[#7b716b]">
          {menu.table_name ? "Masa servisi" : "Şube menüsü"}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm font-bold">
          <MapPin className="size-3.5 text-[var(--qr-primary)]" />
          {menu.table_name || menu.branch}
        </p>
      </div>
    </header>
  )
}
