/**
 * The option list behind a SELECT field — Incoterms, customs regimes, weight
 * units, bonded status, charging basis.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * These lists were seeded once (9092) and there was no way to change them without
 * a migration. The Details tab could rename a field, retag its meaning, mark it
 * required and retire it — but not touch the eleven values the dropdown actually
 * offers. So "we need DDP added" or "we don't use EX2" was a code change, which
 * for reference data that a customs department revises is the wrong shape
 * entirely.
 *
 * It also closed a hole in the tab beside it: `NewFieldForm` offered `SELECT` in
 * its type list and sent no options, and the server refuses a SELECT with an empty
 * list — so adding one always 422'd. A new SELECT now collects its options here
 * before it is created.
 *
 * ── WHAT A VALUE IS, AND WHY IT IS NOT THE LABEL ────────────────────────────
 *
 * `value` is what gets STORED on every file, cited by every document and grouped
 * by in every report. `label_fr`/`label_en` are what a person reads. They are
 * separate because a label is translated and rewritten, and a stored code must
 * not be: renaming "IM4 — Home use" to "IM4 — Mise à la consommation" must not
 * silently orphan four years of files filed under the old string.
 *
 * That is also why an existing value is EDITABLE BUT WARNED ABOUT rather than
 * frozen. Freezing it would mean a typo in a seeded code could never be corrected;
 * leaving it silent would mean a rename looks free. The warning names the
 * consequence and the operator decides.
 *
 * ── VERSIONING ──────────────────────────────────────────────────────────────
 *
 * Nothing here writes to a published form. On a live version the dialog is a
 * read-only list, which is worth having on its own — "what regimes does this
 * service actually offer?" is a question people ask far more often than they
 * change the answer.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import type { FieldOption } from "@/lib/operations-api";
import {
  nextKey,
  optionProblems,
  toDraft,
  toWireOptions,
  type DraftOption,
} from "./field-options";

export function FieldOptionsDialog({
  open,
  onClose,
  onSave,
  fieldLabel,
  fieldKey,
  options,
  editable,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  /** Commits the list. Not called when the version is live. */
  onSave: (options: FieldOption[]) => void;
  fieldLabel: string;
  fieldKey: string;
  options: FieldOption[];
  /** False on a published version — the dialog becomes a read-only list. */
  editable: boolean;
  busy?: boolean;
}) {
  const [rows, setRows] = React.useState<DraftOption[]>(() => toDraft(options));

  // Reset whenever it opens, so cancelling really discards and reopening does not
  // resume somebody else's half-finished edit.
  React.useEffect(() => {
    if (!open) return;
    setRows(toDraft(options));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const wire = toWireOptions(rows);
  const problems = optionProblems(wire);

  /** A row that existed when the dialog opened and whose value has since changed.
   *  Those are the ones that orphan stored data. */
  const changedValues = rows.filter(
    (r) =>
      r._original !== undefined && r._original !== String(r.value || "").trim(),
  );

  const patch = (i: number, next: Partial<DraftOption>) =>
    setRows((s) => s.map((r, j) => (j === i ? { ...r, ...next } : r)));

  const move = (i: number, delta: number) =>
    setRows((s) => {
      const j = i + delta;
      if (j < 0 || j >= s.length) return s;
      const out = [...s];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={`Options — ${fieldLabel}`}
      description={
        editable
          ? "The value is stored on every file and printed on every document. The labels are what people read."
          : "This version is live, so the list is read-only. Create a new version to change it."
      }
      footer={
        editable ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              loading={busy}
              disabled={problems.length > 0 || busy}
              onClick={() => onSave(wire)}
            >
              Save {wire.length} option{wire.length === 1 ? "" : "s"}
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="space-y-3">
        <p className="micro text-muted-foreground">
          Field key <span className="num font-semibold">{fieldKey}</span>. Order
          is the order the dropdown shows them in.
        </p>

        {!rows.length && (
          <p className="text-sm text-muted-foreground">No options yet.</p>
        )}

        {rows.length > 0 && (
          <ul className="m-0 list-none space-y-2 p-0">
            {rows.map((row, i) => (
              <li key={row._key}>
                {/*
                  The group is an inner DIV, not the <li> itself. `role="group"` is
                  not an allowed role on a list item — it takes the element out of
                  the list, so the <ul> is left with children that are not listitems
                  and axe fails it (aria-allowed-role). The row still names itself,
                  which is the point: three inputs each labelled only "Value",
                  "Label (English)", "Label (French)", eleven times over, gives a
                  screen-reader user no way to know WHICH option they are editing.
                */}
                <div
                  role="group"
                  aria-label={`Option ${i + 1}${row.value ? `: ${row.value}` : ""}`}
                  className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-12"
                >
                  <div className="sm:col-span-2">
                    <label
                      className="micro block text-muted-foreground"
                      htmlFor={`${row._key}-value`}
                    >
                      Value
                    </label>
                    <Input
                      id={`${row._key}-value`}
                      className="num"
                      value={row.value}
                      disabled={!editable || busy}
                      placeholder="FOB"
                      onChange={(e) =>
                        patch(i, { value: e.target.value.toUpperCase() })
                      }
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label
                      className="micro block text-muted-foreground"
                      htmlFor={`${row._key}-en`}
                    >
                      Label (English)
                    </label>
                    <Input
                      id={`${row._key}-en`}
                      value={row.label_en || ""}
                      disabled={!editable || busy}
                      placeholder="FOB — Free On Board"
                      onChange={(e) => patch(i, { label_en: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label
                      className="micro block text-muted-foreground"
                      htmlFor={`${row._key}-fr`}
                    >
                      Label (French)
                    </label>
                    <Input
                      id={`${row._key}-fr`}
                      value={row.label_fr || ""}
                      disabled={!editable || busy}
                      placeholder="FOB — Franco à bord"
                      onChange={(e) => patch(i, { label_fr: e.target.value })}
                    />
                  </div>
                  {editable && (
                    <div className="flex items-end gap-1 sm:col-span-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Move ${row.value || `option ${i + 1}`} up`}
                        disabled={i === 0 || busy}
                        onClick={() => move(i, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Move ${row.value || `option ${i + 1}`} down`}
                        disabled={i === rows.length - 1 || busy}
                        onClick={() => move(i, 1)}
                      >
                        ↓
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${row.value || `option ${i + 1}`}`}
                        disabled={busy}
                        onClick={() =>
                          setRows((s) => s.filter((_, j) => j !== i))
                        }
                      >
                        ✕
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {editable && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              setRows((s) => [
                ...s,
                { value: "", label_fr: "", label_en: "", _key: nextKey() },
              ])
            }
          >
            ＋ Add an option
          </Button>
        )}

        {/*
          Renaming a value is allowed and is called out, in that order. Freezing it
          would mean a typo in a seeded code could never be corrected; saying
          nothing would make a rename look free, when in fact every file already
          filed under the old code keeps it and stops matching this list.
        */}
        {editable && changedValues.length > 0 && (
          <Callout tone="warn" title="You are changing a stored value">
            Files already filed under{" "}
            {changedValues.map((r) => (
              <Pill key={r._key} tone="mute">
                {r._original}
              </Pill>
            ))}{" "}
            keep that code and will no longer match this list. Renaming a LABEL
            is always safe; renaming a value is not. Add a new option and retire
            the old one if both need to exist.
          </Callout>
        )}

        {editable && problems.length > 0 && (
          <Callout tone="bad" title="Not saveable yet">
            <ul className="m-0 list-disc space-y-1 pl-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Callout>
        )}
      </div>
    </Dialog>
  );
}
