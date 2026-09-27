/**
 * A tapped Answer or Decline that has to survive the app booting (calls audit
 * A8, PR-4 step 7).
 *
 * The service worker can only open a URL (`/comms?ring=<id>&act=accept`).
 * Signed out, the login redirect keeps the path and drops the query, so the
 * intent is lifted out of the URL before React renders and kept in
 * sessionStorage (this tab's boot only, never replayed tomorrow). The session
 * takes it once the user is signed in. A ring is over within a minute, so an
 * intent older than INTENT_TTL_MS is dropped rather than acted on.
 */
import { parseCallLink } from "./ring-surface";

const KEY = "praxis.call-intent";
export const INTENT_TTL_MS = 90_000;

export type CallIntent = { callId: string; action: "accept" | "decline" | null; at: number };

/** At boot: keep the ring link in this URL, if there is one. */
export function captureCallIntent(search: string, now = Date.now()): void {
  const link = parseCallLink(search);
  if (!link) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...link, at: now }));
  } catch {
    /* @silent:storage — private mode: the URL itself still carries the intent
       when no login redirect is in the way. */
  }
}

/** Read and clear the kept intent; null when there is none or it is stale. */
export function takeCallIntent(now = Date.now()): CallIntent | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
    if (raw) sessionStorage.removeItem(KEY);
  } catch {
    /* @silent:storage — nothing kept is the same as no intent. */
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CallIntent;
    if (!parsed || typeof parsed.callId !== "string" || !Number.isFinite(parsed.at)) return null;
    if (now - parsed.at > INTENT_TTL_MS) return null;
    const action = parsed.action === "accept" || parsed.action === "decline" ? parsed.action : null;
    return { callId: parsed.callId, action, at: parsed.at };
  } catch {
    /* @silent:parse — a value we did not write is not an intent. */
    return null;
  }
}
