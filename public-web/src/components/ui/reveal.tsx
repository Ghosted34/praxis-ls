import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Fade-and-rise a block the first time it scrolls into view
 * (doc/UI_UPGRADE_PLAN.md §6.6) — their `data-reveal`, which is on nearly every
 * element of their site and is a large part of why it feels considered.
 *
 * ── ONE OBSERVER, NOT ONE PER ELEMENT ─────────────────────────────────────
 *
 * A page can carry thirty of these. Thirty IntersectionObservers is thirty
 * callbacks the browser schedules on every scroll frame; one observer with
 * thirty targets is one. The shared instance is created lazily so a page with
 * no Reveal on it pays nothing, and each element unobserves itself the moment
 * it fires.
 *
 * ── IT NEVER RE-ANIMATES ───────────────────────────────────────────────────
 *
 * Unobserve-on-fire is the whole mechanism: an element that fades every time it
 * is scrolled past is a page that reads as broken, and it is the single most
 * common way this effect is got wrong.
 *
 * ── REDUCED MOTION IS NOT A SHORTER ANIMATION ─────────────────────────────
 *
 * `prefers-reduced-motion: reduce` renders the settled state immediately — no
 * transform, no transition, no observer at all. Somebody who has asked their
 * system for less motion has not asked for faster motion. `Skeleton` sets the
 * same precedent with `motion-reduce:animate-none`.
 *
 * ── WHY IT MAY START HIDDEN ────────────────────────────────────────────────
 *
 * The plan's first draft required the settled state on first paint so a reader
 * with JavaScript disabled would still see the content. That requirement was
 * wrong for THIS app and has been corrected in the plan: `public-web` is
 * client-rendered — `public-head.js` says so in as many words, "the body is
 * still empty, so this is not SSR and does not pretend to be" — so with
 * JavaScript off nothing renders at all and there is no content for a hidden
 * class to hide. What a crawler reads is the `<head>`, which is built on the
 * server and is untouched by any of this.
 */

type Cb = () => void;
let observer: IntersectionObserver | null = null;
const callbacks = new WeakMap<Element, Cb>();

function watch(el: Element, cb: Cb): () => void {
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const fire = callbacks.get(entry.target);
          // Unobserve BEFORE firing: the callback sets state, and a second
          // entry for the same element in the same batch would fire it twice.
          observer?.unobserve(entry.target);
          callbacks.delete(entry.target);
          fire?.();
        }
      },
      // A block is "arrived" once an eighth of it is showing. Higher and a tall
      // section never triggers on a short screen; lower and everything has
      // already animated before it is legible.
      { threshold: 0.12 },
    );
  }
  callbacks.set(el, cb);
  observer.observe(el);
  return () => {
    callbacks.delete(el);
    observer?.unobserve(el);
  };
}

/** The one query, read once — it cannot change without a reload in practice,
 *  and reading it per element is a layout-thrash per element. */
const reduced = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The same observer, for a component that animates its own INSIDES.
 *
 * `Reveal` fades a block in as one object, which is the right answer almost
 * everywhere. It is the wrong answer for the portal preview, whose point is a
 * sequence — a progress bar filling, then milestone ticks landing behind it — so
 * that component needs to know WHEN it came into view rather than to be faded as
 * a whole. Wrapping it in `Reveal` and animating inside it too would run two
 * animations over one element.
 *
 * It shares `watch`, so this does not undo the one-observer rule above: a page
 * using both still schedules a single callback per scroll frame. And it settles
 * the same way — reduced motion or no `IntersectionObserver` reports true on
 * first render, so the caller renders its finished state rather than an empty
 * one.
 */
export function useRevealed<T extends HTMLElement>(): readonly [
  React.RefObject<T>,
  boolean,
] {
  const ref = React.useRef<T | null>(null);
  const [shown, setShown] = React.useState(
    () => reduced() || typeof IntersectionObserver === "undefined",
  );

  React.useEffect(() => {
    if (shown || !ref.current) return undefined;
    return watch(ref.current, () => setShown(true));
  }, [shown]);

  // Handed back as `RefObject<T>` rather than `RefObject<T | null>`: the ref is
  // only ever attached to the element it was made for, and the nullable form is
  // not assignable to a JSX `ref` prop under the React 18 element typings.
  return [ref as React.RefObject<T>, shown] as const;
}

