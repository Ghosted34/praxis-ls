/**
 * The one-glance answer to "do we actually know where this is?"
 *
 * WHY A BADGE AT ALL. Until now a location on a file was a string, and a string
 * carries no confidence: "Douala" that came from the port catalogue and "Doula"
 * that a geocoder guessed at looked identical on screen, on the map and in the
 * Monday meeting. This is the smallest control that makes the difference visible,
 * and it appears everywhere a place does — the picker's trigger, the detail form,
 * the file header.
 *
 * The four states and their wording live in `place-meta.ts`, which is pure and
 * tested; this file is only the rendering. Tone never carries the meaning on its
 * own (WCAG §1.4.1) — each state ships its own word, and the title attribute
 * explains it in a sentence.
 */
import { Pill, type Tone } from "@/components/ui/pill";
import type { GeoPlace } from "@/lib/operations-api";
import {
  VERIFICATION_COPY,
  verificationOf,
  type VerificationState,
} from "./place-meta";

const TONE: Record<VerificationState, Tone> = {
  verified: "ok",
  reference: "blue",
  unverified: "warn",
  unknown: "mute",
};

export function LocationVerificationBadge({
  state,
  place,
  className,
}: {
  /** Pass a state directly, or a place to read it from. */
  state?: VerificationState;
  place?: GeoPlace | null;
  className?: string;
}) {
  const resolved = state ?? verificationOf(place);
  const copy = VERIFICATION_COPY[resolved];
  return (
    <span title={copy.hint} className={className}>
      <Pill tone={TONE[resolved]}>{copy.label}</Pill>
    </span>
  );
}
