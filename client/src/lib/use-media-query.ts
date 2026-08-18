/**
 * A CSS media query, as a hook — for the cases where a breakpoint has to change
 * BEHAVIOUR, not just layout.
 *
 * Tailwind classes handle the ordinary case: `hidden lg:block` renders both
 * branches and hides one. That is the right tool when both branches are cheap
 * markup, and it should stay the default — this hook is the exception, not a
 * replacement.
 *
 * The exception is when the two branches are genuinely different COMPONENTS
 * with different semantics. A `<Dialog>` is a focus trap, an aria-modal and a
 * portal; a full-page view is none of those. Rendering both and hiding one with
 * CSS would mount two copies of the same content, put a live focus trap in the
 * accessibility tree on a phone, and give a screen reader two of every heading.
 * So the choice has to be made in JavaScript, and that needs a real subscription
 * to the query rather than a one-shot read (a tablet rotating, or a desktop
 * window dragged narrow, has to switch).
 *
 * `fallback` is what to answer before `matchMedia` can be consulted — SSR, and
 * jsdom versions that don't implement it. It is a required decision rather than
 * a silent `false`, because the safe default depends on the caller: a desktop
 * modal wants `true`, a mobile-only affordance wants `false`.
 *
 * Mirrors `use-reduced-motion.ts`, including the Safari <14 `addListener`
 * guard — both listener APIs are feature-checked because jsdom's stub
 * implements neither in some versions.
 */
import * as React from "react";

export function useMediaQuery(query: string, fallback = false): boolean {
  const [matches, setMatches] = React.useState(fallback);

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    if (mq.addEventListener) {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    return undefined;
  }, [query]);

  return matches;
}

/**
 * `lg` and up — the desktop tier, matching tailwind.config.ts `lg: "1024px"`
 * exactly. Stated once here so a screen that branches on "desktop" and the CSS
 * that lays it out cannot disagree about where desktop starts.
 *
 * Defaults to TRUE: the desktop branch is the richer one, and answering "yes"
 * before `matchMedia` resolves means a phone briefly renders the wide view
 * rather than a desktop briefly rendering the phone view.
 */
export const DESKTOP_QUERY = "(min-width: 1024px)";

export const useIsDesktop = (): boolean => useMediaQuery(DESKTOP_QUERY, true);
