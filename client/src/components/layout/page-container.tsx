/**
 * PageContainer — the standard wrapper for a routed screen (audit F3).
 *
 * Owns the two things every screen was previously re-deciding by hand: how wide
 * the content column is, and what element it lives in. Width comes from the
 * fixed set in lib/layout.ts rather than an ad-hoc `max-w-*` per file.
 *
 * USAGE
 *
 *   // A dense list or dashboard — the default.
 *   <PageContainer>
 *     <PageHeader title="Invoices" description="…" />
 *     <DataList … />
 *   </PageContainer>
 *
 *   // A settings form — capped to a readable measure.
 *   <PageContainer width="reading">
 *     <PageHeader title="Appearance" description="…" />
 *     …
 *   </PageContainer>
 *
 *   // A screen that manages its own width (split pane, chat, kanban).
 *   <PageContainer width="full">…</PageContainer>
 *
 * BEST PRACTICE
 *   - Pick `wide` unless there is a reason not to. Operators run this on large
 *     displays; capping a shipment table to 1152px wastes the screen they paid
 *     for.
 *   - Pick `reading` for anything that is mostly prose or a single-column form.
 *     Long measures hurt readability — width is not always generosity.
 *   - Do NOT add `max-w-*` inside a PageContainer. If a section needs to be
 *     narrower than the page, constrain that section, not the container.
 *   - One PageContainer per screen, at the top. Nesting them is a bug.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { pageShell, type PageWidth } from "@/lib/layout";

export function PageContainer({
  width = "wide",
  as: Tag = "section",
  className,
  children,
  ...rest
}: {
  /** Content column width. See lib/layout.ts for when to use which. */
  width?: PageWidth;
  /** Element to render. Defaults to <section>; use "div" inside another landmark. */
  as?: "section" | "div" | "main";
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag className={cn(pageShell[width], className)} {...rest}>
      {children}
    </Tag>
  );
}
