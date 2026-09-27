/**
 * The call screens' plain helpers (calls audit PR-6): the ring window, the
 * clock, and the noise filter's honest status line. Kept apart from
 * call-parts.tsx so that file exports components only.
 */
import { tr } from "@/lib/i18n";

/** The server's ring window (smartcomm.call.service RING_TIMEOUT_S). */
export const RING_WINDOW_S = 60;

/** 0:07, 12:34. */
export function fmtClock(s: number): string {
  const safe = Math.max(0, Math.floor(s));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function ringingFor(s: number): string {
  return fmtClock(Math.min(RING_WINDOW_S, Math.max(0, s)));
}

/** The honest line for a noise filter that did not load (§4.4, §4.7). */
export function noiseUnavailable(reason: string | null): string {
  if (reason === "no_audio_context" || reason === "worklet_unsupported") {
    return tr("Yard noise filter unavailable on this browser");
  }
  if (reason === "wasm_load_failed") return tr("Yard noise filter could not load");
  return tr("Yard noise filter unavailable");
}
