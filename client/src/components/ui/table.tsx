import * as React from "react";
import { cn } from "@/lib/cn";
import type { Density } from "@/lib/density";

/**
 * The table primitive: a rounded surface card that clips its corners and scrolls
 * its content, so a wide table scrolls in-card rather than off the viewport.
 *
 * DENSITY (Phase 5, audit F9/F17). Row height is a user preference — 28 / 32 /
 * 40px — carried by `--row-py` and read by `py-row` on TD. `density` pins a
 * level for THIS table, overriding the user's global choice. Use it only where
 * the screen genuinely knows better than the user: a trial balance or a
 * permission matrix whose value IS seeing everything at once. Everywhere else,
 * leave it alone — the preference exists because the right answer differs per
 * operator, and a screen that overrides it has taken that choice away.
 *
 * WIDE-TABLE AFFORDANCES. `sticky` and `freezeFirstColumn` are what make a
 * fifteen-column financial table usable: the headings stay while you scroll
 * down, and the record's identity stays while you scroll right. Both are opt-in
 * because both cost something — `sticky` needs the table to own a scroll box
 * with a bounded height, which removes it from the page's own scroll flow, and
 * that is the wrong trade on a six-row summary table.
 */
export const Table = ({
  className,
  density,
  sticky,
  freezeFirstColumn,
  maxHeight = "70vh",
  containerClassName,
  ...p
}: React.HTMLAttributes<HTMLTableElement> & {
  /** Pin a row density for this table, ignoring the user's preference. */
  density?: Density;
  /** Keep the column headings visible while the body scrolls. Bounds the height. */
  sticky?: boolean;
  /** Keep column 0 — the record's identity — visible while scrolling right. */
  freezeFirstColumn?: boolean;
  /** Only meaningful with `sticky`. Any CSS length. */
  maxHeight?: string;
  className?: string;
  containerClassName?: string;
}) => (
  <div
    data-density={density}
    className={cn(
      "animate-fade-up w-full max-w-full overflow-x-auto rounded-[var(--radius)] border bg-card shadow-[var(--shadow-s)]",
      // Vertical scrolling is what a sticky heading sticks against: `top: 0`
      // resolves against the nearest scrolling ancestor, so without this the
      // heading would stick to the page and scroll away with the card.
      sticky && "overflow-y-auto",
      freezeFirstColumn && "table-frozen",
      containerClassName,
    )}
    style={sticky ? { maxHeight } : undefined}
  >
    <table className={cn("w-full caption-bottom border-collapse", sticky && "table-sticky", className)} {...p} />
  </div>
);
export const THead = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className={cn("bg-secondary", className)} {...p} />
);
// forwardRef because keyboard row navigation (lib/use-roving-rows) needs the
// live <tbody> to read `rows` and set tabindex on each row's controls — a
// roving tabindex is a DOM property, not a React one.
export const TBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  (p, ref) => <tbody ref={ref} {...p} />,
);
TBody.displayName = "TBody";
export const TR = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr
    className={cn(
      "border-b border-[rgb(var(--ink)_/_0.05)] transition-colors last:border-b-0 hover:bg-[color-mix(in_srgb,var(--primary)_4%,transparent)]",
      className,
    )}
    {...p}
  />
);
/**
 * Density (audit F17): `px-4 py-3.5` gave ~46px rows against a 28-32px category
 * standard (Palantir/Bloomberg/Retool) — roughly 40% fewer rows per screen on a
 * product whose users scan hundreds of shipments. Phase 1 took it to `py-row`
 * (6px, 32px rows); Phase 5 made `row` resolve to `--row-py` so the same class
 * follows the user's density preference with no change here.
 *
 * TH was 9.5px uppercase at 0.14em tracking, which is below comfortable reading
 * size; it is now 11px at 0.06em and uses the retuned --ink-3 via
 * text-muted-foreground, clearing WCAG AA (F13).
 */
export const TH = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn(
      "whitespace-nowrap px-3 py-2 text-left align-middle text-micro font-semibold uppercase text-muted-foreground",
      className,
    )}
    {...p}
  />
);
export const TD = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("px-3 py-row align-middle text-sm", className)} {...p} />
);
