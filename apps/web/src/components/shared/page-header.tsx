import { type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: LucideIcon;
  className?: string;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  icon: Icon,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3.5">
        {Icon ? (
          <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl border border-brand/15 bg-brand-soft text-brand shadow-sm">
            <Icon className="size-5" />
          </span>
        ) : null}
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.17em] text-brand">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-[1.75rem]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
