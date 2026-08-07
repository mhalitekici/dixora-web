import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatCardProps = {
  title: string;
  value: ReactNode;
  detail?: string;
  trend?: number;
  icon: LucideIcon;
  tone?: "default" | "brand" | "success" | "warning" | "info";
  footer?: ReactNode;
  className?: string;
};

const toneClasses = {
  default: "bg-muted text-foreground",
  brand: "bg-brand-soft text-brand",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  info: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
};

export function StatCard({
  title,
  value,
  detail,
  trend,
  icon: Icon,
  tone = "default",
  footer,
  className,
}: StatCardProps) {
  const TrendIcon = trend === undefined || trend === 0 ? Minus : trend > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className={cn("gap-3 shadow-[0_1px_2px_rgb(0_0_0/0.03)]", className)}>
      <CardHeader className="flex-row items-center justify-between">
        <p className="text-[0.78rem] font-medium text-muted-foreground">{title}</p>
        <span className={cn("flex size-8 items-center justify-center rounded-xl", toneClasses[tone])}>
          <Icon className="size-4" />
        </span>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-3">
          <p className="text-2xl font-semibold tracking-[-0.04em] tabular-nums">{value}</p>
          {trend !== undefined ? (
            <span
              className={cn(
                "mb-0.5 inline-flex items-center text-xs font-semibold tabular-nums",
                trend > 0
                  ? "text-emerald-700 dark:text-emerald-300"
                  : trend < 0
                    ? "text-destructive"
                    : "text-muted-foreground",
              )}
            >
              <TrendIcon className="mr-0.5 size-3.5" />
              {Math.abs(trend)}%
            </span>
          ) : null}
        </div>
        {detail ? <p className="mt-1.5 text-xs text-muted-foreground">{detail}</p> : null}
        {footer ? <div className="mt-3">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}
