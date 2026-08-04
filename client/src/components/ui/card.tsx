/**
 * Card — THE card surface.
 *
 * This file had ZERO importers while four hand-rolled card recipes were used
 * instead (F6): `rounded-2xl border border-border bg-card p-5 shadow-sm` at 12
 * sites, `lux-card` plus ad-hoc padding in ~14 distinct combinations,
 * `rounded-xl border bg-card p-5` at 5, `rounded-lg border bg-card …` at 4.
 * The audit's recommendation was to revive it rather than delete it, because
 * something has to be the one surface. This is that revival.
 *
 * Radius is `rounded-lg` — i.e. `--radius`, which Phase 1 moved from 14.4px to
 * 8px (F17: 14px cards read as a consumer app; Linear/Stripe/Vercel sit at
 * 6-8px). Adopting `Card` is therefore also how a screen inherits that
 * correction. Do not reintroduce `rounded-2xl` on a card.
 *
 * COMPOSITION. `Card` is the surface and owns no padding, so a card can hold a
 * full-bleed table as easily as prose. Padding comes from `CardHeader` /
 * `CardContent` / `CardFooter`. For the very common "titled panel with an
 * optional action" shape, use `<Panel>` (components/ui/panel.tsx) rather than
 * assembling this by hand.
 *
 * @example
 * <Card>
 *   <CardHeader>
 *     <CardTitle>Receivables ageing</CardTitle>
 *     <CardDescription>Smart receivables ledger · XAF</CardDescription>
 *   </CardHeader>
 *   <CardContent>{…}</CardContent>
 * </Card>
 *
 * BEST PRACTICE. Cards group things that belong together; they are not a
 * decoration for everything on the page. A screen that is entirely cards has no
 * hierarchy left to spend. Never nest a Card in a Card — use a divider or a
 * heading inside the one card instead.
 */
import * as React from "react";
import { cn } from "@/lib/cn";

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...p} />
);

export const CardHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...p} />
);

/**
 * `as` exists because heading LEVEL is a document-structure decision the card
 * cannot make for itself. `PageHeader` renders the page's `<h1>`, so a card
 * directly inside a page is an `<h2>` (the default). Drop to `h3` only when the
 * card genuinely sits under another heading — the audit found `<h3>`s in pages
 * with no `<h2>` at all (F13), which is the failure this prop prevents.
 */
export const CardTitle = ({
  className,
  as: Tag = "h2",
  ...p
}: React.HTMLAttributes<HTMLHeadingElement> & { as?: "h2" | "h3" | "h4" }) => (
  // Generic wrapper: children arrive through {...p}, so heading-has-content
  // cannot see them here. The call sites are what need content, and those are
  // checked.
  // eslint-disable-next-line jsx-a11y/heading-has-content
  <Tag className={cn("text-title font-semibold leading-none tracking-tight", className)} {...p} />
);

export const CardDescription = ({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("text-label text-muted-foreground", className)} {...p} />
);

export const CardContent = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-5 pt-0", className)} {...p} />
);

export const CardFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex items-center gap-2 border-t px-5 py-3", className)} {...p} />
);
