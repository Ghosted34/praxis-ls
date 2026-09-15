import * as React from "react";
import { cn } from "@/lib/cn";
import { useScrollScrub } from "@/lib/motion";
import { useRevealed } from "@/components/ui/reveal";

/**
 * Type as a material.
 *
 * ── WHY THESE EXIST ────────────────────────────────────────────────────────
 *
 * The brief for this programme is explicit that long static prose is the enemy:
 * readers fatigue and leave, and a wall of text is what makes a considered site
 * read as a brochure. `doc/PUBLIC_WEB_EXPERIENCE_GUIDE.md` §1.5 turns that into
 * a number — no prose block on a marketing page exceeds 90 words without being
 * broken by an illustration, a diagram, a pull-quote or a staged reveal.
 *
 * A rule with a number needs tools, or every author meets it by deleting
 * sentences. These are the tools: ways to make text itself carry motion,
 * emphasis and structure, so the 90 words that survive do more work than the
 * 300 they replaced.
 *
 * ── AND WHY THEY ARE CAREFUL ABOUT SCREEN READERS ──────────────────────────
 *
 * Every technique here fragments a sentence into elements. That is fine for
 * sighted readers and a genuine hazard for assistive technology, which can
 * announce a word-split heading one word at a time. So `StagedLines` hides every
 * fragment and carries the whole sentence in a visually-hidden span — the
 * heading is announced as one sentence, and what is animated is decoration the
 * screen reader never sees.
 *
 * ── WHY THAT IS A HIDDEN SPAN AND NOT `aria-label` ────────────────────────
 *
 * It was `aria-label` on the container, which is the obvious solution and is
 * INVALID: ARIA prohibits `aria-label` on a generic element — a `<span>` or a
 * `<div>` with no role — because there is no role for the label to name. Chrome
 * and axe both report it (`aria-prohibited-attr`), and the practical effect is
 * that some assistive technology ignores the label entirely and announces the
 * heading as empty, since every fragment inside it is `aria-hidden`.
 *
 * Found by running Lighthouse against the built homepage rather than by
 * reading the component: PR 1 shipped this primitive and nothing rendered it
 * until PR 3 put it on the hero, so the defect had never been on a page.
 */

/**
 * A heading that arrives a word at a time.
 *
 * Splitting happens at render, never on a timer: a `setInterval` that reveals
 * words is a component that keeps running after the reader has looked away,
 * and it desynchronises the moment the tab is backgrounded. Here the stagger is
 * pure CSS — each fragment carries its index as `--i` and reads a delay from
 * it — so the browser owns the schedule and pausing is free.
 *
 * Under reduced motion, and when `IntersectionObserver` is missing, the settled
 * state renders immediately. That is the rule `reveal.tsx` set and it is not a
 * shorter animation.
 */
