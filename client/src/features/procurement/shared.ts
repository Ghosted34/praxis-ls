/**
 * Procurement — the status→tone map shared by all four screens.
 *
 * Split out of `features/procurement/pages.tsx` in Phase 4 (audit F7). A request,
 * an order, a receipt and a supplier invoice move through the same lifecycle
 * words, so they must render the same colour for the same word.
 */

import { pageShell } from "@/lib/layout";
import { type Tone } from "@/components/ui/pill";

export const shell = pageShell.wide;
export const TONES: Record<string, Tone> = {
  DRAFT: "mute",
  SUBMITTED: "warn",
  APPROVED: "ok",
  REJECTED: "bad",
  ORDERED: "blue",
  APPROVED_LOCKED: "ok",
  ISSUED_LOCKED: "blue",
  RECEIVED: "ok",
  CLOSED: "mute",
  CANCELLED: "bad",
  POSTED_LOCKED: "ok",
  MATCHED: "ok",
  PAID: "ok",
  REVERSED: "bad",
  UNLOCK_REQUESTED: "warn",
  PARTIAL: "warn",
  VALIDATED: "blue",
  PARTIALLY_DISBURSED: "warn",
  DISBURSED: "ok",
  JUSTIFIED: "mute",
};
export const tone = (s?: string | null): Tone =>
  TONES[String(s || "").toUpperCase()] || "mute";
export const map = <T extends Record<string, unknown>>(
  rows: T[] | null,
  id: string,
  name: string,
) => {
  const m: Record<string, string> = {};
  (rows || []).forEach((r) => {
    m[String(r[id])] = String(r[name] ?? "");
  });
  return m;
};
