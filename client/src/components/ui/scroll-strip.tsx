/**
 * ScrollStrip — the one horizontally scrollable strip behind every tab bar.
 *
 * WHY. A tab strip is the only navigation in this app that is a list of
 * SIBLINGS with no natural order, and on a 390px screen a 12-section dossier
 * cannot show them all at once. The old answer was `flex-wrap`, which is why
 * the corporate-entity 360's strip occupied four rows on a phone (twelve tabs,
 * several of them two words) and why the master-data hub's occupied three: a
 * wrapped strip is not a strip, it is a wall of buttons between the record and
 * its content, and every wrap point moves when a label changes. Worse, the
 * wrapped version pushed the thing the reader came for — the record's actual
 * content — an entire screen further down.
 *
 * So: ONE row on a phone, scrolled horizontally, with the active tab brought
 * into view and a fade at each end that says "there is more, that way". The
 * fade is measured, not decorative — it appears only when that side genuinely
 * has tabs beyond the edge, because a fade over the first tab is a lie that
 * costs the reader a swipe to disprove. From `md` up the strip has room and
 * goes back to wrapping, which is what every screen already looked like.
 *
 * It is a LAYOUT primitive, not a control: it renders no buttons and owns no
 * state. Both tab flavours in the app put their own triggers inside it —
 * `tabs.tsx` (Radix, for sibling views of one screen) and `section-tabs.tsx`
 * (URL sections of a record, where the tag is `<nav>` and the state is
 * `?tab=`). One strip, two semantics, so the two cannot drift visually.
 *
 * THE ACTIVE TAB IS MARKED WITH `data-strip-active`. Not `data-state`, which is
 * Radix's own attribute and would tie this to one of the two callers. Whatever
 * the strip contains, the element carrying `data-strip-active="true"` is the one
 * scrolled into view when `activeKey` changes — which is what makes a deep link
 * to the eleventh section land with its tab visible rather than off-screen.
 *
 * @example
 * <ScrollStrip as="nav" label="Entity sections" activeKey={tab}>
 *   <button data-strip-active={tab === t || undefined} …>{t}</button>
 * </ScrollStrip>
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

/** The scroller's own classes. `scroll-strip` kills the scrollbar (see
 *  index.css) — a horizontal scrollbar drawn across a tab row reads as a broken
 *  layout, and the fades already communicate the overflow. */
const SCROLLER =
  "scroll-strip flex snap-x gap-1 overflow-x-auto overscroll-x-contain border-b md:flex-wrap md:overflow-x-visible";

/** Pinned under the app bar. `bg-background` is not decoration: without an
 *  opaque surface the rows scrolling underneath show through the strip. Only
 *  set on a phone by default — on a desktop the strip has room and pinning it
 *  takes a permanent slice off a tall table. */
const STICKY = "sticky top-0 z-20 bg-background";

function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}

type ScrollStripProps = Omit<React.HTMLAttributes<HTMLDivElement>, "ref"> & {
  /**
   * The wrapper element. `nav` for a strip of URL sections, where the landmark
   * is the honest tag; `div` (default) when the element carries a role of its
   * own — Radix's `Tabs.List` arrives through `asChild` with `role="tablist"`,
   * and the wrapper must not compete with it for the accessible name.
   */
  as?: "div" | "nav";
  /** Accessible name. Goes on the `nav` wrapper when `as="nav"`, and is
   *  otherwise left to the caller's own attributes on the scroller. */
  label?: string;
  /** Pin under the app bar while the page scrolls. */
  sticky?: boolean;
  /** When this changes, `[data-strip-active="true"]` is scrolled into view. */
  activeKey?: string | number | null;
  /** Classes for the outer, non-scrolling wrapper (margins, sticky surface). */
  wrapperClassName?: string;
};