/* ── the second observer, and why there is one ──────────────────────────────
 *
 * Everything above unobserves on fire, which is the whole mechanism: an element
 * that fades every time it is scrolled past reads as broken. A CONTINUOUS set
 * piece needs the opposite — it must be told when it LEAVES too, so its frame
 * loop can stop while it is off screen. That is not a flag on the observer
 * above; it is a different callback contract, and threading a "keep watching"
 * boolean through `watch` would mean the fire-once path could be switched off
 * by a caller's typo.
 *
 * So: a SECOND shared instance, not a second instance PER ELEMENT. The rule the
 * header states — "thirty IntersectionObservers is thirty callbacks the browser
 * schedules on every scroll frame" — is about per-element observers, and it is
 * still honoured: every continuous element on the page rides this one.
 *
 * Created lazily, so a page with no set piece on it pays nothing.
 */
let liveObserver: IntersectionObserver | null = null;
const liveCallbacks = new WeakMap<Element, (visible: boolean) => void>();

function watchLive(el: Element, cb: (visible: boolean) => void): () => void {
  if (!liveObserver) {
    liveObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          liveCallbacks.get(entry.target)?.(entry.isIntersecting);
        }
      },
      // Any sliver counts. A tall set piece whose top edge is showing is a set
      // piece the reader can see moving, and a threshold that waited for 12%
      // would leave a visibly frozen scene at the bottom of the screen.
      { threshold: 0 },
    );
  }
  liveCallbacks.set(el, cb);
  liveObserver.observe(el);
  return () => {
    liveCallbacks.delete(el);
    liveObserver?.unobserve(el);
  };
}

/**
 * A THIRD shared observer, and the only one that fires BEFORE you can see the
 * element.
 *
 * ── WHAT IT IS FOR ────────────────────────────────────────────────────────
 *
 * `watch` and `watchLive` both answer "is this visible". Neither can be used to
 * load something a visitor is ABOUT to need, because by the time they say yes
 * the visitor is already looking at the gap.
 *
 * The services page is the case that needed it (F-18). Its quote band sits at
 * the bottom of an 800-line page, and rendering it eagerly put the whole quote
 * wizard — 6.6 kB gzipped, the largest single item — on the route's critical
 * path, so every visitor who came to read about sea freight waited for a form
 * most of them never scroll to. Deferring it behind `useInView` would have
 * traded that for a visible swap under the reader's thumb, which is the reflow
 * `fonts-fallback.css` exists to prevent, arriving by another door.
 *
 * A screen of margin resolves both: the chunk is off the critical path, and it
 * has already landed by the time the band is legible. The placeholder is what a
 * reader sees only if they jump to the bottom faster than a fetch.
 *
 * ── WHY NOT A ROOTMARGIN ON THE EXISTING OBSERVER ─────────────────────────
 *
 * `watch`'s margin is part of what "arrived" means for a reveal: give it 600 px
 * of lead and every animation on the page fires a screen early, which is the
 * one-line change that makes a whole site look like it has already finished
 * animating. The options are the behaviour, so a second behaviour is a second
 * instance — the same argument `watchLive` above makes, for the same reason.
 */
let nearObserver: IntersectionObserver | null = null;
const nearCallbacks = new WeakMap<Element, Cb>();

function watchNear(el: Element, cb: Cb): () => void {
  if (!nearObserver) {
    nearObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const fire = nearCallbacks.get(entry.target);
          nearObserver?.unobserve(entry.target);
          nearCallbacks.delete(entry.target);
          fire?.();
        }
      },
      /* One screen of lead. Enough for a chunk on a slow connection to arrive
         before the band is legible; not so much that a visitor who never
         scrolls past the hero downloads it anyway — which would give back the
         kilobytes this exists to save. */
      { rootMargin: "100% 0px", threshold: 0 },
    );
  }
  nearCallbacks.set(el, cb);
  nearObserver.observe(el);
  return () => {
    nearCallbacks.delete(el);
    nearObserver?.unobserve(el);
  };
}

