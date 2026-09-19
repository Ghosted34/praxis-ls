/**
 * The operations-file link on a task, as a value (13920).
 *
 * Its own module rather than living beside the field that edits it, for the
 * reason `repeat.ts` sits beside `repeat-field.tsx`: a file that exports both
 * a component and a helper defeats fast refresh, so the repo's lint says a
 * `.tsx` exports components and nothing else.
 *
 * ── TWO IDS, AND NO LABEL ───────────────────────────────────────────────────
 *
 * This used to carry `dossier_ref` and `dossier_client_name` alongside the id,
 * so the form could name the file it had chosen. It no longer does:
 * `OperationsFilePicker` resolves an id to its reference itself (13930). A
 * label held here would be a second copy of something the server already
 * knows, and a second copy is a thing that can be stale — the form would show
 * the reference as it was when the task was written rather than as it is.
 */

export type FileLink = {
  dossier_id: string | null;
  milestone_instance_id: string | null;
};

export const EMPTY_LINK: FileLink = {
  dossier_id: null,
  milestone_instance_id: null,
};

/**
 * The link as a task read carries it.
 *
 * Tolerant of a partial row on purpose: the same function seeds the form from
 * an open task, from a parent whose link a child inherits, and from the file's
 * own 360, which supplies an id and nothing else.
 */
export function linkOf(
  source:
    | { dossier_id?: string | null; milestone_instance_id?: string | null }
    | null
    | undefined,
): FileLink {
  if (!source) return EMPTY_LINK;
  return {
    dossier_id: source.dossier_id ?? null,
    milestone_instance_id: source.milestone_instance_id ?? null,
  };
}
