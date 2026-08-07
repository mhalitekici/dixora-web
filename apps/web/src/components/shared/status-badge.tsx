import { Circle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StatusTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "purple";

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-border bg-muted/70 text-muted-foreground",
  brand: "border-brand/20 bg-brand/10 text-brand",
  success: "border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-600/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "border-red-600/20 bg-red-500/10 text-red-700 dark:text-red-300",
  info: "border-blue-600/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  purple: "border-violet-600/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
};

export function StatusBadge({
  children,
  tone = "neutral",
  dot = true,
  pulse = false,
  className,
}: {
  children: React.ReactNode;
  tone?: StatusTone;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("h-6 rounded-full px-2.5 font-semibold", toneClasses[tone], className)}
    >
      {dot ? (
        <span className="relative flex size-1.5">
          {pulse ? (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-40" />
          ) : null}
          <Circle className="relative size-1.5 fill-current stroke-none" />
        </span>
      ) : null}
      {children}
    </Badge>
  );
}
