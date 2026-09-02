import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { SectionHead } from "@/components/site/section-head";
import { IconTile, type IconComponent } from "@/components/ui/icon-tile";
import { serviceColor, type FreightMode } from "@/lib/service-identity";

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
  eyebrowIcon,
  title,
  accent,
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
  /** A glyph in a tile before the eyebrow — their `__kicker` pattern. */
  eyebrowIcon?: IconComponent;
  title?: React.ReactNode;
  /** Rendered inside the heading, in the brand colour (UI_UPGRADE_PLAN §6.3). */
  accent?: React.ReactNode;
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
            {/* One implementation of the heading block, shared with the heroes
                — which are not Sections and used to hand-roll their own. */}
            <SectionHead
              eyebrow={eyebrow}
              eyebrowIcon={eyebrowIcon}
              title={title}
              accent={accent}
              lead={lead}
              onDark={variant === "dark"}
              as={Tag}
            />
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
 *  no image, which is why there is no `onError` fallback here.
 *
 *  ── WHY A CARD WITHOUT A COVER GETS A DRAWN PANEL ─────────────────────────
 *
 *  `icon` is the `__card-top` half of their grammar (UI_UPGRADE_PLAN §4 pattern
 *  4, §7.3). It is drawn ONLY when there is no cover, and it is not decoration
 *  for its own sake: a tenant who has published four services and uploaded one
 *  photograph gets one illustrated card beside three text boxes, which reads as
 *  three broken cards. A drawn plate is the honest placeholder — it says "a
 *  service", which is true, rather than standing in for a photograph nobody took
 *  (N12).
 *
 *  There are two of them. A card that knows its `mode` composes a panel: a wash
 *  of its own colour, its glyph bled off the corner, its code in the mono face.
 *  A card that does not — an insight, a case note — keeps the centred tile it
 *  always had, which is why the insights grid is untouched by any of this. */
export function MediaCard({
  image,
  imageAlt,
  icon: Icon,
  mode,
  accent: accentToken,
  code,
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
  /** Fallback glyph for a card with no cover. */
  icon?: IconComponent;
  /**
   * The card's freight-mode identity (`lib/service-identity.ts`). Paints the
   * 6px bar, the panel's gradient and its glyph — identity only, never an
   * action: the arrow link below stays `--primary-ink` so orange remains the
   * one colour on the page that means "you may press this".
   */
  mode?: FreightMode;
  /**
   * The tenant's own brand token for this card
   * (`service_type_web_profile.accent`, migration 12755). When present it wins
   * over `mode`: the positional palette is a guess made in the absence of an
   * answer, and this is the answer.
   */
  accent?: string | null;
  /** The mono code drawn top-left of the panel. Needs `mode` and `icon`. */
  code?: string;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  to?: string;
  linkLabel?: string;
  footer?: React.ReactNode;
  className?: string;
}) {
  // `mode` still decides WHETHER a panel is composed — a card with no identity
  // (an insight, a case note) keeps its centred tile. `accent` only decides what
  // colour that panel is painted, so a tenant's choice cannot accidentally turn
  // a tile into a panel on a grid that never asked for one.
  const accent = mode ? serviceColor(accentToken, mode) : null;
  /**
   * The composed panel, and the reason it replaces the centred tile.
   *
   * Four identical 16:10 plates carrying four identical thin glyphs is what
   * read as unfinished — repetition is the thing a visitor notices, not
   * absence. So a card that knows its identity draws a panel instead: a
   * diagonal wash of its own colour at 8%, its glyph oversized and bled off the
   * bottom-right corner, and its code set in the mono face top-left.
   *
   * Nothing here is thrown away when photography arrives. The panel occupies
   * the same slot the cover will, and the bar and the code stay as overlay
   * furniture above it — which is why the bar is drawn on the CARD rather than
   * inside the panel.
   */
  const composed = !image && !!Icon && !!accent;
  const body = (
    <>
      {accent ? (
        <span
          aria-hidden
          className="block h-1.5 w-full shrink-0 opacity-90 transition-opacity duration-200 group-hover:opacity-100"
          style={{ background: accent }}
        />
      ) : null}
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
      ) : composed && Icon ? (
        <div
          className="relative aspect-[16/10] w-full overflow-hidden"
          style={{
            background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 8%, transparent) 0%, transparent 62%), rgb(var(--ink) / 0.04)`,
          }}
        >
          {code ? (
            <span
              className="absolute left-4 top-3.5 font-mono text-[11px] font-semibold tracking-tight"
              style={{ color: accent }}
            >
              {code}
            </span>
          ) : null}
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-7 -right-6 opacity-[0.55]"
            style={{ color: accent }}
          >
            <Icon size={140} />
          </span>
        </div>
      ) : Icon ? (
        <div className="flex aspect-[16/10] w-full items-center justify-center bg-[rgb(var(--ink)/0.04)]">
          <IconTile icon={Icon} size="lg" />
        </div>
      ) : null}
      <div className="flex flex-1 flex-col p-5">
        {/* The identity glyph appears ONCE per card. Bled into the panel where
            we drew the panel; as a tinted chip here where the tenant's own
            photograph took the panel's place — so a card with a cover is still
            recognisable by colour before it is read, which is the whole point
            of the palette. */}
        {accent && Icon && image ? (
          <IconTile
            icon={Icon}
            size="sm"
            tint={accent}
            className="mb-3"
          />
        ) : null}
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
