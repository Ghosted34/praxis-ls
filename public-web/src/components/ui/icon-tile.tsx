import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * The glyph-in-a-square used by cards and section headings. The tile is always
 * decorative: the text beside it carries the accessible name.
 */
type Icon = React.ComponentType<{ size?: number; className?: string }>;
type Size = "sm" | "md" | "lg";

const SIZE_CLASS: Record<Size, string> = {
  sm: "h-9 w-9",
  md: "h-11 w-11",
  lg: "h-14 w-14",
};

const ICON_SIZE: Record<Size, number> = {
  sm: 18,
  md: 22,
  lg: 28,
};

export function IconTile({
  icon: Icon,
  active = false,
  size = "md",
  className,
}: {
  icon: Icon;
  active?: boolean;
  size?: Size;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-[calc(var(--radius)-2px)] transition-colors duration-200",
        SIZE_CLASS[size],
        active
          ? "bg-[rgb(var(--tile-bg-active))] text-[var(--tile-fg-active)]"
          : "bg-[var(--tile-bg)] text-[var(--tile-fg)]",
        className,
      )}
    >
      <Icon size={ICON_SIZE[size]} />
    </span>
  );
}
