import * as React from "react";
import { cn } from "@/lib/cn";
import { Card } from "./card";

/**
 * Panel — a titled card: heading, optional subtitle, optional action, content.
 *
 * Ported from `client/src/components/ui/panel.tsx` with the same default
 * (`<h2>`), which is the part that matters: the audit that put `titleAs` there
 * (F13) was about heading order, and a port that quietly reverted to `<h3>`
 * would re-open it on every portal screen at once.
 *
 * The subtitle is for qualifying the figures — units, scope, as-of date
 * ("Balance générale · base OHADA") — never a second sentence of prose.
 */
export function Panel({
  title,
  subtitle,
  action,
  titleAs: Tag = "h2",
  children,
  className,
  bodyClassName,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  titleAs?: "h2" | "h3";
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Tag className="text-title font-semibold leading-tight tracking-tight">
            {title}
          </Tag>
          {subtitle && (
            <div className="mt-0.5 text-micro uppercase text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className={bodyClassName}>{children}</div>
    </Card>
  );
}
