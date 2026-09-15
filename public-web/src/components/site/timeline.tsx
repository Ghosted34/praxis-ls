import * as React from "react";
import { useTranslation } from "react-i18next";
import { useScrollScrub } from "@/lib/motion";
import type { TimelineEntry } from "@/lib/site-api";

/**
 * The timeline — guide §9.1: "scroll-scrubbed: **time as depth**."
 *
 * ── WHAT "TIME AS DEPTH" MEANS HERE, AND WHAT IT DOES NOT ─────────────────
 *
 * It does not mean a z-axis. It means the reader's own scroll IS the passage of
 * time: a single spine fills as the page moves, and each year arrives when the
 * fill reaches it. So the reader is not watching a list animate — they are
 * moving through the company's history at their own pace, and the depth cue is
 * that earlier years sit further back in the scroll than later ones.
 *
 * The mechanism is `--scrub` written by the shared loop in `lib/motion.ts` — one
 * scroll listener and one `requestAnimationFrame` for every subscriber on the
 * page, layout read once per frame and written once. Each entry declares its
 * own `--at` (its position along the spine) and CSS does the rest, so the
 * arithmetic is one custom property per element and there is no per-frame React
 * work at all.
 *
 * ── THE SETTLED STATE IS THE DESIGNED ONE ─────────────────────────────────
 *
 * §1.2 rule 1 binds without exception: `prefers-reduced-motion` renders the
 * SETTLED state, not a faster animation. `useScrollScrub` writes `settled` (1)
 * once and attaches no listener in that case, so a reduced-motion visitor gets
 * the spine drawn full height with every entry at full opacity — the complete
 * composition, arrived at instantly.
 *
 * Every `var(--scrub, …)` below falls back to 1 for the same reason PR 3 gives
 * in the ESG panel: before the hook mounts, and for a visitor whose JavaScript
 * fails after paint, the timeline must render FINISHED rather than blank.
 *
 * ── AND THE LAST ENTRY IS NOT PERMANENTLY DIMMED ──────────────────────────
 *
 * F-24's neighbour, and PR 4 paid for this one in the ESG triptych: if the
 * thresholds spread all the way to 1, then at `--scrub: 1` — the settled state,
 * and what every reduced-motion visitor sees — the final entry sits at less
 * than full opacity forever. So the last `--at` is capped at `1 − FADE`, and
 * the test pins the arithmetic rather than the number.
 */

/** How far past its own threshold the scrub must travel before an entry is
 *  fully arrived. */
export const ENTRY_FADE = 0.14;

/** The last entry's threshold. Capped so `--scrub: 1` finishes it — see the
 *  header. */
export const ENTRY_LAST_AT = 1 - ENTRY_FADE;

/** One entry's position along the spine. Exported for the test that pins the
 *  arithmetic. */
export function entryAt(index: number, total: number): number {
  const first = 0.05;
  const span = ENTRY_LAST_AT - first;
  return first + (span * index) / Math.max(total - 1, 1);
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  const { t } = useTranslation();
  /* ── THE RANGE IS NARROWED, AND THE DEFAULT WAS A REAL DEFECT ──────────
   *
   * `useScrollScrub()`'s default is `start: 1, end: 0` — "begins when the
   * element's top touches the bottom of the screen, ends when its bottom leaves
   * the top". That reads like the obvious choice for a timeline and it is
   * wrong, because the LAST entry's threshold is near the end of the scrub: it
   * only reaches full opacity once the band has scrolled off the top of the
   * screen. Measured on the built page, the 2026 entry arrived at scrollY 2227
   * on a band whose bottom left the viewport at 2227. Nobody ever saw it.
   *
   * This is PR 4's ESG annotation defect in a new shape — a threshold that is
   * only satisfied in a state the reader is never in — and, like that one, no
   * unit test could catch it: the arithmetic is correct, the geometry is not.
   * It was found by scrolling the real page and reading computed opacity.
   *
   * `0.9 → 0.45` is the range `esg-triptych.tsx` already uses, and taking the
   * same numbers rather than inventing a third is §9.6's "one motion vocabulary
   * across all routes" doing actual work. It completes when the element's
   * bottom sits at 45% of the viewport height, so the last entry is fully
   * arrived while the whole band is still comfortably on screen. */
  const ref = useScrollScrub<HTMLDivElement>({ start: 0.9, end: 0.45 });

  if (!entries.length) return null;

  return (
    <div ref={ref} className="timeline">
      {/* The spine. `aria-hidden` because it is the drawing of the list, and
          the list below is real text a screen reader reads in order — which is
          already chronological, so nothing is lost by not describing a line. */}
      <div aria-hidden className="timeline-spine">
        <span className="timeline-spine-fill" />
      </div>

      <ol className="timeline-list">
        {entries.map((entry, i) => (
          <li
            key={`${entry.year}-${i}`}
            className="timeline-entry"
            style={{ "--at": entryAt(i, entries.length).toFixed(3) } as React.CSSProperties}
          >
            {/* The year is the heading of its own moment, in the mono face —
                it is a number the eye scans down the spine, not prose. */}
            <p className="timeline-year">
              <span className="sr-only">{t("site.about.timelineYear")} </span>
              {entry.year}
            </p>
            <div className="timeline-body">
              {entry.label ? <h3 className="timeline-label">{entry.label}</h3> : null}
              {entry.text ? <p className="timeline-text">{entry.text}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
