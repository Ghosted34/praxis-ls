import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * The small capsule above a page's h1 (doc/UI_UPGRADE_PLAN.md §6.5).
 *
 * It marks what KIND of page this is before the heading says what it is about
 * — "Quote desk", "Insights" — and it is the cheapest way to make a hero feel
 * composed rather than typed.
 *
 * ── ONE PER PAGE ───────────────────────────────────────────────────────────
 *
 * A page with three of these marks nothing. That is a review rule rather than
 * something this component can enforce, and it is written here because this is
 * where somebody will read it.
 *
 * `onDark` exists because the hero band inverts `--ink`: a border at 12% of the
 * light ink is invisible on the dark plate, and 12% of the dark ink is a grey
 * smudge on the light one. Two explicit treatments beat one that is wrong half
 * the time.
 */
export function BadgePill({
  children,
  onDark = false,
  className,
}: {
  children: React.ReactNode;
  onDark?: boolean;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "eyebrow inline-flex items-center gap-2 rounded-full border px-3 py-1",
        onDark
          ? "border-[rgb(237_238_238/0.25)] text-[var(--brand-orange)]"
          : "border-[rgb(var(--ink)/0.15)] text-[var(--primary-ink)]",
        className,
      )}
    >
      {children}
    </p>
  );
}