/**
 * Is this element within about a screen of the viewport — i.e. should whatever
 * it needs be fetched now?
 *
 * Latches true and stays there: this gates a `React.lazy` import, and a hook
 * that flapped would unmount a form a visitor had started filling in.
 *
 * Reports true immediately where there is no `IntersectionObserver`, and under
 * reduced motion — the same contract as the two hooks above, and for a stronger
 * reason here: this one gates CONTENT, not an animation. A reader who asked for
 * less motion is not asking for less of the page.
 */
export function useApproaching<T extends HTMLElement>(): readonly [
  React.RefObject<T>,
  boolean,
] {
  const eager = reduced() || typeof IntersectionObserver === "undefined";
  const ref = React.useRef<T | null>(null);
  const [near, setNear] = React.useState(eager);

  React.useEffect(() => {
    if (eager || near || !ref.current) return undefined;
    return watchNear(ref.current, () => setNear(true));
  }, [eager, near]);

  return [ref as React.RefObject<T>, near] as const;
}

/**
 * Is this element on screen, right now, and continuously?
 *
 * For a component that RUNS while visible — a canvas, an ambient scene — rather
 * than one that animates once on arrival. Reports `false` first and lets the
 * observer correct it, so nothing starts a frame loop before the browser has
 * confirmed anybody can see it.
 *
 * Under reduced motion, and where there is no `IntersectionObserver`, it
 * reports `true` and attaches nothing: the caller is expected to draw its
 * settled state once, which is not something to withhold from a reader who
 * asked for less motion.
 */
export function useInView<T extends HTMLElement>(): readonly [
  React.RefObject<T>,
  boolean,
] {
  const still = reduced() || typeof IntersectionObserver === "undefined";
  const ref = React.useRef<T | null>(null);
  const [visible, setVisible] = React.useState(still);

  React.useEffect(() => {
    if (still || !ref.current) return undefined;
    return watchLive(ref.current, setVisible);
  }, [still]);

  return [ref as React.RefObject<T>, visible] as const;
}

export function Reveal({
  children,
  /** 0–3. Beyond three the last card arrives after the reader has looked away. */
  delay = 0,
  as: Tag = "div",
  className,
  style,
}: {
  children: React.ReactNode;
  delay?: 0 | 1 | 2 | 3;
  as?: "div" | "section" | "li";
  className?: string;
  /**
   * Merged UNDER the reveal's own transition-delay, never over it.
   *
   * The services grid (§7.3) sets `--cx` here — a card's position across the
   * row, which the 3D transform reads. It has to live on this element because
   * this is the grid item; a wrapper inside would be a second box between the
   * grid and the card. The spread order below is what stops a caller silently
   * cancelling the stagger by passing a style object.
   */
  style?: React.CSSProperties;
}) {
  // Settled from the start when motion is reduced, or when the browser has no
  // IntersectionObserver — an old browser gets the content, not a blank page.
  const [shown, setShown] = React.useState(
    () => reduced() || typeof IntersectionObserver === "undefined",
  );
  const ref = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (shown || !ref.current) return undefined;
    return watch(ref.current, () => setShown(true));
  }, [shown]);

  return (
    <Tag
      ref={ref as React.Ref<never>}
      className={cn(
        "motion-reduce:!translate-y-0 motion-reduce:!opacity-100 motion-reduce:!transition-none",
        "transition-[opacity,transform] duration-[420ms] ease-[var(--ease)]",
        shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        className,
      )}
      style={
        shown && delay ? { ...style, transitionDelay: `${delay * 60}ms` } : style
      }
    >
      {children}
    </Tag>
  );
}
