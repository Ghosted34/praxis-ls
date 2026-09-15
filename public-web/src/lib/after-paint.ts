/**
 * Run something once the browser has finished the work a visitor is waiting on.
 *
 * ── WHY THIS EXISTS, WITH THE NUMBER THAT CAUSED IT ───────────────────────
 *
 * PR 3 added a canvas to the hero and two below-the-fold reads to the homepage,
 * and every one of them started in a `useEffect` on mount. That is during the
 * critical rendering path. Measured on Lighthouse's mobile profile (simulated
 * Slow 4G, 4× CPU):
 *
 *     first-contentful-paint    3.0 s → 3.7 s
 *     largest-contentful-paint  3.0 s → 3.7 s
 *     total-blocking-time        40 ms → 70 ms
 *     performance                  89 → 80
 *
 * The hero IS the LCP element (§7.1 says so), so a `requestAnimationFrame` loop
 * painting a decoration behind it competes with the thing it decorates — and
 * two `fetch`es for bands nobody has scrolled to yet compete for the same
 * connection. None of it is wrong to do; all of it is wrong to do FIRST.
 *
 * ── WHAT "AFTER" MEANS HERE ───────────────────────────────────────────────
 *
 * The `load` event, then an idle callback, with a timeout so a page that never
 * goes idle still gets its decoration. Three fallbacks deep because
 * `requestIdleCallback` is absent on Safari before 16.4 and the whole point is
 * to be gentler than the status quo, never to skip the work.
 *
 * It returns a canceller, because everything using it is in a `useEffect` that
 * may unmount before the callback fires.
 */

/** How long to wait for an idle moment before doing it anyway. Long enough to
 *  clear a slow first paint, short enough that a visitor who scrolls straight
 *  down does not reach the band before its data was even requested. */
const IDLE_TIMEOUT_MS = 1500;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function afterPaint(run: () => void): () => void {
  if (typeof window === "undefined") {
    run();
    return () => {};
  }

  let cancelled = false;
  let idleHandle: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const go = () => {
    if (cancelled) return;
    const w = window as IdleWindow;
    if (typeof w.requestIdleCallback === "function") {
      idleHandle = w.requestIdleCallback(
        () => {
          if (!cancelled) run();
        },
        { timeout: IDLE_TIMEOUT_MS },
      );
    } else {
      // Safari < 16.4. A short timeout is the honest approximation: it is not
      // idle detection, it is "not this tick and not the next few".
      timer = setTimeout(() => {
        if (!cancelled) run();
      }, 200);
    }
  };

  if (document.readyState === "complete") {
    go();
  } else {
    window.addEventListener("load", go, { once: true });
  }

  return () => {
    cancelled = true;
    window.removeEventListener("load", go);
    if (timer) clearTimeout(timer);
    const w = window as IdleWindow;
    if (idleHandle !== undefined && typeof w.cancelIdleCallback === "function") {
      w.cancelIdleCallback(idleHandle);
    }
  };
}
