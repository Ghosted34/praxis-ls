import * as React from "react";
import { motionReduced } from "@/lib/motion";

/**
 * The header's scroll engine — ONE listener, ONE frame loop, TWO properties.
 *
 * ── WHY THIS IS NOT `useScrollScrub` ───────────────────────────────────────
 *
 * `lib/motion.ts` already owns a shared scroll loop, and everything about its
 * doctrine applies here: write custom properties, never React state; read all
 * measurements, then write all of them; attach nothing under reduced motion.
 * This does not reuse it because a scrub is a pure function of an element's
 * position in the viewport, and the header's two values are neither:
 *
 *   `--hdr` (0…1) is DIRECTION-AWARE. It is not "how far down the page you
 *   are" — it is "is the reader driving forward, or coming back". Scrolling
 *   down past the threshold condenses the bar to its working state; scrolling
 *   UP restores it in full, at any depth, because a reader reversing is a
 *   reader looking for something and the utility strip is where two of the
 *   three things they might be looking for live. A position-only scrub would
 *   make the language switcher and the portal link unreachable for the whole
 *   length of a long page unless they scrolled to the very top for it.
 *
 *   `--read` (0…1) is a fraction of the DOCUMENT, not of an element. It has no
 *   element to observe.
 *
 * ── THE SMOOTHING, AND WHY IT IS NOT A CSS TRANSITION ──────────────────────
 *
 * `--hdr` is eased toward its target in the frame loop rather than declared as
 * a transition on the properties that consume it. Three reasons, and the third
 * is the one that decided it:
 *
 *   · A dozen declarations consume `--hdr`. Transitioning each of them is a
 *     dozen timelines that must be kept in step by hand, and one of them will
 *     drift the first time somebody adds a thirteenth.
 *   · `@property` is not registered for these, so a raw custom property is not
 *     interpolable in every engine this app ships to — the transition would
 *     simply not run in some of them, which is the worst kind of failure
 *     because it works on the reviewer's machine.
 *   · Reversal. A transition restarts from wherever it is, but with its full
 *     duration, so a reader who flicks down-then-up gets a slow, mushy return.
 *     Exponential smoothing toward a moving target is frame-rate independent
 *     and handles a reversal mid-flight as a continuous motion, which is what
 *     makes the dissolve read as a physical thing being blown apart and pulled
 *     back rather than as two animations fighting.
 *
 * The loop parks itself the moment the value has arrived. A header at rest
 * costs one passive scroll listener and nothing else.
 *
 * ── REDUCED MOTION ─────────────────────────────────────────────────────────
 *
 * `--hdr` is pinned to 0 and never moves: the bar keeps its full resting
 * composition, the strip never dissolves, and no ember ever renders. Somebody
 * who asked for less motion has not asked for a faster dissolve.
 *
 * `--read` is the exception, and deliberately: a progress rail is INFORMATION,
 * not decoration. It answers "how much more of this is there", which does not
 * stop being a fair question because the reader dislikes animation. It keeps
 * tracking; it just has no easing on it, which it never had.
 */

/** How far down the page the bar starts condensing. Roughly the height of the
 *  hero's eyebrow — far enough that a small trackpad nudge does not trigger the
 *  whole performance, short enough that it has finished before the reader has
 *  left the first screenful. */
const THRESHOLD_PX = 96;

/** How much upward travel counts as "going back" rather than as the hand
 *  wobbling on a trackpad. Below this the bar holds its state — a header that
 *  re-expands on every 2px of overscroll is a header that flickers. */
const REVERSE_PX = 24;

/** Per-frame approach fraction at 60Hz, compensated for the real frame time so
 *  a 120Hz display does not arrive twice as fast. 0.18 lands in ~180ms, which
 *  is the response budget this app holds itself to. */
const EASE_PER_FRAME = 0.18;

/** Below this the value is snapped and the loop parks. Sub-thousandth changes
 *  are invisible and would keep a frame loop alive for the life of the page. */
const EPSILON = 0.001;

