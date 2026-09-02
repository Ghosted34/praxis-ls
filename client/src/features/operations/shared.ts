/**
 * Small shared pieces for the Operations screens.
 *
 * Pure helpers only — no React. The components that use them live in
 * `./components`, so a screen importing a formatter does not pull in JSX.
 *
 * Extracted in Phase 3 when `features/operations/pages.tsx` (928 lines, four
 * exported screens, a 200-line 360° modal and its five private sub-blocks) was
 * split one screen per file (audit F7 — 17 files over 400 lines, nothing inside
 * them reachable, testable or reusable from elsewhere).
 */
import type { Tone } from "@/components/ui/pill";
import type * as api from "@/lib/operations-api";

/**
 * Status → tone for the Operations vocabulary.
 *
 * Module-specific on purpose. `pill.statusTone` maps the generic lifecycle
 * words and would call OPEN "blue" everywhere; here OPEN is the start of an
 * operations file's life and IN_PROGRESS is the state that wants attention,
 * which is a different reading of the same tokens.
 */
const TONES: Record<string, Tone> = {
  OPEN: "blue",
  IN_PROGRESS: "warn",
  COMPLETED: "ok",
  CANCELLED: "bad",
  PENDING: "warn",
  DONE: "ok",
  DRAFT: "mute",
  SUBMITTED: "blue",
  CLEARED: "ok",
  DELIVERED: "ok",
};

export const tone = (s?: string | null): Tone =>
  TONES[String(s || "").toUpperCase()] || "mute";

/** "SEA_FREIGHT_IMPORT" → "Sea freight import". */
export const humanizeKey = (k?: string | null): string => {
  if (!k) return "—";
  const s = String(k).replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** id → name lookup from a list payload. */
export const nameMap = <T extends Record<string, unknown>>(
  rows: T[] | null,
  idKey: string,
  nameKey: string,
) => {
  const m: Record<string, string> = {};
  (rows || []).forEach((r) => {
    m[String(r[idKey])] = String(r[nameKey] ?? "");
  });
  return m;
};

/*
 * The three formatters below take STRUCTURAL subsets rather than `api.Dossier`.
 *
 * They are called with two different shapes now: the list row, and the 360's
 * own header (`DossierOverview["dossier"]`), which carries the same display
 * fields but is not the same type. Narrowing the parameter to the fields each
 * one actually reads lets both pass without a cast, and documents in the
 * signature what a caller has to supply.
 */
type ServiceNamed = Pick<
  api.Dossier,
  "service_key" | "service_name_en" | "service_name_fr"
>;
type Routed = Pick<api.Dossier, "pol" | "pod">;
type MilestoneCounted = Pick<api.Dossier, "milestone_total" | "milestone_done">;

/** Service label for an operations file, preferring the joined service-type name. */
export const serviceLabel = (r: ServiceNamed): string =>
  r.service_name_en || r.service_name_fr || humanizeKey(r.service_key);

/** "Shanghai → Douala", or an em dash when neither end is recorded. */
export const routeLabel = (r: Routed): string =>
  r.pol || r.pod ? `${r.pol || "?"} → ${r.pod || "?"}` : "—";

/** A file's milestone completion, 0-100. */
export const milestonePct = (r: MilestoneCounted): number =>
  r.milestone_total
    ? Math.round((100 * (r.milestone_done || 0)) / r.milestone_total)
    : 0;
