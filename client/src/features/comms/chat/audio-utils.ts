/**
 * Pure audio helpers, in their own module.
 *
 * Split out of `voice-recorder.tsx` because a file that exports both a
 * component and a plain function breaks Fast Refresh — React cannot tell
 * whether the module's state is safe to preserve, so editing the component
 * reloads the whole tree. It is also where the tests reach for them without
 * mounting a recorder.
 */

/** mm:ss. Not a date — no locale question here, and nothing to format day-first. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Many frames of level → a fixed number of bars.
 *
 * Averaging each bucket rather than sampling it: a clip recorded at 60fps for
 * two minutes is ~7,200 readings, and taking every 150th would render whatever
 * those particular instants happened to be — which for speech is as likely to
 * be a gap between words as a word.
 */
export function downsample(values: number[], buckets: number): number[] {
  if (!values.length) return [];
  if (values.length <= buckets) return values.map((v) => Math.round(v));
  const size = values.length / buckets;
  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const from = Math.floor(i * size);
    const to = Math.max(from + 1, Math.floor((i + 1) * size));
    let sum = 0;
    for (let j = from; j < to; j++) sum += values[j];
    out.push(Math.round(sum / (to - from)));
  }
  return out;
}