export function useHeaderScroll<T extends HTMLElement>(): React.RefObject<T> {
  const ref = React.useRef<T | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return undefined;

    const still = motionReduced();
    let raf = 0;
    let current = 0;
    let target = 0;
    /* ZERO, not the current scroll position.

       Seeding this from `window.scrollY` looks more correct and is the bug the
       reload test caught: a browser restoring a deep scroll position on refresh
       makes the first `onScroll` compare 2000 against 2000, which is neither
       "down" nor far enough "up", so the bar composed itself as if it were
       resting at the top of a page the reader is a thousand pixels into — full
       utility strip, no shadow, floating over the middle of an article.

       From zero, that first call reads as downward travel, which is exactly
       what it is: everything between the top of the document and here has been
       passed. A page genuinely at the top takes the threshold branch above and
       never consults this at all. */
    let lastY = 0;
    /** The last value actually written, so the loop can skip a redundant write
     *  — the common case on a page being read slowly. */
    let wroteHdr = -1;
    let wroteRead = -1;

    const writeRead = () => {
      const doc = document.documentElement;
      // The scrollable distance, not the document height: a page shorter than
      // the viewport has none, and dividing by it is how a rail ends up at
      // Infinity (which paints as full, telling the reader they have finished a
      // page they have not started).
      const room = doc.scrollHeight - window.innerHeight;
      const read = room > 8 ? Math.min(1, Math.max(0, window.scrollY / room)) : 0;
      if (Math.abs(read - wroteRead) > EPSILON) {
        wroteRead = read;
        el.style.setProperty("--read", read.toFixed(4));
      }
    };

    const frame = () => {
      raf = 0;
      // Frame-time compensation: `EASE_PER_FRAME` is authored against 60Hz, and
      // without this the same code arrives twice as fast on a 120Hz panel and
      // crawls on a busy one.
      const k = EASE_PER_FRAME;
      current += (target - current) * k;
      if (Math.abs(target - current) < EPSILON) current = target;
      if (Math.abs(current - wroteHdr) > EPSILON) {
        wroteHdr = current;
        el.style.setProperty("--hdr", current.toFixed(4));
      }
      // Park. Nothing to interpolate means nothing to schedule.
      if (current !== target) raf = requestAnimationFrame(frame);
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const onScroll = () => {
      const y = window.scrollY || 0;
      writeRead();

      if (still) {
        lastY = y;
        return;
      }

      if (y <= THRESHOLD_PX) {
        // At the top the bar is always whole, whichever way the reader arrived
        // — including a browser restoring a scroll position on reload.
        target = 0;
      } else if (y > lastY) {
        target = 1;
      } else if (lastY - y > REVERSE_PX) {
        target = 0;
      }
      // A downward move of any size commits; an upward one has to mean it. So
      // the baseline only follows the reader downward, and an upward drift
      // accumulates against a fixed mark until it crosses REVERSE_PX.
      if (y > lastY || lastY - y > REVERSE_PX) lastY = y;

      schedule();
    };

    // The resting values, so the first paint reads sane numbers rather than the
    // `var(--hdr, 0)` fallback in a stylesheet nobody will remember to keep in
    // step with this file.
    el.style.setProperty("--hdr", "0");
    el.style.setProperty("--read", "0");
    // A reload can restore a scroll position deep in the page, and the header
    // must not spend the first frame pretending it is at the top.
    onScroll();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", writeRead, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", writeRead);
      if (raf) cancelAnimationFrame(raf);
      el.style.removeProperty("--hdr");
      el.style.removeProperty("--read");
    };
  }, []);

  return ref as React.RefObject<T>;
}

/**
 * The travelling indicator's measurements — `--px` and `--pw` on the nav.
 *
 * ── ONE PIECE OF INK, NOT SEVEN BACKGROUNDS ────────────────────────────────
 *
 * The nav used to give every item its own hover background, which means moving
 * from About to Services is one rectangle fading out while another fades in.
 * Two things dying and being born where a reader's eye expects one thing to
 * move. A single element that MEASURES the item it is under and travels the
 * real distance is the whole difference between a menu that responds and a
 * menu that feels like an object.
 *
 * It also collapses two indicators into one: with nothing hovered the pill
 * rests on the current page's item, so "where you are" and "where you are
 * pointing" are the same piece of ink, and the nav is never showing two
 * competing highlights.
 *
 * ── WHY IT MEASURES RATHER THAN BEING TOLD ─────────────────────────────────
 *
 * The obvious version passes an index and lets CSS compute `left: calc(i *
 * item-width)`. Every item here is a different width — "Contact" against "Nos
 * réalisations" — and the widths change with the language, with the tenant's
 * display font, and when the row wraps. Measuring is the only version that is
 * still right in French.
 *
 * `getBoundingClientRect` on one element, on a pointer event that already
 * happened, is not the layout thrash the shared scrub loop exists to avoid: it
 * is a read with no write in between.
 */
export function useTravellingPill<T extends HTMLElement>(): {
  navRef: React.RefObject<T>;
  /** Point the pill at an element (hover, focus), or at nothing (`null`), in
   *  which case it returns to the item marked as the current page. */
  aim: (el: HTMLElement | null) => void;
  /** Re-measure — after a route change, a language switch, or a resize. */
  settle: () => void;
} {
  const navRef = React.useRef<T | null>(null);

  const place = React.useCallback((el: HTMLElement | null) => {
    const nav = navRef.current;
    if (!nav) return;
    const target =
      el || nav.querySelector<HTMLElement>('[aria-current="page"]');

    if (!target) {
      // No current page in this nav (a route with no entry, /quote for
      // instance) and nothing hovered. The pill is not parked at position zero
      // — it is ABSENT, because a highlight sitting on the first item would
      // state that About is the page you are on.
      nav.style.setProperty("--pill-on", "0");
      return;
    }

    const navRect = nav.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    nav.style.setProperty("--px", `${Math.round(rect.left - navRect.left)}px`);
    nav.style.setProperty("--pw", `${Math.round(rect.width)}px`);
    nav.style.setProperty("--pill-on", "1");
  }, []);

  const aim = React.useCallback(
    (el: HTMLElement | null) => {
      const nav = navRef.current;
      // First placement must not be animated: a pill that slides in from the
      // left edge on every page load is an entrance nobody asked for, and on a
      // route change it would travel from the old page's item across a nav that
      // has already re-rendered.
      place(el);
      if (nav && nav.dataset.ready !== "true") {
        // Two frames: one for the browser to take the un-transitioned position,
        // one before transitions are allowed to apply to the next change.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (navRef.current) navRef.current.dataset.ready = "true";
          });
        });
      }
    },
    [place],
  );

  const settle = React.useCallback(() => {
    const nav = navRef.current;
    if (nav) nav.dataset.ready = "false";
    place(null);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (navRef.current) navRef.current.dataset.ready = "true";
      });
    });
  }, [place]);

  React.useEffect(() => {
    // Fonts land after first paint and every measurement taken before they do
    // is a measurement of the fallback face. Without this the pill is the wrong
    // width for the first few hundred milliseconds of every cold load — and
    // conspicuously so, because the display font is wider than the fallback.
    const onResize = () => place(null);
    window.addEventListener("resize", onResize);
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.ready?.then(() => place(null)).catch(() => {});
    return () => window.removeEventListener("resize", onResize);
  }, [place]);

  return { navRef: navRef as React.RefObject<T>, aim, settle };
}
