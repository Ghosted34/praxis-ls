import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/**
 * One band of the homepage, and the only place that decides how a band is
 * assembled: eyebrow, heading, lead, optional aside, content.
 *
 * The variant names are the marketing vocabulary (`hero`, `muted`, `dark`) and
 * they map onto the `band-*` classes in `index.css`, so a section cannot
 * accidentally invent a fifth background treatment. Headings are `h2` by
 * default because a band sits under the page's single `h1` — the heading-order
 * rule (N10) this app inherits from the ERP's own audit rather than rediscovering.
 */
export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  variant = "default",
  aside,
  className,
  titleAs: Tag = "h2",
  divided = false,
}: {
  id?: string;
  eyebrow?: string;
  title?: React.ReactNode;
  lead?: React.ReactNode;
  children: React.ReactNode;
  variant?: "default" | "muted" | "dark";
  /** A right-hand slot for a CTA or a figure, aligned with the heading. */
  aside?: React.ReactNode;
  className?: string;
  /**
   * `h1` is legal here for one reason: several pages in this app are a single
   * band — the careers index, the portfolio index, the services index, the
   * not-found page — and there the band title IS the page title. Rendering it
   * as `h2` because `Section` defaults to `h2` leaves the whole document with no
   * `h1` at all, which fails the one-`h1` rule (N10) in the direction nobody
   * screenshots, and costs a screen-reader user the heading outline.
   *
   * It stays an explicit prop rather than a guess inside the component: a page
   * with a hero owns its `h1` up there, and its first `Section` must not then
   * claim a second one.
   */
  titleAs?: "h1" | "h2" | "h3";
  /** Hairline above — the device that lets four bands read as one column. */
  divided?: boolean;
}) {
  const band =
    variant === "dark"
      ? "band-hero"
      : variant === "muted"
        ? "band band-muted"
        : "band";
  return (
    <section
      id={id}
      // A hash target must not hide under the sticky header, or the anchor jumps
      // to the middle of the band it is meant to point at.
      className={cn(band, "scroll-mt-24", divided && "rule-top", className)}
    >
      <div className="wrap py-band">
        {(eyebrow || title || aside) && (
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-prose">
              {eyebrow && <p className="eyebrow">{eyebrow}</p>}
              {title && (
                <Tag
                  className={cn(
                    "section-title mt-2",
                    variant === "dark" ? "text-[var(--hero-foreground)]" : "",
                  )}
                >
                  {title}
                </Tag>
              )}
              {lead && (
                <p
                  className={cn(
                    "mt-3 text-lg",
                    variant === "dark"
                      ? "text-[var(--hero-muted)]"
                      : "text-muted-foreground",
                  )}
                >
                  {lead}
                </p>
              )}
            </div>
            {aside && <div className="shrink-0">{aside}</div>}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

/** A card in a service/insight grid: optional media, an eyebrow, a title, copy,
 *  and one arrow link. Media is only rendered when the server handed over a URL
 *  (`portfolio_public` and `service_type_web_public` both null out anything their
 *  allowlist would refuse) — a broken image frame on a sales page is worse than
 *  no image, which is why there is no `onError` fallback here. */
export function MediaCard({
  image,
  imageAlt,
  eyebrow,
  title,
  children,
  to,
  linkLabel,
  footer,
  className,
}: {
  image?: string | null;
  imageAlt?: string;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  to?: string;
  linkLabel?: string;
  footer?: React.ReactNode;
  className?: string;
}) {
  const body = (
    <>
      {image ? (
        <div className="aspect-[16/10] w-full overflow-hidden bg-muted">
          <img
            src={image}
            alt={imageAlt || ""}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}
      <div className="flex flex-1 flex-col p-5">
        {eyebrow && <p className="micro mb-2">{eyebrow}</p>}
        <h3 className="text-title font-semibold leading-snug tracking-tight">
          {title}
        </h3>
        {children ? (
          <div className="mt-2 flex-1 text-sm text-muted-foreground">
            {children}
          </div>
        ) : (
          <div className="flex-1" />
        )}
        {footer}
        {to && linkLabel && (
          <span className="more-link mt-4 text-sm">
            {linkLabel}
            <ArrowRightIcon size={16} />
          </span>
        )}
      </div>
    </>
  );

  const cls = cn(
    "lux-card flex flex-col overflow-hidden transition-shadow hover:shadow-[var(--shadow-m)]",
    className,
  );

  if (!to) return <div className={cls}>{body}</div>;

  return (
    <Link to={to} className={cn(cls, "group block")}>
      {body}
    </Link>
  );
}

/** The arrow link, exported because grids and empty states both need exactly one
 *  visual language for "there is a page here". */
export function MoreLink({
  to,
  children,
  className,
}: {
  to: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link to={to} className={cn("more-link", className)}>
      {children}
      <ArrowRightIcon size={16} />
    </Link>
  );
}

/** A numbered step band — the "how it works" strip. Numbers are `01`-style with
 *  tabular figures so a three-step row does not shift width between languages
 *  (French strings are 15-25 % longer; the numerals must not be another thing
 *  that moves). */
export function StepList({
  steps,
}: {
  steps: { title: string; body: string }[];
}) {
  return (
    <ol className="grid gap-px overflow-hidden rounded-xl border bg-[var(--border)] md:grid-cols-3">
      {steps.map((s, i) => (
        <li key={i} className="bg-background p-6">
          <span className="num text-micro font-semibold text-[var(--primary-ink)]">
            {String(i + 1).padStart(2, "0")}
          </span>
          <h3 className="mt-3 text-title font-semibold leading-snug">
            {s.title}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}