export function StagedLines({
  text,
  as: Tag = "span",
  className,
  wordClassName,
  /** Milliseconds between consecutive words. Kept small — the whole phrase must
   *  land inside the 600 ms narrative budget however many words it has, so the
   *  total is capped below rather than multiplied out. */
  step = 45,
  /**
   * Paint the words at full opacity from the first frame, staggering only their
   * RISE. Set this on anything that is the page's LCP element.
   *
   * ── WHY IT EXISTS, WITH THE NUMBER ────────────────────────────────────
   *
   * `.staged-word` starts at `opacity: 0`. Largest Contentful Paint measures
   * when the largest element is PAINTED, and text at zero opacity is not
   * painted — so a headline that fades in delays LCP by the whole of its own
   * entrance. On the hero, which §7.1 names as the LCP element, that measured:
   *
   *     element render delay  2989 ms → 3679 ms   (+691 ms)
   *
   * against `main`, for an animation nobody asked to wait for. Worse, the
   * reveal is triggered by `useRevealed` — an IntersectionObserver — and the
   * hero is ALWAYS in view at load, so the "scroll reveal" fires immediately
   * and buys nothing at all in exchange for that delay.
   *
   * Staggering the transform alone keeps the effect: the words still arrive one
   * after another, rising into place. They are simply legible while they do it,
   * which is what a headline is for.
   */
  paintImmediately = false,
  /**
   * Wrap every word in a clip it rises out of.
   *
   * ── IT IS A PARTIAL MASK, AND THAT IS THE WHOLE DESIGN ────────────────
   *
   * The obvious build — a clip tall enough to hide the word before it moves —
   * re-creates the exact defect `paintImmediately` exists to fix. LCP measures
   * when the largest element is PAINTED; text clipped out of its container is
   * no more painted than text at `opacity: 0`, so a full mask on a hero
   * headline is the same +691 ms wearing a different property, and a harder one
   * to find because nothing in the file says `opacity: 0`.
   *
   * So the clip is sized to the glyphs and the word travels 0.4em: about
   * four-fifths of it is inside the clip on the first frame, and the fifth that
   * is cut is the fifth the eye reads as an edge. `.staged-clip` in index.css
   * carries the padding/negative-margin pair that keeps the headline's measure
   * and wrap points identical to the unmasked version.
   *
   * MEASURED, not assumed, on the built page over seven loads each:
   *
   *     main          LCP 248 ms median   element H1
   *     with the mask LCP 248 ms median   element H1
   *
   * Identical, and still the headline. That is the only evidence that makes the
   * paragraph above true rather than plausible.
   */
  masked = false,
  /**
   * Hold every word back by this many milliseconds before the stagger starts.
   *
   * For a headline split across two `StagedLines` — the hero's is, so its accent
   * can arrive on its own beat after the rest of the line has landed. It is a
   * delay, not a second timeline: the stagger inside this instance is unchanged,
   * and nothing here schedules anything in JavaScript.
   */
  startDelay = 0,
  /**
   * Where this instance's words sit in the headline AS A WHOLE.
   *
   * A headline split across two `StagedLines` — the hero's is, so its accent can
   * arrive on its own beat — is still one sentence to a reader and to anything
   * sweeping across it. Without this the accent word is index 0 of its own
   * instance and a left-to-right effect restarts on it, which reads as the
   * sweep stuttering rather than as it continuing.
   *
   * It is written out as `--wi` on every word, for CSS to consume. Nothing here
   * decides what it is FOR: the hero's per-word light reads it, and anything
   * else that wants a position in the line can too.
   */
  wordOffset = 0,
}: {
  text: string;
  as?: "h1" | "h2" | "h3" | "p" | "span" | "div";
  className?: string;
  wordClassName?: string;
  step?: number;
  paintImmediately?: boolean;
  masked?: boolean;
  startDelay?: number;
  wordOffset?: number;
}) {
  const [ref, shown] = useRevealed<HTMLElement>();
  const words = React.useMemo(() => text.split(/(\s+)/), [text]);

  // The stagger is capped so a long headline still completes inside the
  // narrative budget. Without this, a twelve-word line at 45ms takes 540ms of
  // stagger PLUS the word's own transition and blows the ceiling that
  // check-motion.mjs enforces.
  const realStep = Math.min(step, 420 / Math.max(words.length, 1));

  return (
    <Tag ref={ref as React.Ref<never>} className={cn("staged", className)}>
      {/* The real, readable sentence. Present in the DOM, in the accessibility
          tree, and clipped to a single pixel — so the heading's accessible name
          comes from actual text content, which needs no role and no ARIA at
          all. `sr-only` is Tailwind's own recipe and is already used elsewhere
          in this app. */}
      <span className="sr-only">{text}</span>
      {words.map((word, i) => {
        // Whitespace is preserved as text rather than as a fragment: wrapping
        // it makes `inline-block` collapse the gap and the words run together.
        if (/^\s+$/.test(word)) return <React.Fragment key={i}>{word}</React.Fragment>;

        const moving = (
          <span
            aria-hidden
            className={cn(
              "staged-word",
              paintImmediately && "staged-word-lit",
              shown && "is-in",
              wordClassName,
            )}
            style={
              {
                transitionDelay: shown
                  ? `${startDelay + Math.round((i / 2) * realStep)}ms`
                  : undefined,
                // `i / 2` because `words` interleaves the whitespace it split
                // on, so every other entry is a gap.
                "--wi": String(wordOffset + i / 2),
              } as React.CSSProperties
            }
          >
            {word}
          </span>
        );

        // `aria-hidden` stays on the WORD rather than moving out to the clip.
        // The clip is a box, not a fragment of a sentence, and every
        // `.staged-word` in the tree being hidden is the invariant the a11y
        // test holds — one that a future caller rendering a word without a clip
        // would otherwise quietly break.
        return masked ? (
          <span key={i} className="staged-clip">
            {moving}
          </span>
        ) : (
          <React.Fragment key={i}>{moving}</React.Fragment>
        );
      })}
    </Tag>
  );
}

