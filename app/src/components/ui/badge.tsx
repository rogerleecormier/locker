import * as React from "react";
import { cn } from "~/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "success" | "error" | "accent" | "configs" | "stack" | "rules" | "projects" | "references" | "governance" | "devops" | "devsecops" | "compliance" | "documentation" | "cicd" | "project_management" | "product_management";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-hidden focus:ring-2 focus:ring-accent focus:ring-offset-2 select-none uppercase tracking-wider text-[10px]",
        {
          "border-transparent bg-accent text-white": variant === "default",
          "border-border bg-surface2 text-text-muted": variant === "secondary",
          "border-success/30 bg-success/10 text-success": variant === "success",
          "border-error/30 bg-error/10 text-error": variant === "error",
          "border-accent/40 bg-accent-dim text-accent-hover": variant === "accent",
          // Memory Categories
          "border-purple-500/40 bg-purple-500/10 text-purple-400": variant === "configs" || variant === "stack",
          "border-indigo-500/40 bg-indigo-500/10 text-indigo-400": variant === "rules",
          "border-emerald-500/40 bg-emerald-500/10 text-emerald-400": variant === "projects" || variant === "governance",
          "border-amber-500/40 bg-amber-500/10 text-amber-400": variant === "references",
          // Template Categories
          "border-blue-500/40 bg-blue-500/10 text-blue-400": variant === "devops" || variant === "cicd",
          "border-red-500/40 bg-red-500/10 text-red-400": variant === "compliance" || variant === "devsecops",
          "border-orange-500/40 bg-orange-500/10 text-orange-400": variant === "documentation" || variant === "project_management" || variant === "product_management",
        },
        className
      )}
      {...props}
    />
  );
}

export { Badge };
