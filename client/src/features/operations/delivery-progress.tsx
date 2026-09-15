/**
 * How much of an operations file has actually gone — read back from its notes.
 *
 * ── THE QUESTION NOTHING COULD ANSWER ───────────────────────────────────────
 * A sea file carries twelve containers and they do not clear together. Three
 * notes are raised over three weeks, and the only thing any screen could say
 * about one of them was its own status. "Is this file finished?" meant opening
 * all three and doing the arithmetic on paper — which is how a thirteenth truck
 * gets sent for a box that was signed for last Tuesday.
 *
 * Nothing here is stored. The notes ARE the record; this reads them back
 * (GET /delivery-notes/progress), so there is no second number to drift from
 * the first the moment a note is cancelled.
 *
 * Its own module because the FORM and the 360 both show it: the form so an
 * operator raising a note can see what is left, the 360 so the person looking
 * at one note can see the file it belongs to.
 */
import { tr } from "@/lib/i18n";
import { Panel } from "@/components/ui/panel";
import { MeterGroup } from "@/components/ui/meter";
import { Pill } from "@/components/ui/pill";
import type { Tone } from "@/components/ui/pill";
import * as api from "@/lib/operations-api";

const BOX_TONE: Record<string, Tone> = {
  DELIVERED: "ok",
  IN_TRANSIT: "warn",
  OUTSTANDING: "mute",
};

const BOX_WORD: Record<string, string> = {
  DELIVERED: "Signed for",
  IN_TRANSIT: "Out with a driver",
  OUTSTANDING: "Still to go",
};

/**
 * The file's delivery progress, derived from its notes.
 *
 * ── THE QUESTION NOTHING COULD ANSWER ───────────────────────────────
 * A sea file carries twelve containers and they do not clear together. Three
 * notes are raised over three weeks, and until now the only thing the screen
 * could say about any one of them was its own status. "Is this file finished?"
 * required opening all three notes and doing the arithmetic on paper — which is
 * how a thirteenth truck gets sent for a box that was signed for last Tuesday.
 *
 * Nothing here is stored. The notes ARE the record; this reads them back
 * (GET /delivery-notes/progress) so there is no second number to drift from the
 * first the moment a note is cancelled.
 *
 * It renders NOTHING when the file's service type does not capture containers.
 * A customs-brokerage file is not "0 of 0 delivered" — it has no boxes to count,
 * and a panel saying so is a panel that teaches operators to ignore panels.
 */
export function DeliveryProgressPanel({
  progress: data,
  highlightNoteRef,
}: {
  progress: api.DeliveryProgress | null;
  /** The note being looked at, marked in the box list so "which of these did
   *  THIS note carry" is answered without cross-referencing two lists. */
  highlightNoteRef?: string | null;
}) {
  if (!data) return null;
  if (!data.captures_containers || data.total === 0) return null;

  const { total, delivered, in_transit: inTransit, outstanding, complete } = data;

  return (
    <Panel
      title={tr("Delivery progress")}
      subtitle="Across every live note on this file — counted from the notes themselves."
      action={
        /*
          * "0 still to go" while four boxes are on a truck is the exact
          * sentence that dispatches a second truck for them. When nothing is
          * outstanding but something is moving, the headline is what is moving.
          *
          * Label-then-figure rather than "4 still to go": `tr` translates whole
          * labels, and a sentence assembled from translated fragments comes out
          * in English word order whatever language it is wearing.
          */
        complete ? (
          <Pill tone="ok">{tr("Fully delivered")}</Pill>
        ) : outstanding > 0 ? (
          <Pill tone="warn">{tr(BOX_WORD.OUTSTANDING)}: {outstanding}</Pill>
        ) : (
          <Pill tone="warn">{tr(BOX_WORD.IN_TRANSIT)}: {inTransit}</Pill>
        )
      }
    >
      <div className="space-y-4">
        <MeterGroup
          ariaLabel={`${delivered} of ${total} containers signed for, ${inTransit} out with a driver, ${outstanding} still to go`}
          max={total}
          rows={[
            { label: tr(BOX_WORD.DELIVERED), value: delivered, display: `${delivered} / ${total}`, tone: "ok" },
            { label: tr(BOX_WORD.IN_TRANSIT), value: inTransit, display: String(inTransit), tone: "warn" },
            { label: tr(BOX_WORD.OUTSTANDING), value: outstanding, display: String(outstanding), tone: "neutral" },
          ]}
        />

        {/*
          * Box by box, because the totals are the summary and the dispute is
          * always about one number. `delivered_on_note` is the note somebody
          * signed — it is the answer to "who has it", printed where the question
          * gets asked.
          */}
        {data.boxes.length > 0 && (
          <ul className="grid gap-1 sm:grid-cols-2">
            {data.boxes.map((b) => (
              <li
                key={b.id}
                className={
                  "flex items-center justify-between gap-2 rounded border border-line px-2 py-1 text-sm"
                  + (highlightNoteRef
                    && (b.delivered_on_note === highlightNoteRef || b.issued_on_note === highlightNoteRef)
                    ? " border-primary/60 bg-primary/5"
                    : "")
                }
              >
                <span className="min-w-0 truncate">
                  <span className="num font-medium">{b.container_no || tr("Unnumbered")}</span>
                  {b.container_type_code && (
                    <span className="text-muted"> · {b.container_type_code}</span>
                  )}
                  {(b.delivered_on_note || b.issued_on_note) && (
                    <span className="num text-muted"> · {b.delivered_on_note || b.issued_on_note}</span>
                  )}
                </span>
                <Pill tone={BOX_TONE[b.state] || "mute"}>{tr(BOX_WORD[b.state] || b.state)}</Pill>
              </li>
            ))}
          </ul>
        )}

        {/*
          * The grouped shape (10708): equipment the file states as a quantity
          * because the Bill of Lading has not numbered the boxes yet. It still
          * counts towards the file, split three ways like everything else.
          */}
        {data.groups.length > 0 && (
          <ul className="space-y-1">
            {data.groups.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">
                  {g.qty} × {g.container_type_code || tr("container")}
                  <span className="text-muted"> — {tr("numbers not yet on file")}</span>
                </span>
                {/* Label: figure, joined — never a sentence built out of
                    translated fragments. */}
                <span className="text-muted">
                  {[
                    `${tr(BOX_WORD.DELIVERED)}: ${g.delivered_qty}`,
                    ...(g.in_transit_qty > 0 ? [`${tr(BOX_WORD.IN_TRANSIT)}: ${g.in_transit_qty}`] : []),
                    ...(g.outstanding_qty > 0 ? [`${tr(BOX_WORD.OUTSTANDING)}: ${g.outstanding_qty}`] : []),
                  ].join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
