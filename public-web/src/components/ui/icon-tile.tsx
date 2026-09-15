import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * A glyph in a filled square (doc/UI_UPGRADE_PLAN.md §6.1).
 *
 * This is the single component that carries most of the difference in
 * perceived quality between our pages and the site they replace. A bare stroke
 * icon beside a heading reads as a bullet; the same icon in a tile reads as a
 * designed object, and the tile is what a selected state can FILL.
 *
 * ── WHY IT TAKES A COMPONENT AND NOT A NODE ───────────────────────────────
 *
 * `icon={ShipIcon}` rather than `icon={<ShipIcon />}`, so the tile owns the
 * glyph's size. Passing an element means every call site picks a size, and the
 * sizes then disagree by two pixels across a page in a way nobody can see but
 * everybody feels.
 *
 * `aria-hidden` is unconditional and not a prop. A tile is never the accessible
 * name of anything — the text beside it is — and a decorative image that
 * announces itself is worse than one that does not.
 */
export type IconComponent = React.ComponentType<{
  size?: number;
  className?: string;
}>;

const SIZES = {
  sm: { box: "h-9 w-9", glyph: 18 },
  md: { box: "h-11 w-11", glyph: 22 },
  lg: { box: "h-14 w-14", glyph: 28 },
} as const;

export function IconTile({
  icon: Icon,
  active = false,
  size = "md",
  tint,
  className,
}: {
  icon: IconComponent;
  /** Filled, for a chosen card. */
  active?: boolean;
  size?: keyof typeof SIZES;
  /**
   * A CSS colour the tile carries instead of the neutral tokens: the glyph at
   * full strength, the plate at 12% of it.
   *
   * It takes a COLOUR STRING rather than a freight mode, because this is a
   * generic primitive and the four `--mode-*` tokens are the marketing site's
   * vocabulary, not the tile's. Pass a token reference
   * (`rgb(var(--mode-sea))`), never a hex — a literal here would bake one
   * tenant's palette into a component every tenant renders.
   *
   * `active` wins if both are given: a chosen state is a state, and a tint is
   * an identity, and the state is the thing the reader is being told about.
   */
  tint?: string;
  className?: string;
}) {
  const s = SIZES[size];
  const tinted = !!tint && !active;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[calc(var(--radius)-2px)] transition-colors duration-200",
        s.box,
        !tinted &&
          (active
            ? "bg-[var(--tile-bg-active)] text-[var(--tile-fg-active)]"
            : "bg-[var(--tile-bg)] text-[var(--tile-fg)]"),
        className,
      )}
      style={
        tinted
          ? {
              // 12% is the top of the work order's 10–12% range: below that the
              // plate disappears on the muted band the cards sit on, and the
              // tile stops being a tile.
              backgroundColor: `color-mix(in srgb, ${tint} 12%, transparent)`,
              color: tint,
            }
          : undefined
      }
    >
      <Icon size={s.glyph} />
    </span>
  );
}
