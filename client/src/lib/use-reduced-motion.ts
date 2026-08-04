/**
 * `prefers-reduced-motion: reduce`, as a hook.
 *
 * index.css already kills every CSS animation and transition under that query,
 * which covers the whole app — except SMIL. `<animateMotion>` inside an SVG is
 * not a CSS animation and is completely unaffected by that rule, so the Control
 * Tower's markers travelling along their lanes would keep moving for a user who
 * asked the platform for stillness. This is how a component opts those out.
 *
 * Returns `false` during SSR/tests without `matchMedia`, i.e. motion allowed —
 * the safe default for a component that renders decoration conditionally.
 */
import * as React from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    // Safari < 14 only has the deprecated addListener; both are guarded because
    // jsdom's matchMedia stub implements neither in some versions.
    if (mq.addEventListener) {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    return undefined;
  }, []);

  return reduced;
}
