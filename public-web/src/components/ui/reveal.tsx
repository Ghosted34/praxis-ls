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

export function Reveal({
  children,
  /** 0–3. Beyond three the last card arrives after the reader has looked away. */
  delay = 0,
  as: Tag = "div",
  className,
}: {
  children: React.ReactNode;
  delay?: 0 | 1 | 2 | 3;
  as?: "div" | "section" | "li";
  className?: string;
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
      style={shown && delay ? { transitionDelay: `${delay * 60}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
