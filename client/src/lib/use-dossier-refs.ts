/**
 * Name an operations file from its id — the read half of the picker (13930).
 *
 * ── THE BUG THIS ENDS ───────────────────────────────────────────────────────
 *
 * A dozen screens held a `dossier_id` and needed to show a reference for it.
 * Every one of them did the same thing: `useList("/operations")`, build a
 * `Map` from the result, look the id up. That endpoint's `page()` clamps to 50
 * rows, so a file past the fiftieth was not in the map and the screen rendered
 * a raw uuid — on a delivery-note register, a transit-order list, a margin
 * simulation, a proforma. It is the display-side twin of the picker bug: the
 * same clamp, the same silence, a different symptom.
 *
 * ── HOW THIS IS DIFFERENT ───────────────────────────────────────────────────
 *
 * It asks for the ids it actually needs (`/operations?ids=…`) instead of the
 * first page and a hope. A table shows at most one page of rows, so the id set
 * is bounded by the page — and the server caps it at 200 regardless.
 *
 * It is a `useList` underneath, so TanStack Query caches and deduplicates by
 * path: a screen with a table and three pickers all naming the same files
 * makes ONE request, and re-renders cost nothing. The ids are sorted into the
 * key so two callers holding the same set in a different order share it.
 *
 * ── WHY IT RETURNS ROWS AND NOT STRINGS ─────────────────────────────────────
 *
 * Callers want different parts — the register wants `ref`, a header wants
 * `ref · client`, the picker wants both plus the title. Returning the row lets
 * each take what it needs from one request rather than adding a hook per
 * field.
 */
import * as React from "react";
import { useList } from "@/lib/use-resource";
import type { Dossier } from "@/lib/operations-api";

/** Matches the server's own guard — anything else it would drop anyway. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The server's ceiling on one `ids=` lookup (operations_file.repo.MAX_IDS). */
export const MAX_DOSSIER_IDS = 200;

/**
 * Resolve many ids at once.
 *
 * @returns a Map keyed by dossier_id. Absent ids simply have no entry — a file
 *   that was deleted, or that this reader may not see, is not an error and the
 *   caller decides what to render for it.
 */
export function useDossierRefs(ids: ReadonlyArray<string | null | undefined>) {
  // Sorted + de-duplicated so the query key is stable across render order,
  // which is what lets two callers with the same set share one request.
  const key = React.useMemo(() => {
    const clean = [...new Set(ids.filter((v): v is string => !!v && UUID_RE.test(v)))].sort();
    return clean.slice(0, MAX_DOSSIER_IDS);
  }, [ids]);

  const path = key.length
    ? `/operations?ids=${encodeURIComponent(key.join(","))}&limit=${key.length}`
    : null;
  const { rows, loading, error } = useList<Dossier>(path);

  const byId = React.useMemo(() => {
    const m = new Map<string, Dossier>();
    for (const row of rows || []) m.set(String(row.dossier_id), row);
    return m;
  }, [rows]);

  return { byId, loading: key.length > 0 && loading, error };
}

/** One id. The same cache as `useDossierRefs`, so it costs nothing extra. */
export function useDossierRef(id: string | null | undefined) {
  const ids = React.useMemo(() => [id], [id]);
  const { byId, loading, error } = useDossierRefs(ids);
  return { file: id ? byId.get(id) || null : null, loading, error };
}

/** `ref`, or a sentence when the file cannot be named. Never a raw uuid. */
export function refOf(file: Dossier | null | undefined, fallback = "—") {
  const ref = file?.ref;
  return ref ? String(ref) : fallback;
}
