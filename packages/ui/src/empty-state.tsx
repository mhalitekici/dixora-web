import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <section className={`dixora-empty-state ${className}`.trim()}>
      {icon ? <div className="dixora-empty-state__icon">{icon}</div> : null}
      <h2 className="dixora-empty-state__title">{title}</h2>
      <p className="dixora-empty-state__description">{description}</p>
      {action ? (
        <div className="dixora-empty-state__action">{action}</div>
      ) : null}
    </section>
  );
}
