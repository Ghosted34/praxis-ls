/**
 * The operations-file link on a task — the file, and the stages of its chain
 * the work belongs to (13920; several stages since 13940).
 *
 * ── WHY IT IS A COMPONENT AND NOT TWO FIELDS IN THE DIALOG ─────────────────
 *
 * The two controls are one decision with an order to it: the stage list cannot
 * exist until a file is picked, and unpicking the file has to take the stages
 * with it. Written inline, that coupling is three `useEffect`s in a form that
 * already has eleven pieces of state — and the second entry point (the file's
 * own 360, which opens the dialog pre-linked) would need its own copy.
 *
 * ── THE STAGES ARE DEPENDENT, AND DELIBERATELY SO ──────────────────────────
 *
 * Milestone labels repeat across files: every sea export has a "Customs
 * cleared". A free milestone picker would therefore show forty identical rows
 * and ask the user to know which shipment each belongs to. Listing only the
 * picked file's chain makes every option unambiguous, and it is also the only
 * shape the server accepts — a stage of another file is a 400 naming both.
 *
 * ── WHY CHIPS AND NOT A `<select multiple>` ────────────────────────────────
 *
 * A chain is fourteen stages with an order, and the work usually spans two or
 * three that sit together ("documents verified" and "declaration lodged").
 * A native multi-select hides that order behind a scrolling box and asks for
 * Ctrl-click, which nobody discovers on a phone. The chain laid out as
 * toggleable chips, numbered in its own order, reads the way the file's
 * timeline does: tap the stages the work is on, and what is ticked is visible
 * without opening anything. Each chip is a real checkbox to assistive tech
 * (`role="checkbox"` + `aria-checked`) inside a labelled group.
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
import { Button } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/icons";
import { OperationsFilePicker } from "@/components/operations/file-picker";
import type { PickedFile } from "@/components/operations/file-picker";
import { milestonesByDossier } from "@/lib/operations-api";
import type { MilestoneInstance } from "@/lib/operations-api";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { EMPTY_LINK, toggleStage } from "./file-link";
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
  const picked = value.milestone_instance_ids;

  /*
   * The chain of whichever file is picked. Guarded by a mounted flag rather
   * than left to resolve freely: picking two files quickly is one request per
   * pick, and without the guard the SLOWER one can land last and leave the
   * chips showing another file's stages — a list that looks right and offers
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
        // A file whose chain cannot be read is still a valid link — the stages
        // are optional. Failing the whole field here would block the link over
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
    // A new file means the old file's stages are meaningless, not carried over.
    onChange({ dossier_id: file.dossier_id, milestone_instance_ids: [] });
  }

  const toggle = (id: string) =>
    onChange({ ...value, milestone_instance_ids: toggleStage(picked, id) });

  const pickedCount = picked.length;
  const summary =
    pickedCount === 0
      ? tr("No milestone — the work is on the file as a whole")
      : pickedCount === 1
        ? tr("1 stage selected")
        : tr("{n} stages selected").replace("{n}", String(pickedCount));

  return (
    <>
      {/*
        One control for both states. The picker names the chosen file itself
        from its id, so this does not hand-roll a "chosen" row beside the
        search — which is what let the two drift apart in the first place.
      */}
      <OperationsFilePicker
        id={`${idPrefix}-file`}
        label="Operations file"
        value={dossierId}
        disabled={disabled}
        hint="The work still belongs to whoever it is assigned to — linking it only makes it visible on the file."
        onSelect={pick}
        onClear={() => onChange(EMPTY_LINK)}
      />

      {/* Only once a file is picked, and only when it HAS a chain: a group with
          nothing to tick teaches nothing and takes a row of the form to say it. */}
      {dossierId && (loadingStages || stages.length > 0) && (
        <Field
          label="Milestones"
          hint="Optional — tick every stage of the chain this work belongs to. Leave them all unticked when it is on the file as a whole."
        >
          {/* `Field` clones its single child with the label's id, so this
              wrapper IS the labelled group — every chip inside is a checkbox
              named "Milestones, <stage>" to assistive tech. */}
          <div id={`${idPrefix}-milestones`} role="group" className="space-y-2">
            <div className="chips" aria-busy={loadingStages || undefined}>
              {loadingStages && stages.length === 0 ? (
                <span className="text-xs text-muted-foreground">{tr("Loading milestones…")}</span>
              ) : (
                stages.map((m, i) => {
                  const on = picked.includes(m.milestone_instance_id);
                  const done = String(m.status || "").toUpperCase() === "DONE";
                  return (
                    <button
                      key={m.milestone_instance_id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={disabled}
                      onClick={() => toggle(m.milestone_instance_id)}
                      className={cn(
                        "chip transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                        on && "on",
                        done && !on && "opacity-70",
                      )}
                    >
                      <span className="ct num" aria-hidden>
                        {i + 1}
                      </span>
                      <span className="whitespace-normal text-left">{stageLabel(m)}</span>
                      {on && <CheckIcon className="h-3.5 w-3.5 shrink-0 animate-pop-in" aria-hidden />}
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span aria-live="polite">{summary}</span>
              {pickedCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onChange({ ...value, milestone_instance_ids: [] })}
                >
                  Clear milestones
                </Button>
              )}
            </div>
          </div>
        </Field>
      )}
    </>
  );
}
