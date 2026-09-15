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
  titleWrapper,
  eyebrowClass,
  leadClass,
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
  /**
   * Wrap the heading's CONTENTS — title and accent together — in something.
   *
   * The hero (§7.1) needs its headline inside `<WeightScrub>`, whose weight
   * response has to cover the accent word too or half the line thickens and
   * half does not. The alternative was for the hero to build its own `<h1>`,
   * which is how this component came to exist: the file's own header records
   * that two implementations of one heading block is the fault a reviewer is
   * told to catch. An extension point is one implementation; a copy is two.
   *
   * It wraps the contents rather than replacing the tag, so the heading level,
   * the accessible name and the `onDark` colour rules are unaffected.
   */
  titleWrapper?: (children: React.ReactNode) => React.ReactNode;
  /**
   * Extra classes on the eyebrow and on the lead.
   *
   * The hero (§7.1) arrives as a choreographed sequence — eyebrow, headline,
   * accent, lead, buttons, plate — and three of those six are rendered in here.
   * The alternative was for the hero to stop using this component and build its
   * own heading block, which is precisely the fault this file's header says a
   * reviewer is told to catch. Same reasoning as `titleWrapper` above: an
   * extension point is one implementation, a copy is two.
   *
   * They ADD to the recipe rather than replacing it, so a caller cannot lose
   * the `onDark` contrast rules by passing a class.
   */
  eyebrowClass?: string;
  leadClass?: string;
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
            onDark && "text-[rgb(var(--brand-orange))]", // ink-on-dark: 6.44:1 on --hero, where --primary-ink is ~3.4:1
            eyebrowClass,
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
          {(titleWrapper || ((x: React.ReactNode) => x))(
            <>
              {title}
              {accent && (
                <>
                  {" "}
                  {/*
                    THE ACCENT WORD INVERTS WITH THE GROUND, exactly as the
                    eyebrow above it does.

                    It used to be `--brand-orange` unconditionally, which is
                    3.13:1 on white. That squeaked past AA only because
                    `.section-title` clamps to 28-40px and large text is held to
                    3:1 — so the pass depended on a font size the caller can
                    override through `titleClass`, and `text-title` (20px) would
                    have failed silently at 3.13:1. `--primary-ink` is 5.79:1 at
                    any size and is the same brand colour corrected for type,
                    which is the whole reason the ink token exists (CLAUDE.md:
                    accent TEXT is the ink, `--primary` is a fill).

                    On the dark plate the relation inverts and the fill is the
                    correct one — 6.44:1, against `--primary-ink`'s ~3.4:1.
                    Found by porting `check:contrast` to this app (guide O-9).
                  */}
                  <span
                    className={
                      onDark
                        ? "text-[rgb(var(--brand-orange))]" // ink-on-dark: the accent word on the hero plate, 6.44:1
                        : "text-[var(--primary-ink)]"
                    }
                  >
                    {accent}
                  </span>
                </>
              )}
            </>,
          )}
        </Tag>
      )}
      {lead && (
        <p
          className={cn(
            "mt-3 text-lg",
            centred && "mx-auto",
            onDark ? "text-[var(--hero-muted)]" : "text-muted-foreground",
            leadClass,
          )}
        >
          {lead}
        </p>
      )}
    </div>
  );
}
