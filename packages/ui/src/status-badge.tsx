import type { HTMLAttributes } from "react";

export type StatusTone =
  "neutral" | "info" | "success" | "warning" | "danger" | "brand";

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
}

export function StatusBadge({
  tone = "neutral",
  className = "",
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={`dixora-status-badge ${className}`.trim()}
      data-tone={tone}
      {...props}
    >
      <span aria-hidden="true" className="dixora-status-badge__dot" />
      {children}
    </span>
  );
}
