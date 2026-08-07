import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <header className={`dixora-page-header ${className}`.trim()}>
      <div className="dixora-page-header__copy">
        {eyebrow ? (
          <p className="dixora-page-header__eyebrow">{eyebrow}</p>
        ) : null}
        <h1 className="dixora-page-header__title">{title}</h1>
        {description ? (
          <p className="dixora-page-header__description">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="dixora-page-header__actions">{actions}</div>
      ) : null}
    </header>
  );
}
