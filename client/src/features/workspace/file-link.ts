/**
 * The operations-file link on a task, as a value (13900).
 *
 * Its own module rather than living beside the field that edits it, for the
 * reason `repeat.ts` sits beside `repeat-field.tsx`: a file that exports both
 * a component and a helper defeats fast refresh, so the repo's lint says a
 * `.tsx` exports components and nothing else. The split is also the honest
 * one — this shape is what a task carries and what a form posts, and three
 * screens read it without rendering the picker.
 */

export type FileLink = {
  dossier_id: string | null;
  /** Held beside the id so a picked file reads as a reference, not a uuid. */
  dossier_ref: string | null;
  dossier_client_name: string | null;
  milestone_instance_id: string | null;
};

export const EMPTY_LINK: FileLink = {
  dossier_id: null,
  dossier_ref: null,
  dossier_client_name: null,
  milestone_instance_id: null,
};

/**
 * The link as a task read carries it.
 *
 * Tolerant of a partial row on purpose: the same function seeds the form from
 * an open task, from a parent whose link a child inherits, and from the file's
 * own 360, which supplies a reference and a client and no stage.
 */
export function linkOf(
  source:
    | {
        dossier_id?: string | null;
        dossier_ref?: string | null;
        dossier_client_name?: string | null;
        milestone_instance_id?: string | null;
      }
    | null
    | undefined,
): FileLink {
  if (!source) return EMPTY_LINK;
  return {
    dossier_id: source.dossier_id ?? null,
    dossier_ref: source.dossier_ref ?? null,
    dossier_client_name: source.dossier_client_name ?? null,
    milestone_instance_id: source.milestone_instance_id ?? null,
  };
}