export const ScrollStrip = React.forwardRef<HTMLDivElement, ScrollStripProps>(
  function ScrollStrip(
    {
      as: Wrapper = "div",
      label,
      sticky = false,
      activeKey,
      className,
      wrapperClassName,
      children,
      ...rest
    },
    forwardedRef,
  ) {
    const scroller = React.useRef<HTMLDivElement | null>(null);
    const [edges, setEdges] = React.useState({ start: false, end: false });
    const reduced = usePrefersReducedMotion();

    const measure = React.useCallback(() => {
      const el = scroller.current;
      if (!el) return;
      // jsdom reports 0 for all three, so this is also the "not scrollable"
      // fallback: no fades, which is what a strip that fits should show.
      const overflow = el.scrollWidth - el.clientWidth > 1;
      setEdges((prev) => {
        const next = {
          start: overflow && el.scrollLeft > 1,
          end: overflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
        };
        return prev.start === next.start && prev.end === next.end ? prev : next;
      });
    }, []);

    /*
     * MEASURED AFTER EVERY RENDER, not only on scroll and resize.
     *
     * The content changes without the box changing: a count settles from the
     * server ("Documents 2" → "Documents 1200"), a tab is renamed, a permission
     * reveals a section. `overflow-x: auto` keeps the scroller's own box the
     * same width, so a ResizeObserver on the element sees nothing — and the
     * fades end up describing a strip that no longer exists.
     *
     * No dependency array is deliberate and is not a loop: `measure` compares
     * before it sets, and returns the previous object when nothing moved, which
     * React treats as a bail-out. Reading `scrollWidth` forces layout, which is
     * the cost of the whole effect — one layout read per render of a tab strip.
     */
    React.useEffect(() => {
      measure();
    });

    React.useEffect(() => {
      const el = scroller.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      // The BOX changing is a different event: a rotation, a sidebar
      // collapsing, the phone sheet resizing under the strip (which is what the
      // 360 modal does when the keyboard opens).
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, [measure]);

    // Bring the active tab into view. `block: "nearest"` on purpose: this must
    // never scroll the page vertically — a reader who taps a tab halfway down a
    // dossier stays exactly where they were looking.
    React.useEffect(() => {
      if (activeKey === undefined) return;
      const el = scroller.current;
      if (!el) return;
      const active = el.querySelector<HTMLElement>('[data-strip-active="true"]');
      if (!active) return;
      // Nothing to do when the strip fits: scrollIntoView on a non-overflowing
      // container still walks up the tree and can nudge the page.
      if (el.scrollWidth - el.clientWidth <= 1) return;
      active.scrollIntoView({
        inline: "center",
        block: "nearest",
        behavior: reduced ? "auto" : "smooth",
      });
      measure();
      // NOT keyed on `children`. That array is a fresh identity every render, so
      // a strip that depended on it would re-centre the active tab — with a
      // smooth animation — every time anything else on the screen re-rendered,
      // including every keystroke in that screen's search box. The section you
      // are on only needs finding when it CHANGES, or when this strip mounts
      // (which is what makes a deep link to `?tab=Renewals` land with Renewals
      // visible rather than scrolled off the right-hand edge).
    }, [activeKey, reduced, measure]);

    return (
      <Wrapper
        className={cn("relative", sticky && STICKY, wrapperClassName)}
        {...(Wrapper === "nav" && label ? { "aria-label": label } : {})}
      >
        {edges.start && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent"
          />
        )}
        <div
          ref={mergeRefs(scroller, forwardedRef)}
          className={cn(SCROLLER, className)}
          {...rest}
          // After `{...rest}`, so the fades stay correct even when a caller
          // brings its own scroll handler — theirs runs first, this one is not
          // replaced by it.
          onScroll={(e) => {
            rest.onScroll?.(e);
            measure();
          }}
        >
          {children}
        </div>
        {edges.end && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent"
          />
        )}
      </Wrapper>
    );
  },
);

/**
 * The classes one tab trigger wears, shared by both flavours so an active tab in
 * a Radix strip and an active section in a `<nav>` are the same object.
 *
 * The active state is styled off `data-strip-active` rather than
 * `data-[state=active]` for the same reason `ScrollStrip` reads that attribute:
 * `section-tabs.tsx`'s buttons are not Radix triggers and have no `data-state`.
 */
export const TAB_TRIGGER = cn(
  "-mb-px snap-start whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors",
  "hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
  "data-[strip-active=true]:border-primary data-[strip-active=true]:font-semibold data-[strip-active=true]:text-foreground",
);

/**
 * The count badge a tab may carry — "Documents 12".
 *
 * A NODE, not a number: most counts are how many rows a section holds, but the
 * operations file's Milestones tab carries "3/7" — done of total — and that is
 * the same badge doing the same job. `null`/`undefined` renders nothing, which
 * is how a section with no count stays a plain label.
 *
 * It rides inside the tab's label rather than sitting beside it as a separate
 * control, so the tab stays ONE tap target (a badge that is its own button is a
 * 20px mis-tap next to the 44px one the reader meant), and so
 * `getByRole("button", { name: /^Banks/ })` still matches the tab it named.
 */
export function TabCount({ count }: { count?: React.ReactNode }) {
  if (count == null) return null;
  return <span className="num ml-1.5 text-[11px] font-medium">{count}</span>;
}
