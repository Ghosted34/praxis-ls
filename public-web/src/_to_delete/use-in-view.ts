import * as React from "react";

/**
 * "Has this element been scrolled into view yet" — once, and then never again.
 *
 * ── WHY THIS EXISTS AT ALL, GIVEN THE AUDIT ───────────────────────────────
 *
 * `tailwind.config.ts` says it plainly: "a scrolling marketing page that
 * animates every element is the idiom this product's own audit rejected", and
 * `rise-in` is documented as arrival-only. So this hook is deliberately NOT a
 * general reveal utility, and there is no `data-reveal` attribute to sprinkle on
 * bands. It has one caller: the portal preview, whose milestone ledger advancing
 * from opened to scheduled is the product being demonstrated rather than a
 * decoration. Motion that carries the meaning of the thing it moves is the line
 * the audit draws; adding a second caller means arguing that case again.
 *
 * ── WHY IT DEFAULTS TO TRUE WITHOUT AN OBSERVER ───────────────────────────
 *
 * Content that starts hidden and is revealed by script is content that stays
 * hidden when the script cannot run. Where `IntersectionObserver` is missing the
 * hook reports "in view" immediately, so the end state — the visible one — is
 * what renders. `prefers-reduced-motion` needs no branch here: the global rule
 * in `index.css` collapses every transition to 0.001ms, which lands on that same
 * end state instantly.
 *
 * Disconnects on first intersection: a marketing page has no use for an observer
 * that keeps firing at an element whose animation has already run.
 */
export function useInView<T extends HTMLElement>(
  rootMargin = "0px 0px -12% 0px",
): readonly [React.RefObject<T | null>, boolean] {
  const ref = React.useRef<T | null>(null);
  const [inView, setInView] = React.useState(
    () => typeof IntersectionObserver === "undefined",
  );

  React.useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold: 0.25 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return [ref, inView] as const;
}
