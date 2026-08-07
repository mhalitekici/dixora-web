import {
  AlertTriangle,
  CheckCircle2,
  Info,
  type LucideIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type NoticeTone = "live" | "adapter" | "warning"

const noticeStyles: Record<
  NoticeTone,
  { icon: LucideIcon; className: string; iconClassName: string }
> = {
  live: {
    icon: CheckCircle2,
    className:
      "border-emerald-600/20 bg-emerald-500/[0.06] text-emerald-950 dark:text-emerald-100",
    iconClassName: "text-emerald-600 dark:text-emerald-400",
  },
  adapter: {
    icon: Info,
    className:
      "border-blue-600/20 bg-blue-500/[0.06] text-blue-950 dark:text-blue-100",
    iconClassName: "text-blue-600 dark:text-blue-400",
  },
  warning: {
    icon: AlertTriangle,
    className:
      "border-amber-600/20 bg-amber-500/[0.07] text-amber-950 dark:text-amber-100",
    iconClassName: "text-amber-600 dark:text-amber-400",
  },
}

export function AdapterNotice({
  title,
  children,
  tone = "adapter",
  badge,
  className,
}: {
  title: string
  children: ReactNode
  tone?: NoticeTone
  badge?: string
  className?: string
}) {
  const style = noticeStyles[tone]
  const Icon = style.icon

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3",
        style.className,
        className,
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", style.iconClassName)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold">{title}</p>
          {badge ? (
            <Badge variant="outline" className="h-5 bg-background/70 text-[0.62rem]">
              {badge}
            </Badge>
          ) : null}
        </div>
        <div className="mt-1 text-xs leading-5 text-current/75">{children}</div>
      </div>
    </div>
  )
}
