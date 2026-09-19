/**
 * The operations-file link on a task, as a value (13920; several stages since
 * 13940).
 *
 * Its own module rather than living beside the field that edits it, for the
 * reason `repeat.ts` sits beside `repeat-field.tsx`: a file that exports both
 * a component and a helper defeats fast refresh, so the repo's lint says a
 * `.tsx` exports components and nothing else.
 *
 * ── AN ID AND A SET, AND NO LABEL ───────────────────────────────────────────
 *
 * This used to carry `dossier_ref` and `dossier_client_name` alongside the id,
 * so the form could name the file it had chosen. It no longer does:
 * `OperationsFilePicker` resolves an id to its reference itself. A label held
 * here would be a second copy of something the server already knows, and a
 * second copy is a thing that can be stale — the form would show the
 * reference as it was when the task was written rather than as it is.
 */

export type FileLink = {
  dossier_id: string | null;
  /**
   * The stages of the file's chain the work belongs to — none, one or
   * several, in the order the chain runs. The server projects the first onto
   * 13920's single column, so nothing older than the set loses its stage.
   */
  milestone_instance_ids: string[];
};

export const EMPTY_LINK: FileLink = {
  dossier_id: null,
  milestone_instance_ids: [],
};

/**
 * The link as a task read carries it.
 *
 * Tolerant of a partial row on purpose: the same function seeds the form from
 * an open task, from a parent whose link a child inherits, and from the file's
 * own 360, which supplies an id and nothing else. A row that predates the set
 * (13920's single `milestone_instance_id`) reads as a set of one, so an older
 * payload still round-trips through the form unchanged.
 */
export function linkOf(
  source:
    | {
        dossier_id?: string | null;
        milestone_instance_id?: string | null;
        milestone_instance_ids?: string[] | null;
      }
    | null
    | undefined,
): FileLink {
  if (!source) return EMPTY_LINK;
  const ids = Array.isArray(source.milestone_instance_ids)
    ? source.milestone_instance_ids.filter(Boolean)
    : source.milestone_instance_id
      ? [source.milestone_instance_id]
      : [];
  return {
    dossier_id: source.dossier_id ?? null,
    milestone_instance_ids: [...new Set(ids)],
  };
}

/** Toggle one stage in a set, keeping the set free of duplicates. */
export function toggleStage(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/**
 * "Pre-alert +2" — how a card names a task's stages in one token beside the
 * file's reference. The FIRST stage by name and the rest as a count, because
 * a board card is read in a column at a glance and three stage names would
 * be a paragraph where a token belongs; the hover title and the panel list
 * them all.
 */
export function stageSummary(
  task: { milestone_label?: string | null; milestones?: { label: string | null }[] | null },
): string | null {
  const labels = (task.milestones ?? []).map((m) => m.label).filter((l): l is string => Boolean(l));
  const first = labels[0] ?? task.milestone_label ?? null;
  if (!first) return null;
  const more = labels.length - 1;
  return more > 0 ? `${first} +${more}` : first;
}
