import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

export function StampProgress({
  value,
  target,
  className,
  stampClassName,
  completeClassName,
  pendingClassName,
}: {
  value: number
  target: number
  className?: string
  stampClassName?: string
  completeClassName?: string
  pendingClassName?: string
}) {
  const safeTarget = Math.max(1, Math.round(target))
  const safeValue = Math.min(safeTarget, Math.max(0, value))
  const visibleStampCount = Math.min(safeTarget, 8)
  const completedStampCount =
    safeTarget <= visibleStampCount
      ? Math.floor(safeValue)
      : Math.floor((safeValue / safeTarget) * visibleStampCount)

  return (
    <div
      className={cn("relative", className)}
      role="progressbar"
      aria-label="Ödül ilerlemesi"
      aria-valuemin={0}
      aria-valuemax={safeTarget}
      aria-valuenow={safeValue}
      aria-valuetext={`${safeValue} / ${safeTarget}`}
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-5 top-1/2 border-t-2 border-dashed border-current/15"
      />
      <div
        aria-hidden="true"
        className="relative grid gap-2"
        style={{ gridTemplateColumns: `repeat(${visibleStampCount}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: visibleStampCount }, (_, index) => {
          const complete = index < completedStampCount
          const milestone =
            safeTarget <= visibleStampCount
              ? index + 1
              : Math.ceil(((index + 1) * safeTarget) / visibleStampCount)
          return (
            <span
              key={index}
              className={cn(
                "mx-auto flex size-9 items-center justify-center rounded-full border-2 border-dashed bg-card text-[0.65rem] font-bold tabular-nums transition-colors sm:size-10",
                complete
                  ? "border-brand bg-brand text-brand-foreground shadow-[0_0_0_4px_var(--brand-soft)]"
                  : "border-current/25 text-muted-foreground",
                stampClassName,
                complete ? completeClassName : pendingClassName,
              )}
            >
              {complete ? <Check className="size-4" strokeWidth={3} /> : milestone}
            </span>
          )
        })}
      </div>
    </div>
  )
}
