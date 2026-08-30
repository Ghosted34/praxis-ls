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
  className,
}: {
  icon: IconComponent;
  /** Filled, for a chosen card. */
  active?: boolean;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[calc(var(--radius)-2px)] transition-colors duration-200",
        s.box,
        active
          ? "bg-[var(--tile-bg-active)] text-[var(--tile-fg-active)]"
          : "bg-[var(--tile-bg)] text-[var(--tile-fg)]",
        className,
      )}
    >
      <Icon size={s.glyph} />
    </span>
  );
}
