import { Pill } from "@/components/ui/pill";
import type { CallTranscriptState } from "@/lib/smartcomm-api";
import { stateBadge } from "./call-labels";

/** The record pipeline's state for one call; renders nothing when certified. */
export function CallStatePill({ state }: { state?: CallTranscriptState | null }) {
  const badge = stateBadge(state);
  if (!badge) return null;
  return (
    <Pill tone={badge.tone}>
      <span>{badge.label}</span>
    </Pill>
  );
}