/**
 * Display type whose WEIGHT responds to scroll position.
 *
 * This is the one effect that genuinely needs a variable font with a wide axis,
 * and the reason Archivo is in the library (100–900). It is deliberately subtle:
 * a headline that swings from Thin to Black as you scroll is a novelty, and a
 * headline that gains thirty or forty units of weight as it settles into place
 * reads as the page focusing.
 *
 * `--scrub` comes from `useScrollScrub`, which writes it on the element without
 * touching React. Under reduced motion the hook sets it once to its settled
 * value and attaches nothing.
 */
export function WeightScrub({
  children,
  from = 380,
  to = 680,
  as: Tag = "span",
  className,
}: {
  children: React.ReactNode;
  from?: number;
  to?: number;
  as?: "h1" | "h2" | "h3" | "span" | "div";
  className?: string;
}) {
  const ref = useScrollScrub<HTMLElement>({ start: 0.9, end: 0.35, prop: "--scrub" });
  return (
    <Tag
      ref={ref as React.Ref<never>}
      className={cn("weight-scrub", className)}
      style={
        {
          "--wght-from": String(from),
          "--wght-to": String(to),
        } as React.CSSProperties
      }
    >
      {children}
    </Tag>
  );
}

/**
 * A sentence lifted out of the flow.
 *
 * The cheapest way to break a wall of prose and the one most often done badly:
 * a pull-quote that merely enlarges the text adds length without adding
 * structure. This one changes the MEASURE as well as the size, so the eye
 * registers a different kind of object rather than the same object shouting.
 *
 * `cite` is optional and, when present, is real attribution — `<figcaption>`
 * inside a `<figure>`, so it is announced as belonging to the quote rather than
 * as a stray line of small text.
 */
export function PullQuote({
  children,
  cite,
  className,
}: {
  children: React.ReactNode;
  cite?: string;
  className?: string;
}) {
  return (
    <figure className={cn("pull-quote", className)}>
      <blockquote>{children}</blockquote>
      {cite ? <figcaption>{cite}</figcaption> : null}
    </figure>
  );
}

/**
 * A figure with a label — the unit that replaces a sentence containing a
 * number.
 *
 * "We have been operating since 2021" is a sentence a reader skims. 2021, set
 * large, in the mono face, with "operating since" beneath it, is a fact they
 * retain. `tabular-nums` because these sit in rows and a proportional 1 makes
 * a row of figures look broken.
 *
 * It asserts nothing on its own: the value comes from the caller, which comes
 * from the tenant's own data. N12 is not relaxed by making a number look good.
 */
export function FigureCallout({
  value,
  label,
  sublabel,
  className,
}: {
  value: React.ReactNode;
  label: string;
  sublabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("figure-callout", className)}>
      <div className="figure-callout-value">{value}</div>
      <div className="figure-callout-label">{label}</div>
      {sublabel ? (
        <div className="figure-callout-sub">{sublabel}</div>
      ) : null}
    </div>
  );
}
