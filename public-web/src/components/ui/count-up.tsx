import * as React from "react";
import { useRevealed } from "@/components/ui/reveal";
import { num } from "@/lib/format";

/**
 * A figure that counts up the first time it is scrolled to, and once only.
 *
 * ── WHY IT IS BUILT ON `useRevealed` AND NOT ON ITS OWN OBSERVER ──────────
 *
 * `reveal.tsx` already owns the one shared `IntersectionObserver` on the page,
 * already unobserves each element the moment it fires, and already answers
 * `true` on first render under `prefers-reduced-motion` or in a browser with no
 * observer at all. A second implementation here would be a second callback per
 * scroll frame and a second place for the reduced-motion rule to be got wrong.
 *
 * ── WHAT "ONCE ONLY" MEANS, AND WHY IT MATTERS MORE HERE THAN ELSEWHERE ───
 *
 * A band that fades every time it is scrolled past reads as a page that is
 * broken. A NUMBER that runs up from zero every time is worse than that: for
 * the second or two it is animating it is showing the reader a figure that is
 * not true. `useRevealed` unobserves on fire, so `shown` latches and this never
 * re-runs.
 *
 * ── REDUCED MOTION RENDERS THE ANSWER, NOT A FASTER ANIMATION ─────────────
 *
 * `immediate` captures whether the hook was already settled on the FIRST render
 * — which is exactly the reduced-motion and no-observer case. When it was, the
 * final value is the initial state and no frame loop is ever scheduled, so
 * somebody who asked their system for less motion gets the number, not a
 * shorter count. It is also what a snapshot test and a crawler see.
 */
export function CountUp({
  value,
  className,
  /** ~900ms: long enough to read as a count, short enough that the figure is
   *  settled before a reader has finished the label beneath it. */
  durationMs = 900,
}: {
  value: number;
  className?: string;
  durationMs?: number;
}) {
  const [ref, shown] = useRevealed<HTMLSpanElement>();
  // Read once, at mount. `shown` latches true later in the normal case, and the
  // distinction this needs is "was it true BEFORE anything scrolled".
  const [immediate] = React.useState(() => shown);
  const [display, setDisplay] = React.useState(() => (immediate ? value : 0));

  React.useEffect(() => {
    if (immediate) {
      // The value can still change under us — a metric resolves differently on
      // a later mount — and the settled state must follow it.
      setDisplay(value);
      return undefined;
    }
    if (!shown) return undefined;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / Math.max(1, durationMs));
      // Ease-out cubic: fast enough at the start to read as a count, slow
      // enough at the end that the last digits settle rather than snap.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [immediate, shown, value, durationMs]);

  return (
    // `tabular-nums` via `.num`, so the width does not jitter while the digits
    // change — the single most noticeable defect a counter can have.
    <span ref={ref} className={className}>
      {num(display)}
    </span>
  );
}
