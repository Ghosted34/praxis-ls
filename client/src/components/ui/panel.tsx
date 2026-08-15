/**
 * Panel — a titled card: heading, optional subtitle, optional action, content.
 *
 * Consolidates SIX independent copies of the same block (F6 / A3):
 * `workspace/workspace-page.tsx:29`, `vault/hub.tsx:44`, `security/hub.tsx:52`,
 * `portal/portal-app.tsx:233`, and `finance/hub.tsx`'s `AgeingPanel` (:70) and
 * `CashPanel` (:115), which the audit singles out as *"the identical 'panel
 * with a serif title and a CTA' block … independently written"* three times.
 * They differed only in which of `subtitle` / `action` they happened to support.
 *
 * Built on `<Card>` so there is one card surface, not a seventh recipe.
 *
 * HEADING LEVEL. Defaults to `<h2>`. Since Phase 1, `PageHeader` always renders
 * the page's `<h1>`, so panels sitting directly in a page are `<h2>` and the
 * outline is correct by default — the copies all hardcoded `<h3>`, which is why
 * F13 found `<h3>`s in pages with no `<h2>`. Pass `titleAs="h3"` only when the
 * panel really is nested under another heading.
 *
 * @example
 * <Panel title="Receivables ageing" subtitle="Smart receivables ledger · XAF">
 *   {rows.map(…)}
 * </Panel>
 *
 * @example  // with a call to action
 * <Panel title="Awaiting your approval" action={<Button variant="outline">See all</Button>}>
 *   <ApprovalList items={items} />
 * </Panel>
 *
 * BEST PRACTICE. The subtitle is for qualifying the figures — units, scope, as-of
 * date ("Smart receivables ledger · XAF") — not for a second sentence of prose.
 * If a panel needs explaining at length, the explanation belongs in the page
 * description. Keep `action` to one control; two or more means the panel is
 * really a screen.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";

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
  /** Units / scope / as-of qualifier under the title. */
  subtitle?: React.ReactNode;
  /** A single control, right-aligned against the title. */
  action?: React.ReactNode;
  titleAs?: "h2" | "h3";
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
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
