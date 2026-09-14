/**
 * `--fab-floor` — how a bottom-docked control tells the floating cluster to get
 * out of its way.
 *
 * ── THE COLLISION THIS EXISTS TO SETTLE ────────────────────────────────────
 *
 * `<FloatingActions>` is `fixed bottom-24 right-5` on touch. On a list screen
 * there is nothing underneath it but the bottom nav, which 6rem already clears.
 * Smart Comms is the exception: the chat composer is docked to the bottom of
 * the thread, and its Send button — or the mic, which is the same corner when
 * nothing is typed — sits exactly where the cluster lands.
 *
 * That used to be settled by DELETING the cluster on `/comms` and leaning on a
 * quick-actions menu in the title bar. The menu is gone at every width, so the
 * exception would now leave a phone in Smart Comms with no quick actions and no
 * clock-in at all. The cluster clears the composer instead of hiding from it.
 *
 * ── MEASURED, NOT GUESSED ──────────────────────────────────────────────────
 *
 * A hardcoded offset would be wrong the moment the composer grows, and it grows
 * for four separate reasons: an attachment list, a reply or edit bar, a
 * multi-line message, and an ERP card. So the element that knows its own height
 * publishes it, every time it changes.
 *
 * The value is the distance from the viewport's BOTTOM EDGE to the element's
 * TOP, which is the `bottom` offset the cluster needs in order to sit above it,
 * plus a small gap so it clears the border rather than resting on it.
 *
 * ── WHY A CSS VARIABLE AND NOT A PROP ──────────────────────────────────────
 *
 * The cluster is portalled to `<body>` and is mounted by the app shell; the
 * composer is four routed levels down a different subtree. There is no prop
 * path between them that does not mean threading a number through the router.
 * A custom property on the document element is read by `bottom:max(…)` with no
 * React involved, and `max()` means an unset variable is not a special case —
 * every other screen falls through to the 6rem the cluster has always used.
 */
import * as React from "react";

/** Clears the border rather than resting on it. */
const GAP = 12;
const VAR = "--fab-floor";

/**
 * Publish this element's top edge as the floating cluster's floor, for as long
 * as it is mounted and visible.
 *
 * ZERO HEIGHT CLEARS THE FLOOR RATHER THAN SETTING ONE. On a phone the chat
 * thread is `display: none` while the channel list is up, and a `display: none`
 * element measures 0×0 at the viewport origin — a floor computed from that rect
 * is the full viewport height, which would throw the cluster off the top of the
 * screen on the one view where nothing is in its way.
 */
export function useFabFloor(ref: React.RefObject<HTMLElement | null>): void {
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const clear = () => root.style.removeProperty(VAR);
    const apply = () => {
      const rect = el.getBoundingClientRect();
      if (!rect.height) return clear();
      root.style.setProperty(
        VAR,
        `${Math.max(0, Math.round(window.innerHeight - rect.top + GAP))}px`,
      );
    };
    apply();
    // The composer resizes far more often than it moves, and a resize is the
    // only thing that changes its top edge within a fixed viewport.
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
      clear();
    };
  }, [ref]);
}
