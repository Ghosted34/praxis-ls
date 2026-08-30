import * as React from "react";
import { cn } from "@/lib/cn";
import { IconTile, type IconComponent } from "@/components/ui/icon-tile";

/**
 * Eyebrow, title, optional accent word, lead (doc/UI_UPGRADE_PLAN.md §6.3).
 *
 * ── WHY THIS IS ONE COMPONENT AND NOT TWO ─────────────────────────────────
 *
 * `Section` already rendered an eyebrow, a title and a lead, and the plan's
 * first draft asked for a separate `SectionHead` beside it. Building that would
 * have left two implementations of one heading block, drifting apart — the
 * exact fault the plan tells a reviewer to catch. So this is the single
 * implementation and `Section` renders it; heroes, which are not `Section`s,
 * use it directly.
 *
 * ── THE ACCENT WORD ────────────────────────────────────────────────────────
 *
 * Their site puts the second half of a heading in the brand colour, and it is
 * the cheapest thing on the whole list: one `<span>` turns a plain heading into
 * a composed one. It is a span INSIDE the heading rather than a second element
 * beside it, so the `h1` keeps exactly one accessible name — "Tell us about
 * your shipment", not two headings a screen reader reads as separate.
 *
 * ── ALIGNMENT ──────────────────────────────────────────────────────────────
 *
 * Centre for a hero or a wizard step, left for an in-page section. A centred
 * in-page heading over left-aligned body copy reads as a mistake, and a
 * left-aligned step heading under a row of step dots reads as a caption for
 * them.
 */
export function SectionHead({
  eyebrow,
  eyebrowIcon,
  title,
  accent,
  lead,
  align = "left",
  onDark = false,
  titleClass,
  as: Tag = "h2",
  className,
}: {
  eyebrow?: React.ReactNode;
  /** A small glyph before the eyebrow, in a tile. Their `__kicker` pattern. */
  eyebrowIcon?: IconComponent;
  title?: React.ReactNode;
  /** Rendered inside the heading, in the brand colour. */
  accent?: React.ReactNode;
  lead?: React.ReactNode;
  align?: "left" | "center";
  onDark?: boolean;
  /** `hero-title` in a hero, `section-title` in a band. */
  titleClass?: string;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  const centred = align === "center";
  return (
    <div
      className={cn(
        "max-w-prose",
        centred && "mx-auto text-center",
        className,
      )}
    >
      {eyebrow && (
        <p
          className={cn(
            "eyebrow flex items-center gap-2",
            centred && "justify-center",
            onDark && "text-[var(--brand-orange)]",
          )}
        >
          {eyebrowIcon && <IconTile icon={eyebrowIcon} size="sm" />}
          {eyebrow}
        </p>
      )}
      {title && (
        <Tag
          className={cn(
            titleClass || "section-title",
            eyebrow ? "mt-2" : "",
            onDark && "text-[var(--hero-foreground)]",
          )}
        >
          {title}
          {accent && (
            <>
              {" "}
              <span className="text-[var(--brand-orange)]">{accent}</span>
            </>
          )}
        </Tag>
      )}
      {lead && (
        <p
          className={cn(
            "mt-3 text-lg",
            centred && "mx-auto",
            onDark ? "text-[var(--hero-muted)]" : "text-muted-foreground",
          )}
        >
          {lead}
        </p>
      )}
    </div>
  );
}
