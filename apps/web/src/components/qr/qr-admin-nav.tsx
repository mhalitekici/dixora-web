"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { qrNavigation } from "@/components/layout/nav-config"
import { cn } from "@/lib/utils"

export function QrAdminNav() {
  const pathname = usePathname()
  const items = qrNavigation[0]?.items ?? []

  return (
    <nav
      aria-label="QR menü yönetimi"
      className="scrollbar-subtle mb-6 flex gap-1 overflow-x-auto rounded-xl border bg-card p-1"
      data-print-hidden="true"
    >
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-operational flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors",
              active
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
