/**
 * The operations-file link on a task — the file, and optionally the stage of
 * its chain (13900).
 *
 * ── WHY IT IS A COMPONENT AND NOT TWO FIELDS IN THE DIALOG ─────────────────
 *
 * The two controls are one decision with an order to it: the stage list cannot
 * exist until a file is picked, and unpicking the file has to take the stage
 * with it. Written inline, that coupling is three `useEffect`s in a form that
 * already has eleven pieces of state — and the second entry point (the file's
 * own 360, which opens the dialog pre-linked) would need its own copy.
 *
 * ── THE STAGE IS DEPENDENT, AND DELIBERATELY SO ────────────────────────────
 *
 * Milestone labels repeat across files: every sea export has a "Customs
 * cleared". A free milestone picker would therefore show forty identical rows
 * and ask the user to know which shipment each belongs to. Listing only the
 * picked file's chain makes every option unambiguous, and it is also the only
 * shape the server accepts — a stage of another file is a 400 naming both.
 *
 * ── WHAT THIS LINK DOES NOT DO ─────────────────────────────────────────────
 *
 * It never moves the milestone. Ticking off every task on a stage leaves the
 * chain exactly where it was, because a milestone is what the company promised
 * a client and a personal to-do must not be able to advance it. The link buys
 * visibility — the file's Tasks tab, the Analytics rollup — and nothing else.
 */
import * as React from "react";
import { Field } from "@/components/ui/modal";
import { NativeSelect } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { OperationsFilePicker } from "@/components/operations/file-picker";
import type { PickedFile } from "@/components/operations/file-picker";
import { milestonesByDossier } from "@/lib/operations-api";
import type { MilestoneInstance } from "@/lib/operations-api";
import { tr } from "@/lib/i18n";
import { EMPTY_LINK } from "./file-link";
import type { FileLink } from "./file-link";

const stageLabel = (m: MilestoneInstance) =>
  m.label_en || m.label || m.label_fr || m.code || tr("Unnamed stage");

export function FileLinkField({
  value,
  onChange,
  idPrefix = "task",
  disabled,
}: {
  value: FileLink;
  onChange: (next: FileLink) => void;
  idPrefix?: string;
  disabled?: boolean;
}) {
  const [stages, setStages] = React.useState<MilestoneInstance[]>([]);
  const [loadingStages, setLoadingStages] = React.useState(false);
  const dossierId = value.dossier_id;

  /*
   * The chain of whichever file is picked. Guarded by a mounted flag rather
   * than left to resolve freely: picking two files quickly is one request per
   * pick, and without the guard the SLOWER one can land last and leave the
   * select showing another file's stages — a list that looks right and offers
   * options the server will refuse.
   */
  React.useEffect(() => {
    if (!dossierId) {
      setStages([]);
      return undefined;
    }
    let alive = true;
    setLoadingStages(true);
    milestonesByDossier(dossierId)
      .then((rows) => {
        if (alive) setStages(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        // A file whose chain cannot be read is still a valid link — the stage
        // is optional. Failing the whole field here would block the link over
        // the part of it nobody is required to fill in.
        if (alive) setStages([]);
      })
      .finally(() => {
        if (alive) setLoadingStages(false);
      });
    return () => {
      alive = false;
    };
  }, [dossierId]);

  function pick(file: PickedFile) {
    onChange({
      dossier_id: file.dossier_id,
      dossier_ref: file.ref,
      dossier_client_name: file.client_name ?? null,
      // A new file means the old file's stage is meaningless, not carried over.
      milestone_instance_id: null,
    });
  }

  return (
    <>
      {dossierId ? (
        <Field
          label="Operations file"
          htmlFor={`${idPrefix}-file`}
          hint="The work still belongs to whoever it is assigned to — linking it only makes it visible on the file."
        >
          <div
            id={`${idPrefix}-file`}
            className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <span className="min-w-0 truncate">
              <span className="num font-medium">{value.dossier_ref || tr("Linked file")}</span>
              {value.dossier_client_name && (
                <span className="text-muted-foreground"> · {value.dossier_client_name}</span>
              )}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onChange(EMPTY_LINK)}
            >
              Clear
            </Button>
          </div>
        </Field>
      ) : (
        <OperationsFilePicker
          id={`${idPrefix}-file`}
          label="Operations file"
          placeholder={tr("Search by reference, client, B/L or AWB…")}
          disabled={disabled}
          onSelect={pick}
        />
      )}

      {/* Only once a file is picked, and only when it HAS a chain: a select
          whose sole option is "No milestone" teaches nothing and takes a row
          of the form to say it. */}
      {dossierId && (loadingStages || stages.length > 0) && (
        <Field
          label="Milestone"
          htmlFor={`${idPrefix}-milestone`}
          hint="Optional — leave it on “No milestone” when the work is on the file as a whole."
        >
          <NativeSelect
            id={`${idPrefix}-milestone`}
            value={value.milestone_instance_id || ""}
            disabled={disabled || loadingStages}
            onChange={(e) =>
              onChange({ ...value, milestone_instance_id: e.target.value || null })
            }
          >
            <option value="">
              {loadingStages ? tr("Loading milestones…") : tr("No milestone")}
            </option>
            {stages.map((m) => (
              <option key={m.milestone_instance_id} value={m.milestone_instance_id}>
                {stageLabel(m)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
    </>
  );
}
