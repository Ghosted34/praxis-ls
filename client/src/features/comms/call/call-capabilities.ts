/**
 * What the calls UI may offer this person, and who processes call data
 * (calls audit PR-6: F10, G2).
 *
 * Both are read once per session and shared: the phone icon, the Comms hub's
 * "Call audio" tab and the ring's consent line all ask the same question, and
 * a small external store keeps them from each fetching it. A failed read
 * answers "not available", so nothing is offered into a 403.
 */
import * as React from "react";
import { tr, tv } from "@/lib/i18n";
import {
  fetchCallCapabilities,
  fetchCallProcessing,
  type CallCapabilities,
  type CallProcessing,
} from "@/lib/smartcomm-api";

const NONE: CallCapabilities = { calls: false, can_dial: false, recording: false, settings_admin: false };

type Slot<T> = { value: T | null; pending: Promise<void> | null };
const caps: Slot<CallCapabilities> = { value: null, pending: null };
const processing: Slot<CallProcessing> = { value: null, pending: null };
const subs = new Set<() => void>();
const emit = () => subs.forEach((fn) => fn());
function subscribe(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

function load<T>(slot: Slot<T>, read: () => Promise<T>, fallback: T | null) {
  if (slot.value || slot.pending) return;
  slot.pending = read()
    .then((v) => {
      slot.value = v;
    })
    .catch(() => {
      /* @silent:parse — "not available" is the safe answer; the next session asks again. */
      slot.value = fallback;
    })
    .finally(() => {
      slot.pending = null;
      emit();
    });
}

/** Null while loading; then what this person may do with calls. */
export function useCallCapabilities(): CallCapabilities | null {
  const value = React.useSyncExternalStore(subscribe, () => caps.value, () => caps.value);
  React.useEffect(() => load(caps, fetchCallCapabilities, NONE), []);
  return value;
}

/** Who receives call data, read only when there is a recording to disclose. */
export function useCallProcessing(enabled: boolean): CallProcessing | null {
  const value = React.useSyncExternalStore(subscribe, () => processing.value, () => processing.value);
  React.useEffect(() => {
    if (enabled) load(processing, fetchCallProcessing, null);
  }, [enabled]);
  return enabled ? value : null;
}

/** Logout, a tenant switch, and tests. */
export function resetCallCapabilities(): void {
  caps.value = null;
  processing.value = null;
  emit();
}

/**
 * The consent line's processors, in the pipeline's order, in the reader's
 * language: "Audio: Groq, or Google (Gemini) if Groq fails. Summary: Google
 * (Gemini), or DeepSeek as a last resort." Empty when nothing is configured.
 */
export function processorsSentence(p: CallProcessing | null): string {
  if (!p) return "";
  const out: string[] = [];
  const [t1, t2] = p.transcription;
  if (t1) {
    out.push(t2
      ? tv("Audio: {{first}}, or {{second}} if {{first}} fails.", { first: t1.name, second: t2.name })
      : tv("Audio: {{first}}.", { first: t1.name }));
  }
  const [s1, s2] = p.summary;
  if (s1) {
    out.push(s2
      ? tv("Summary: {{first}}, or {{second}} as a last resort.", { first: s1.name, second: s2.name })
      : tv("Summary: {{first}}.", { first: s1.name }));
  }
  if (p.network.length) out.push(tr("Connection set-up: Google (STUN)."));
  return out.join(" ");
}
