import * as React from "react";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { FormButtons } from "@/components/ui/form-buttons";
import { Modal, Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/insights-api";
import { endOfDayIso, tomorrow } from "./website-insight-dates";

/**
 * The pin dialog. Its date arithmetic lives in website-insight-dates.ts.
 *
 * ── WHY IT IS ITS OWN MODULE ───────────────────────────────────────────────
 *
 * It lived inside `website-insights.tsx`, which meant the ONLY way to put an
 * announcement on the home page was to go back to the list and find the row
 * again. A writer who has just decided — in the editor — that the piece they
 * are writing is an announcement is exactly the person who wants to pin it, and
 * sending them to a list to do it is the same "step that exists only because
 * the code was easier that way" that the create dialog's own comment refuses.
 *
 * So both screens import this one copy. A second implementation of a dialog
 * that writes an expiry to the tenant's front page is a second place for the
 * expiry rules to drift.
 *
 * ── WHY THE EXPIRY IS REQUIRED AND NOT OPTIONAL ────────────────────────────
 *
 * Migration 13784 chose a timestamp over a boolean because "featured" flags go
 * stale in silence: the JCTrans membership pinned in March is still on the
 * front page in November, and nobody notices because nobody reads their own
 * homepage. A dialog that let the date be left empty would put the boolean
 * straight back — so there is no "pin indefinitely", and the field defaults to
 * a month out rather than to nothing.
 *
 * ── NO NATIVE DIALOG ANYWHERE NEAR THIS ────────────────────────────────────
 *
 * Unpinning is a real removal and the obvious shape for it is a `confirm()`.
 * CLAUDE.md bans it outright — it renders in OS chrome that discards the
 * tenant's white-label branding, its buttons say OK and Cancel rather than
 * naming the action, and it cannot be translated. It is a second button in this
 * dialog instead, which names what it does.
 */

export function PinDialog({
  row,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  row: api.InsightArticle;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (pinnedUntil: string | null) => void;
}) {
  const pinned = api.isPinned(row);
  const [day, setDay] = React.useState(() =>
    pinned && row.pinned_until
      ? String(row.pinned_until).slice(0, 10)
      : new Date(Date.now() + 86400e3 * 30).toISOString().slice(0, 10),
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={pinned ? tr("Change how long this stays up") : tr("Pin to the home page")}
      description="Pinned announcements appear in the band under your hero, newest expiry first. At most five show at once."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(endOfDayIso(day));
        }}
      >
        <p className="text-sm text-muted-foreground">{row.title_fr}</p>
        <Field
          label={tr("Show it until")}
          required
          hint="It comes off the home page on its own after this date. It stays published at its own address."
        >
          <DateField
            min={tomorrow()}
            value={day}
            onChange={setDay}
          />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Not a confirm() — see the note above. */}
          {pinned ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onSubmit(null)}
            >
              {tr("Take it off the home page")}
            </Button>
          ) : (
            <span />
          )}
          <FormButtons
            busy={busy}
            disabled={busy || !day}
            onCancel={onClose}
            saveLabel={pinned ? tr("Update") : tr("Pin it")}
          />
        </div>
      </form>
    </Modal>
  );
}
