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
 * `fallback` is what to answer where `matchMedia` does not exist — SSR, and
 * jsdom versions that don't implement it. It is a required decision rather than
 * a silent `false`, because the safe default depends on the caller: a desktop
 * modal wants `true`, a mobile-only affordance wants `false`.
 *
 * THE FIRST RENDER ASKS `matchMedia`, it does not answer `fallback` and wait
 * for the effect. `matchMedia` is synchronous — there is nothing to wait for —
 * and a hook that reported the fallback until its effect ran made every effect
 * in the same commit act on the wrong viewport. The one that shipped: the
 * record lists' "a desktop on `?focus=` belongs on the route" exchange, run on
 * a phone that was a desktop for exactly one commit. The route handed the
 * phone back to `?focus=`, the remounted list sent it to the route again, and
 * the costing screen flashed between blank, the list, the sheet and the page
 * several times a second (`lib/record-360.test.tsx`).
 *
 * Mirrors `use-reduced-motion.ts`, including the Safari <14 `addListener`
 * guard — both listener APIs are feature-checked because jsdom's stub
 * implements neither in some versions.
 */
import * as React from "react";

/** The query's answer now, or `fallback` where there is no `matchMedia`. */
function matchNow(query: string, fallback: boolean): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return fallback;
  return window.matchMedia(query).matches;
}

export function useMediaQuery(query: string, fallback = false): boolean {
  const [matches, setMatches] = React.useState(() => matchNow(query, fallback));

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
 * Defaults to TRUE where there is no `matchMedia` to ask (SSR, jsdom): the
 * desktop branch is the richer one, and it is what a test that never asked for
 * a phone has always seen. A real browser gets its real answer on the first
 * render.
 */
export const DESKTOP_QUERY = "(min-width: 1024px)";

export const useIsDesktop = (): boolean => useMediaQuery(DESKTOP_QUERY, true);

/**
 * The same question as `useIsDesktop()`, answered NOW rather than from state.
 *
 * For an EFFECT that acts on the answer — the split screens' "open the first
 * row for the reader", which is right beside a desktop's detail pane and wrong
 * on a phone, where the detail is a full-screen sheet and opening it unasked
 * covers the list the reader came to — and for a callback, which has no render
 * to take the hook's value from. (It was also the workaround for the hook
 * answering its fallback on the first render; the hook no longer does, so the
 * two agree from the first commit.)
 *
 * Same fallback as the hook — true where `matchMedia` does not exist (jsdom),
 * so a test that renders a split screen sees the desktop behaviour it always
 * did.
 */
export function isDesktopNow(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia(DESKTOP_QUERY).matches;
}

/**
 * `md` and up — matching tailwind.config.ts `md: "768px"` exactly.
 *
 * This is the width at which a data TABLE stops working and has to become
 * something else. Below it a nine-column table with an action cell is not a
 * narrow table, it is a horizontally scrolling one: the row's subject is off
 * screen the moment the reader looks at its status, and on a touch screen the
 * horizontal pan competes with the page's vertical scroll. `useIsCompact()` is
 * the readable form of the question ("is this the small layout?"), and it
 * exists so a screen that renders a table and a screen that renders the same
 * records as cards cannot disagree about where the change happens.
 */
export const COMPACT_QUERY = "(min-width: 768px)";

/**
 * True below `md` — the phone and small-tablet layout.
 *
 * Defaults to FALSE (i.e. "render the full desktop table") for two reasons.
 * It is what a server render and a jsdom test should see — the richest branch,
 * which is the same reasoning `useIsDesktop` gives for defaulting to true —
 * and it means a component that swaps a table for a card list never renders
 * the cards during the first paint of a wide viewport.
 *
 * Use it through `<ResponsiveList>` rather than calling it directly when what
 * you are switching is "a table vs. cards" — the primitive keeps the two
 * branches mutually exclusive, which a hand-rolled `{compact ? … : …}` does
 * only if the author remembers.
 */
export const useIsCompact = (): boolean => !useMediaQuery(COMPACT_QUERY, true);

/**
 * `xl` and up — matching tailwind.config.ts `xl: "1280px"` exactly, and the
 * width at which the task board itself goes to four columns
 * (`xl:grid-cols-4`).
 *
 * The breakpoint that decides between "a detail pane beside the content" and
 * "a sheet over it" has to be the SAME number in the branch and in the layout,
 * for the reason `useIsDesktop` states: a screen whose CSS splits at one width
 * and whose JavaScript decides at another is a screen that renders the wrong
 * shell in the gap between them.
 *
 * It also has to be decided in JavaScript at all, which is not obvious when the
 * alternative is a `xl:hidden` wrapper. A component that renders through a
 * PORTAL — every `<Dialog>`, every Radix surface — is not a descendant of that
 * wrapper once it is mounted, so the media query hides nothing and the surface
 * appears at every width. The Tasks board shipped that bug: the phone sheet
 * opened over the board on desktop, next to the very pane it was meant to be.
 */
export const WIDE_QUERY = "(min-width: 1280px)";

export const useIsWide = (): boolean => useMediaQuery(WIDE_QUERY, true);
