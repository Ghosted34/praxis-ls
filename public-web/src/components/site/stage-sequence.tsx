import * as React from "react";
import { useScrollScrub } from "@/lib/motion";

/**
 * How-we-work, as the journey's middle — §7.4.
 *
 * ── WHAT THIS REPLACES, AND WHY ────────────────────────────────────────────
 *
 * `StepList` is three equal boxes in a row: correct, legible, and the flattest
 * thing on the page. Three parallel items in a `<ul>` is exactly the shape §1.5
 * names as "a candidate for a diagram, not a list", and §7 asks this band to
 * carry the spine — each band a stage of one shipment moving from origin to
 * delivery, with the scroll as the movement.
 *
 * So the steps become a SEQUENCE: a rail that fills as the reader scrolls, and
 * a drawn diagram per stage that comes into focus as its stage arrives. The
 * text does not grow; the diagram is what carries the meaning the extra
 * sentences would have carried, which is the 90-word rule working as intended
 * rather than as a word count somebody meets by deleting clauses.
 *
 * `StepList` IS deleted, which is the honest answer rather than the comfortable
 * one. The homepage was its only caller — checked, not assumed — so keeping it
 * would have left an exported component nothing renders: the kind a later
 * reader has to open, understand, and only then discover is dead. It was three
 * boxes and a numbered span; a future page that wants that shape back is
 * cheaper to write than to have carried.
 *
 * ── THE SCRUB WRITES CSS, NOT STATE ────────────────────────────────────────
 *
 * `useScrollScrub` writes `--scrub` on the container, once per frame, without
 * touching React. Everything below reads it in CSS. The alternative — a scroll
 * handler that calls `setState` — re-renders this subtree sixty times a second
 * on the phone this app exists for. `lib/motion.ts` opens with that rule and it
 * is the reason the hooks return a ref and nothing else.
 *
 * Under reduced motion the hook sets `--scrub` once to its settled value (1) and
 * attaches no listener: every stage is lit, every diagram is at rest, and the
 * band reads as a finished diagram rather than as an animation that has not
 * started.
 */

export type Stage = { title: string; body: string };

/**
 * The diagrams. One per stage, drawn rather than photographed, and abstract by
 * construction — they show a SHAPE of work, not a claim about volumes, lanes or
 * clients. `currentColor` throughout, so a tenant re-brand carries them.
 *
 * Three, matching the three steps the dictionary has always had. A fourth stage
 * from a tenant's own `feature_list` cycles back to the first diagram rather
 * than rendering nothing: a stage with no picture in a band of pictures reads
 * as a fault, and the diagram is decorative, so repeating one asserts nothing.
 */
const DIAGRAMS: Array<(p: { className?: string }) => React.JSX.Element> = [
  // 1 — the enquiry: a form becoming a reference.
  ({ className }) => (
    <svg viewBox="0 0 120 80" fill="none" aria-hidden className={className}>
      <rect x="10" y="12" width="46" height="56" rx="3" stroke="currentColor" strokeOpacity=".35" />
      <path d="M18 26h30M18 34h30M18 42h20" stroke="currentColor" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" />
      <path d="M60 40h34" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" className="stage-flow" />
      <path d="M88 34l8 6-8 6" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="64" y="52" width="42" height="14" rx="2" stroke="var(--primary)" strokeOpacity=".5" />
    </svg>
  ),
  // 2 — pricing and booking: three routings, one chosen.
  ({ className }) => (
    <svg viewBox="0 0 120 80" fill="none" aria-hidden className={className}>
      <circle cx="16" cy="40" r="4" fill="var(--primary)" />
      <path d="M20 40C40 40 44 18 66 18" stroke="currentColor" strokeOpacity=".3" strokeDasharray="3 4" />
      <path d="M20 40C40 40 44 62 66 62" stroke="currentColor" strokeOpacity=".3" strokeDasharray="3 4" />
      <path d="M20 40h46" stroke="var(--primary)" strokeWidth="2" className="stage-flow" />
      <circle cx="70" cy="18" r="3" stroke="currentColor" strokeOpacity=".35" />
      <circle cx="70" cy="62" r="3" stroke="currentColor" strokeOpacity=".35" />
      <rect x="66" y="34" width="40" height="13" rx="2" fill="var(--primary)" fillOpacity=".14" stroke="var(--primary)" strokeOpacity=".55" />
    </svg>
  ),
  // 3 — in transit: milestones landing on a rail.
  ({ className }) => (
    <svg viewBox="0 0 120 80" fill="none" aria-hidden className={className}>
      <path d="M12 40h96" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 40h58" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" className="stage-flow" />
      {[12, 40, 68, 96].map((x, i) => (
        <circle
          key={x}
          cx={x}
          cy="40"
          r={i < 3 ? 4 : 3.5}
          fill={i < 3 ? "var(--primary)" : "none"}
          stroke={i < 3 ? "none" : "currentColor"}
          strokeOpacity=".35"
        />
      ))}
      <path d="M34 26v-8M62 26v-8" stroke="currentColor" strokeOpacity=".25" strokeLinecap="round" />
      <rect x="24" y="52" width="20" height="12" rx="2" stroke="currentColor" strokeOpacity=".3" />
      <rect x="52" y="52" width="20" height="12" rx="2" stroke="currentColor" strokeOpacity=".3" />
    </svg>
  ),
];

export function StageSequence({ stages }: { stages: Stage[] }) {
  /* Narrower than the default 1 → 0.

     The default scrub completes as the element's bottom edge leaves the top of
     the screen, which for a band this tall means the last stage lights up when
     it is already off screen. 0.85 → 0.25 finishes the fill while the whole
     sequence is still comfortably in view, which is where somebody is actually
     reading it. */
  const ref = useScrollScrub<HTMLOListElement>({ start: 0.85, end: 0.25 });

  return (
    <ol ref={ref} className="stage-seq">
      {stages.map((s, i) => {
        const Diagram = DIAGRAMS[i % DIAGRAMS.length];
        return (
          <li
            key={i}
            className="stage-item"
            /* Where this stage sits along the scrub, 0…1. The CSS compares it
               against `--scrub` to decide whether the stage has arrived — one
               declaration for every stage, and no JavaScript that has to know
               how many there are. */
            style={{ "--at": String(i / Math.max(stages.length - 1, 1)) } as React.CSSProperties}
          >
            <div className="stage-rail" aria-hidden>
              <span className="stage-dot" />
            </div>
            <div className="stage-body">
              <span className="num text-micro font-semibold text-[var(--primary-ink)]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2 text-title font-semibold leading-snug">
                {s.title}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </div>
            {/* The diagram is decoration and says so: `aria-hidden` on the svg,
                and the stage's meaning is entirely in the heading and the
                sentence above. A reader using a screen reader loses nothing —
                §1.5's point is that the diagram replaces the sentences a
                SIGHTED reader would have skimmed, not the ones that carry the
                fact. */}
            <div className="stage-figure">
              <Diagram className="h-full w-full" />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
