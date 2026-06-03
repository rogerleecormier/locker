import * as React from "react";
import { Badge } from "./ui/badge";

interface PageHeaderProps {
  title: string;
  icon?: React.ReactNode;
  description?: string;
  count?: number;
  countLabel?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export function PageHeader({
  title,
  icon,
  description,
  count,
  countLabel = "entries",
  actions,
  children,
}: PageHeaderProps) {
  return (
    <div className="w-full bg-surface2 border-b border-border py-5 px-4 md:px-8">
      <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2.5 mb-1">
            {icon && <div className="text-accent flex items-center">{icon}</div>}
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-text leading-none select-none">
              {title}
            </h1>
            {count !== undefined && (
              <Badge variant="accent" className="font-semibold px-2 py-0.5 normal-case tracking-normal">
                {count} {countLabel}
              </Badge>
            )}
          </div>
          {description && (
            <p className="text-text-muted text-xs md:text-sm max-w-2xl select-none leading-relaxed">
              {description}
            </p>
          )}
          {children}
        </div>
        {actions && (
          <div className="flex items-center gap-3 flex-shrink-0 self-start md:self-auto">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
