/**
 * The full-bleed overlay both the map's full screen and the meeting view sit in.
 *
 * ── WHY IT IS A PORTAL, AND WHY THAT IS A BUG FIX ───────────────────────────
 *
 * Both overlays were `fixed inset-0 z-50` rendered in place. `z-50` is higher than
 * the ribbon's `z-30` and the title bar's `z-40`, so on paper they covered
 * everything — and on screen the ribbon painted straight over the top of them,
 * clipping the heading and the exit button behind the nav tabs.
 *
 * `z-index` only orders siblings within a STACKING CONTEXT. The overlay was
 * rendered deep inside the scrolling content region, and an ancestor of that region
 * establishes a context of its own, so `z-50` competed with the map card's
 * siblings rather than with the ribbon. No z-index on the overlay could ever have
 * escaped: the whole subtree is painted at the content region's level, which is
 * below the chrome. Portalling to `document.body` puts the overlay in the root
 * stacking context, where its z-index means what it says.
 *
 * ── WHY IT STARTS BELOW THE TITLE BAR RATHER THAN UNDER IT ──────────────────
 *
 * `top: var(--titlebar-h)` instead of `inset-0`. The title bar carries the window
 * controls, and in the desktop build it IS the draggable window region — an overlay
 * across it leaves no way to move or close the window, which on Windows is the
 * whole top-right corner. `--titlebar-h` is the composed height (density-linked,
 * widened by `env(titlebar-area-height)` under Window Controls Overlay), so this
 * stays correct through a density change and on macOS, where the strip is taller.
 *
 * Geometry rather than z-order for the same reason: an overlay that merely sits
 * BEHIND the title bar still paints its own background under it and the two
 * surfaces fight. Starting below it means there is nothing to resolve.
 *
 * ── FITTING ────────────────────────────────────────────────────────────────
 *
 * `flex flex-col` with `min-h-0`, and every child that should absorb the leftover
 * space asks for `flex-1 min-h-0` itself. `min-h-0` is the load-bearing half: a
 * flex item's default `min-height: auto` refuses to shrink below its content, which
 * is exactly how a fixed-aspect map ended up taller than the viewport and ran off
 * the bottom of the screen with its southern labels cut off.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export function ScreenOverlay({
  label,
  className,
  children,
}: {
  /** Accessible name for the dialog. */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  /*
   * Nothing behind the overlay should scroll while it is up. Without this the
   * wheel still moved the page underneath, so leaving full screen dropped the
   * operator somewhere other than where they entered it — and on a trackpad an
   * over-scroll bounce showed a strip of the page through the edge.
   */
  React.useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      // `top` is the title bar's own height; `bottom-0 left-0 right-0` covers the
      // rest, including the rail and the ribbon.
      style={{ top: "var(--titlebar-h)" }}
      className={cn(
        "fixed bottom-0 left-0 right-0 z-[55] flex min-h-0 flex-col overflow-hidden bg-background",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
