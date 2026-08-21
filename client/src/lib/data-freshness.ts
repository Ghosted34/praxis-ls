/**
 * How old is what this screen is showing?
 *
 * WHAT THIS IS FOR. The rail's refresh control (`app/layout/nav-refresh.tsx`)
 * is drawn as a dial rather than as a plain circular arrow, and this is the
 * quantity the dial reads. A refresh button that looks identical whether the
 * numbers landed two seconds or forty minutes ago answers "can I press this?"
 * and never answers the question the operator actually has, which is "do I need
 * to?". In a system of record that second question is the whole point: a
 * dispatcher looking at a rate they are about to quote wants to know the figure
 * is current before they say it out loud, not after.
 *
 * THE MEASURE IS THE OLDEST ACTIVE QUERY, NOT THE NEWEST. A screen is only as
 * current as its stalest part — a dossier with a fresh header and a forty-
 * minute-old cost roll-up is a forty-minute-old dossier, and reporting the
 * header's age would be a comfortable lie. "Active" means something is mounted
 * and observing it, so a cache entry left warm by a screen the user has since
 * left does not drag the reading down.
 *
 * NO ACTIVE QUERY MEANS NO READING, NOT A ZERO. Settings screens, the styling
 * editor and anything else that fetches nothing have no age to report, and a
 * drained dial there would be pure fiction. `freshnessFrom(null, …)` returns a
 * full ring, and the control's tooltip drops the age line entirely.
 */
import * as React from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

/**
 * How long data takes to drain the dial from full to empty.
 *
 * NOT `staleTime` (30s), and the gap is deliberate. TanStack's staleness is a
 * refetch policy — it answers "may I serve this from cache", and at thirty
 * seconds the ring would visibly empty and refill all day long. That is a tic,
 * and this codebase already refuses tics (see the rail's one-shot hint in
 * `icon-rail.tsx`). Ten minutes is the span over which "how old is this"
 * becomes a question a person actually asks, and it is slow enough that the
 * mark reads as still.
 */
export const DRAIN_MS = 10 * 60_000;

/**
 * How often the dial re-reads the clock.
 *
 * Fifteen seconds is 1/40th of the drain, so a step is a fortieth of a ring —
 * below the threshold anyone notices as movement, which is the point. The dial
 * drifts; it does not animate.
 */
export const SAMPLE_MS = 15_000;

/** The lowest the ring is allowed to draw, as a fraction. Past this the mark
 *  stops reading as a circular arrow at all, and an unrecognisable icon is a
 *  worse outcome than an imprecise one at the far end of a ten-minute scale. */
export const MIN_ARC = 0.08;

/**
 * When did the oldest thing on this screen last land? `null` when the screen
 * is fetching nothing, or when nothing has resolved yet.
 */
export function oldestActiveUpdate(qc: QueryClient): number | null {
  let oldest: number | null = null;
  for (const q of qc.getQueryCache().findAll({ type: "active" })) {
    const at = q.state.dataUpdatedAt;
    // 0 is TanStack's "never resolved" — a query still in flight on first
    // mount. Counting it as an epoch-zero timestamp would report the screen as
    // fifty-six years stale for as long as its first request is open.
    if (!at) continue;
    if (oldest === null || at < oldest) oldest = at;
  }
  return oldest;
}

/** 1 = just landed, 0 = drained. Clamped both ends; `null` reads as full. */
export function freshnessFrom(oldest: number | null, now: number): number {
  if (oldest === null) return 1;
  const age = now - oldest;
  if (age <= 0) return 1;
  if (age >= DRAIN_MS) return 0;
  return 1 - age / DRAIN_MS;
}

export type Freshness = {
  /** 0..1, for the dial. */
  fraction: number;
  /** Age of the oldest active query in ms, or null when there is nothing to
   *  measure. The tooltip's copy, and the reason it can stay silent. */
  ageMs: number | null;
};

/**
 * The reading, sampled on a slow tick.
 *
 * It does NOT subscribe to the query cache. Recomputing on every cache event
 * would mean an O(queries) scan per response on a screen that fires nine of
 * them (`features/finance/hub.tsx`), for a value whose smallest visible step is
 * fifteen seconds wide. The tick is enough — plus `bump()`, which the control
 * calls the moment a refresh it started has settled, because that is the one
 * transition a user is watching for and the only one that must not wait.
 */
export function useDataFreshness(): Freshness & { bump: () => void } {
  const qc = useQueryClient();
  const read = React.useCallback((): Freshness => {
    const oldest = oldestActiveUpdate(qc);
    const now = Date.now();
    return {
      fraction: freshnessFrom(oldest, now),
      ageMs: oldest === null ? null : Math.max(0, now - oldest),
    };
  }, [qc]);

  const [value, setValue] = React.useState<Freshness>(read);
  const bump = React.useCallback(() => setValue(read()), [read]);

  React.useEffect(() => {
    bump();
    const timer = window.setInterval(bump, SAMPLE_MS);
    // A backgrounded tab's timers are throttled to once a minute or worse, so a
    // user returning after lunch would see a ring that is a minute behind the
    // truth for as long as it takes the next tick to fire. Read on the way back
    // in as well; it costs one scan per focus.
    const onVisible = () => {
      if (document.visibilityState === "visible") bump();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [bump]);

  return { ...value, bump };
}
