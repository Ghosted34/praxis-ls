/**
 * Delivery notes — proof that goods reached the consignee, and who signed.
 *
 * ── WHAT THIS SCREEN REPLACED ───────────────────────────────────────────────
 *
 * The legacy screen (`view/operations/delivery-note.php`) printed a document
 * with a "Received By (Client) — Name, Signature & Stamp" box on it, and then
 * threw that box away: nothing in the system ever recorded what the client
 * wrote there. A delivery note that cannot say who accepted the goods is not
 * evidence, it is stationery. The DELIVERED step is this screen's reason to
 * exist.
 *
 * Carried forward from legacy, because it was right:
 *   · the file search — pick the operations file and the consignee, address and
 *     containers fill themselves in. The operator makes decisions; they do not
 *     retype facts the system holds.
 *   · the container manifest as a first-class part of the document.
 *   · the reservations box, printed empty so it can be filled in at the gate.
 *
 * NOT carried forward:
 *   · the container PASTE BOX. Legacy stored the manifest as free text split on
 *     commas at print time, so the note and the file could disagree about what
 *     shipped and nothing reconciled them. The picker below reads the file's
 *     actual containers; ticking one snapshots its number and seal onto the
 *     note, so a later correction to the file cannot rewrite a signed document.
 *     A hand-typed box is still allowed — that happens — but it is the
 *     exception, not the input method.
 *   · numbering on page load. Legacy allocated MAX(seq)+1 on the first save AND
 *     on every save after it (create.php ignores the number the form sends
 *     back), so editing a typo silently orphaned the old number. The number
 *     appears here only at ISSUE, once.
 *
 * The buttons bind to `allowed_transitions` from the server, so a control can
 * never exist for a transition the API would refuse.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { DateField } from "@/components/ui/date-field";
import { FormButtons } from "@/components/ui/form-buttons";
import { ErrorState } from "@/components/ui/states";
import { Callout } from "@/components/ui/callout";
import { Panel } from "@/components/ui/panel";
import { DocButton } from "@/components/doc-button";
import { InventoryItemSelect } from "@/components/catalogue-select";
import { PlacePicker } from "@/components/operations/place-picker";
import { OperationsFilePicker } from "@/components/operations/file-picker";
import { ListPage } from "@/components/list-page";
import type { Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { MeterGroup } from "@/components/ui/meter";
import { Pill } from "@/components/ui/pill";
import type { Tone } from "@/components/ui/pill";
import { ScreenAi } from "@/components/screen-ai";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { XIcon } from "@/components/ui/icons";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { num, dateFmt } from "@/lib/format";
import { useCanUseModule } from "@/lib/route-access";
import * as api from "@/lib/operations-api";
import {
  SendForSignatureModal,
  SignatureChainOnRecord,
  SignDocumentModal,
  SignaturesOnRecord,
} from "@/features/vault/sign-document";
import { ShipmentDetailsPanel } from "./shipment-details";
import { nameMap } from "./shared";

/**
 * Lifecycle tones. ISSUED is `warn` — goods are out and nobody has signed yet,
 * which is an open obligation rather than a neutral fact. DELIVERED is the
 * successful end of the road.
 */
const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "mute",
  ISSUED: "warn",
  DELIVERED: "ok",
  CANCELLED: "bad",
};

/**
 * A container's own state on the file, which is NOT the note's status.
 *
 * A box is delivered when somebody signed for it, in transit when it is out
 * with a driver on a note nobody has signed yet, and outstanding when no live
 * note covers it. On a twelve-box file all three are true at once, which is
 * exactly why the file needed a view the note's own `status` pill cannot give.
 */
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
 * A line of goods on the note.
 *
 * `gross_weight_kg` and `marks` (12749) are the substance on a file that hands
 * cargo over as PACKAGES rather than as containers: the weight is what the
 * consignee checks at the counter, the marks identify the cartons the way a
 * number identifies a box. Strings, because they are form inputs — an empty box
 * has to stay distinguishable from a zero.
 */
type GoodsLine = {
  inventory_item_id: string;
  label: string;
  qty: string;
  gross_weight_kg: string;
  marks: string;
};
const blankGoods = (): GoodsLine => ({
  inventory_item_id: "", label: "", qty: "1", gross_weight_kg: "", marks: "",
});

/* ── The container picker ───────────────────────────────────────────────── */

/**
 * The file's containers, with a tick each. This is the legacy paste box
 * replaced by the thing the paste box was a workaround for.
 *
 * Two shapes (10708): a per-box UNIT (its number and seal, once the B/L has
 * landed) and a grouped LINE ("3 × 40' HC" — how many of each type, which is
 * all a file knows at booking). Both are ticked the same way; the note then
 * prints whichever the file stated.
 *
 * `already_on` is surfaced rather than used to disable the row: delivering the
 * same container across two notes is a legitimate split load, so the UI states
 * the fact and lets the operator decide.
 */
function ContainerPicker({
  dossierId,
  excludeNoteId,
  selected,
  onChange,
  disabled,
  capturesContainers,
}: {
  dossierId: string;
  excludeNoteId?: string;
  selected: api.DeliveryNoteContainer[];
  onChange: (next: api.DeliveryNoteContainer[]) => void;
  disabled?: boolean;
  /**
   * Whether this file's SERVICE TYPE moves containers at all.
   *
   * Undefined while the answer is still in flight, and that matters: the picker
   * must not flash "this service type has no containers" at a sea file for the
   * duration of one request.
   *
   * When it is false the picker is not merely empty — there is nothing for it
   * to be full OF. A customs-brokerage or air file has no equipment on it and
   * never will, so the list and its "no containers captured" prompt are wrong
   * questions rather than empty answers. The hand-typed box stays, because a
   * one-off box on a non-container service is exactly what it is for.
   */
  capturesContainers?: boolean;
}) {
  const containerless = capturesContainers === false;
  const { data, error, loading } = useResource(
    () => (dossierId && !containerless
      ? api.availableContainers(dossierId, excludeNoteId)
      : Promise.resolve([])),
    [dossierId, excludeNoteId, containerless],
  );
  const [manual, setManual] = React.useState("");

  const pickedUnits = new Set(
    selected.map((c) => c.dossier_container_unit_id).filter(Boolean) as string[],
  );
  const pickedLines = new Set(
    selected.map((c) => c.dossier_container_line_id).filter(Boolean) as string[],
  );
  const typed = selected.filter((c) => !c.dossier_container_unit_id && !c.dossier_container_line_id);

  /** The reason carried on the picked row for a box already signed for. */
  const reasonFor = (u: api.AvailableContainer) =>
    selected.find((c) => c.dossier_container_unit_id === u.dossier_container_unit_id)
      ?.redelivery_reason ?? null;
  const setReason = (u: api.AvailableContainer, reason: string) =>
    onChange(
      selected.map((c) =>
        c.dossier_container_unit_id === u.dossier_container_unit_id
          ? { ...c, redelivery_reason: reason }
          : c,
      ),
    );

  function toggle(u: api.AvailableContainer, on: boolean) {
    if (u.kind === "line" && u.dossier_container_line_id) {
      onChange(
        on
          ? [
              ...selected,
              {
                dossier_container_line_id: u.dossier_container_line_id,
                container_type_code: u.container_type_code || null,
                qty: u.qty ?? 1,
              },
            ]
          : selected.filter((c) => c.dossier_container_line_id !== u.dossier_container_line_id),
      );
      return;
    }
    onChange(
      on
        ? [...selected, { dossier_container_unit_id: u.dossier_container_unit_id }]
        : selected.filter((c) => c.dossier_container_unit_id !== u.dossier_container_unit_id),
    );
  }

  function addManual() {
    const no = manual.trim().toUpperCase();
    if (!no) return;
    if (selected.some((c) => (c.container_no || "").toUpperCase() === no)) {
      setManual("");
      return;
    }
    onChange([...selected, { container_no: no }]);
    setManual("");
  }

  if (!dossierId) {
    return (
      <Callout tone="info" title="Pick a file first">
        The containers come from the operations file — choose one above and its
        boxes appear here.
      </Callout>
    );
  }
  if (error) return <ErrorState message={errMsg(error)} />;

  const rows = data || [];

  /** What the note actually carries, in boxes — a grouped line counts its
   *  quantity, a per-box unit counts one. */
  const boxCount =
    selected.filter((c) => c.dossier_container_unit_id).length +
    selected
      .filter((c) => c.dossier_container_line_id)
      .reduce((t, c) => t + (Number(c.qty) || 1), 0) +
    typed.length;

  return (
    <div className="space-y-3">
      {loading && !containerless && (
        <p className="text-sm text-muted">Loading the file&rsquo;s containers…</p>
      )}

      {containerless && (
        <p className="text-sm text-muted">
          This file&rsquo;s service does not move containers, so there is nothing
          to tick. Type a number below only if one genuinely applies.
        </p>
      )}

      {!loading && !containerless && !rows.length && (
        <Callout tone="info" title="No containers captured on this file">
          Nothing to tick yet. The service moves containers, but the B/L has not
          landed — you can still type a number below.
        </Callout>
      )}

      {rows.length > 0 && (
        <div className="rounded-md border border-line divide-y divide-line">
          {rows.map((u) => {
            const isLine = u.kind === "line";
            const on = isLine
              ? pickedLines.has(u.dossier_container_line_id || "")
              : pickedUnits.has(u.dossier_container_unit_id || "");
            return (
              <label
                key={isLine ? `line-${u.dossier_container_line_id}` : `unit-${u.dossier_container_unit_id}`}
                className="flex items-start gap-3 p-2 cursor-pointer"
              >
                <Checkbox
                  label={
                    isLine
                      ? `${u.qty ?? 1} × ${u.container_type_code || "container"}`
                      : (u.container_no || "Unnumbered container")
                  }
                  checked={on}
                  disabled={disabled}
                  onCheckedChange={(v) => toggle(u, v === true)}
                />
                <span className="min-w-0 flex-1 text-sm">
                  {isLine ? (
                    // The grouped shape: type × quantity, as the file states it.
                    <span className="font-medium">
                      {u.qty ?? 1} ×{" "}
                      {u.container_type_en || u.container_type_fr || u.container_type_code}
                      {u.container_type_code ? (
                        <span className="num text-muted"> · {u.container_type_code}</span>
                      ) : null}
                      <span className="text-muted"> — no numbers yet</span>
                    </span>
                  ) : (
                    <>
                      <span className="num font-medium">{u.container_no || "—"}</span>
                      {u.container_type_code && (
                        <span className="text-muted"> · {u.container_type_code}</span>
                      )}
                      {u.seal_no && <span className="text-muted"> · seal {u.seal_no}</span>}
                    </>
                  )}
                  {/*
                    * TWO DIFFERENT FACTS, and they used to read as one.
                    *
                    * A box on another ISSUED note is a split load: routine,
                    * stated quietly. A box on a DELIVERED note has been signed
                    * for by a named human, and sending it out again is nearly
                    * always a mis-click — so it is loud, and ticking it opens
                    * the reason field below, which the API requires.
                    */}
                  {u.delivered_on && u.delivered_on.length > 0 && (
                    <span className="block text-xs font-medium text-[rgb(var(--bad))]">
                      Already signed for on {u.delivered_on.join(", ")} — say why
                      it is going out again.
                    </span>
                  )}
                  {u.issued_on && u.issued_on.length > 0 && (
                    <span className="block text-xs text-warn">
                      Out on {u.issued_on.join(", ")} — tick only if this is a split load.
                    </span>
                  )}
                  {on && u.delivered_on && u.delivered_on.length > 0 && (
                    <span className="mt-1 block">
                      <Input
                        value={reasonFor(u) || ""}
                        onChange={(e) => setReason(u, e.target.value)}
                        placeholder="e.g. Returned damaged on 12/07, re-delivered"
                        aria-label="Why this container is being delivered again"
                        onClick={(e) => e.preventDefault()}
                      />
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {/* The escape hatch, kept deliberately secondary to the picker. */}
      {!disabled && (
        <div className="flex items-end gap-2">
          <Field
            label="Container not on the file"
            className="flex-1"
            hint="Only for a box that never made it onto the file — otherwise tick it above."
          >
            <Input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addManual();
                }
              }}
              placeholder="TCLU1234567"
            />
          </Field>
          <Button type="button" variant="outline" onClick={addManual}>
            Add
          </Button>
        </div>
      )}

      {typed.length > 0 && (
        <ul className="space-y-1">
          {typed.map((c) => (
            <li
              key={c.container_no}
              className="flex items-center justify-between rounded border border-line px-2 py-1 text-sm"
            >
              <span className="num">{c.container_no}</span>
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${c.container_no}`}
                  onClick={() =>
                    onChange(selected.filter((x) => x.container_no !== c.container_no))
                  }
                  className="text-muted hover:text-foreground"
                >
                  <XIcon />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted">
        {boxCount} container{boxCount === 1 ? "" : "s"} on this note.
        The number, seal and type are copied onto it, so a later correction to
        the file cannot change what was signed for.
      </p>
    </div>
  );
}

/* ── What the file says about itself ─────────────────────────────────────── */

/**
 * The facts the note inherits, shown read-only.
 *
 * ── WHY THIS IS A PANEL AND NOT A SET OF DISABLED INPUTS ────────────────────
 * A disabled input says "you may not change this". These are not fields at all:
 * they are the file's own facts, and the note is derived from them. The entity
 * was a dropdown of every company in the tenant before this — asking an operator
 * to choose something the file had already decided, on a form where choosing
 * wrong puts the wrong company's letterhead on a signed document.
 *
 * The service type earns its place for a different reason: it was NOWHERE on
 * this form, so an operator filling in a delivery note could not tell whether
 * they were on an air file or a sea one — while the form below silently changed
 * shape depending on the answer.
 */
function FileFacts({ file }: { file: api.PrefillFile }) {
  const service = file.service_name_en || file.service_name_fr || file.service_key;
  const transport = file.bl_mawb || file.vessel_flight;
  const route = [file.pol, file.pod].filter(Boolean).join(" → ");
  const facts: [string, React.ReactNode][] = [
    [tr("Issued by"), file.entity_name],
    [tr("Client"), file.client_name],
    [tr("Service"), service],
    [file.bl_mawb ? tr("B/L or AWB") : tr("Vessel / flight"), transport],
    [tr("Route"), route],
    [tr("Arrival"), file.ata ? dateFmt(file.ata) : file.eta ? dateFmt(file.eta) : null],
  ].filter(([, v]) => Boolean(v)) as [string, React.ReactNode][];

  if (!facts.length) return null;

  return (
    <div className="rounded-lg border border-line bg-muted/20 p-3">
      {file.title && (
        <p className="mb-2 text-sm font-medium text-foreground">{file.title}</p>
      )}
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-micro uppercase text-muted">{label}</dt>
            <dd className="truncate text-sm text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">
        From the operations file. Change it there and every document follows.
      </p>
    </div>
  );
}

/* ── How much of the file has gone ──────────────────────────── */

/**
 * The file's progress, fetched once however many surfaces ask for it.
 *
 * One hook rather than a `useResource` call per caller: the resource key is
 * built from the fetcher's SOURCE plus its deps, so callers sharing this body
 * share a query — the form and the detail drawer show the same numbers from one
 * request, and either one's `reload` refreshes both.
 */
function useDeliveryProgress(dossierId: string) {
  return useResource(
    () => (dossierId ? api.deliveryProgress(dossierId) : Promise.resolve(null)),
    [dossierId],
  );
}

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
function DeliveryProgressPanel({
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

/* ── Create / edit ──────────────────────────────────────────────────────── */

function DeliveryForm({
  note,
  onClose,
  onSaved,
}: {
  note?: api.DeliveryNote;
  onClose: () => void;
  onSaved: () => void;
}) {
  const canCreatePlace = useCanUseModule("MOD-29");
  const editing = !!note;

  /**
   * What the FILE says, shown back rather than asked for.
   *
   * Null until a file is picked, and on an existing note until the prefill for
   * its file lands. It carries the issuing entity, the service type and the
   * transport reference — and `captures_containers` / `captures_cargo`, which
   * decide whether this form shows a container manifest, a package list, or
   * neither.
   */
  const [file, setFile] = React.useState<api.PrefillFile | null>(null);

  /**
   * Fields the file ANSWERED but did not STATE — the consignee and the gate
   * contact, both taken from the client on the file. Right on nine notes in
   * ten; the tenth is a bonded warehouse or the customer's own buyer, so they
   * are shown as "suggested — check it" rather than as facts.
   */
  const [suggested, setSuggested] = React.useState<Set<string>>(new Set());

  const [f, setF] = React.useState({
    entity_id: note?.entity_id || "",
    dossier_id: note?.dossier_id || "",
    consignee: note?.consignee || "",
    city_zone: note?.city_zone || "",
    contact_person: note?.contact_person || "",
    address: note?.address || "",
    phone: note?.phone || "",
    delivery_date: note?.delivery_date || "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  /**
   * What the file has already sent, while the next note is being written.
   *
   * The operator raising delivery three of four needs the answer HERE, at the
   * moment they are choosing boxes — reading it off the drawer they closed to
   * open this form is how the same container goes out twice.
   */
  const { data: progress } = useDeliveryProgress(f.dossier_id);


  /**
   * Picking the file IS the form.
   *
   * ── WHAT THIS SCREEN USED TO ASK FOR ──────────────────────────────────────
   * An Entity, from a dropdown of every company in the tenant — a fact the file
   * carries. A Dossier, from a list of bare references nobody recognises. Then
   * the consignee, the address and the cargo, typed, on a file that already
   * held all three. The operator was transcribing a record into a document
   * derived from that record, which is the exact step at which the two start to
   * disagree.
   *
   * Now: choose the file and everything follows from it. What the file states
   * is shown read-only; what it merely answers is filled in and flagged; only
   * what it genuinely cannot know is left to type.
   *
   * ── REPLACE, NOT MERGE ────────────────────────────────────────────────────
   * Choosing a file is choosing its facts, so a re-pick replaces everything
   * rather than filling only the empty boxes. The alternative leaves the
   * PREVIOUS file's consignee and delivery address sitting on a note that now
   * points somewhere else — which is how goods go to the wrong address, and it
   * is invisible because the box looks filled.
   */
  async function pickDossier(id: string) {
    set("dossier_id", id);
    if (!id) {
      setFile(null);
      setSuggested(new Set());
      return;
    }
    try {
      const { body, inferred, file: ctx } = await api.deliveryNotePrefill(id);
      setFile(ctx);
      // On an EXISTING note the file is loaded for context only: its values were
      // agreed when the note was raised and are not re-derived under the
      // operator, who may have corrected them on purpose.
      if (note) return;
      setSuggested(new Set(inferred));
      setF((prev) => ({
        ...prev,
        dossier_id: id,
        entity_id: body.entity_id || "",
        consignee: body.consignee || "",
        city_zone: body.city_zone || "",
        address: body.address || "",
        contact_person: body.contact_person || "",
        phone: body.phone || "",
        delivery_date: body.delivery_date || prev.delivery_date,
      }));
      setLines(
        body.lines?.length
          ? body.lines.map((l) => ({
            inventory_item_id: "",
            label: l.label ?? "",
            qty: String(l.qty ?? 1),
            gross_weight_kg: l.gross_weight_kg == null ? "" : String(l.gross_weight_kg),
            marks: l.marks ?? "",
          }))
          : [blankGoods()],
      );
      // Boxes another note already covers are OFFERED by the picker but not
      // auto-ticked — silently double-delivering them is the failure this
      // prefill exists to prevent; a deliberate split load is one tick away.
      const free = ((body.containers || []) as (api.DeliveryNoteContainer & {
        already_on?: string[];
      })[])
        .filter((c) => c.dossier_container_line_id || !c.already_on?.length)
        .map(({ already_on: _on, ...c }) => c);
      setContainers(free);
    } catch {
      /* @silent:parse -- a convenience. The file is selected and every field is
         still editable, so reporting a failed shortcut as an error would say
         something is broken when nothing is. */
    }
  }

  /* An existing note loads its file's context so the header reads the same as
     it did when the note was raised — and so the container/package panels pick
     the right shape. Never re-derives the values; see `pickDossier`. */
  React.useEffect(() => {
    if (!note?.dossier_id) return;
    let live = true;
    api.deliveryNotePrefill(note.dossier_id)
      .then((r) => { if (live) setFile(r.file); })
      .catch(() => {});
    return () => { live = false; };
  }, [note?.dossier_id]);

  const [lines, setLines] = React.useState<GoodsLine[]>(
    note?.lines?.length
      ? note.lines.map((l) => ({
          inventory_item_id: l.inventory_item_id || "",
          label: l.label || "",
          qty: String(l.qty ?? 1),
          gross_weight_kg: l.gross_weight_kg == null ? "" : String(l.gross_weight_kg),
          marks: l.marks || "",
        }))
      : [blankGoods()],
  );
  const setLine = (i: number, patch: Partial<GoodsLine>) =>
    setLines((s) => s.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const [containers, setContainers] = React.useState<api.DeliveryNoteContainer[]>(
    note?.containers?.map((c) => ({
      dossier_container_unit_id: c.dossier_container_unit_id,
      dossier_container_line_id: c.dossier_container_line_id,
      container_type_code: c.container_type_code,
      qty: c.qty ?? null,
      // The typed number only matters on rows with no file link at all.
      container_no: c.dossier_container_unit_id || c.dossier_container_line_id ? undefined : c.container_no,
    })) || [],
  );

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // G23 — this used to be `.filter((l) => l.inventory_item_id)`, so a line
      // the user typed by hand never even left the browser. A line counts if it
      // says anything at all; the server refuses one that says nothing.
      const goods = lines
        .filter((l) => l.inventory_item_id || l.label.trim())
        .map((l) => ({
          inventory_item_id: l.inventory_item_id || null,
          label: l.label.trim(),
          qty: Number(l.qty) || 1,
          // An empty box is ABSENT, not zero. A delivery note reading "0 kg" is
          // a claim about the goods, and it is the wrong one.
          gross_weight_kg: l.gross_weight_kg.trim() ? Number(l.gross_weight_kg) : null,
          marks: l.marks.trim() || null,
        }));

      const body: api.DeliveryNoteInput = {
        entity_id: f.entity_id || undefined,
        dossier_id: f.dossier_id || undefined,
        consignee: f.consignee || undefined,
        city_zone: f.city_zone || undefined,
        contact_person: f.contact_person || undefined,
        address: f.address.trim() || undefined,
        phone: f.phone.trim() || undefined,
        delivery_date: f.delivery_date || undefined,
        lines: goods.length ? goods : undefined,
        containers,
      };

      if (editing && note) await api.updateDeliveryNote(note.delivery_note_id, body);
      else await api.createDeliveryNote(body);

      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? `Edit ${note?.ref || "delivery note"}` : "New delivery note"}
      description="Proof-of-delivery for a consignee."
      size="lg"
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorState message={error} />}

        {!editing && (
          <Callout tone="info" title="No number yet">
            The note is saved as a draft. Its number is allocated when you issue
            it — so an abandoned draft never burns one.
          </Callout>
        )}

        {/*
          * THE FILE, FIRST AND ALONE.
          *
          * A delivery note cannot be issued without one (`issueBlockers`), so
          * this is not one field among several — it is the question the form
          * exists to ask. Everything below it is derived from the answer.
          */}
        <Field
          label={tr("Operations file")}
          required
          hint="Search by reference, client, B/L or AWB. Everything below fills from the file."
        >
          <OperationsFilePicker
            value={file?.ref || note?.dossier_ref || null}
            disabled={editing}
            onSelect={(picked) => void pickDossier(picked.dossier_id)}
          />
        </Field>

        {/*
          * What the file STATES, shown back rather than asked for.
          *
          * The issuing entity used to be a dropdown of every company in the
          * tenant — a fact the file carries, offered as a decision. The service
          * type was not on the form at all, so an operator could not tell an air
          * file from a sea one while filling in a note about it.
          */}
        {file && <FileFacts file={file} />}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={tr("Consignee")}
            className="sm:col-span-2"
            hint={suggested.has("consignee")
              ? "From the file's client — change it if somebody else receives the goods."
              : undefined}
          >
            <Input
              value={f.consignee}
              onChange={(e) => {
                set("consignee", e.target.value);
                setSuggested((p) => { const n = new Set(p); n.delete("consignee"); return n; });
              }}
              placeholder="Who signs for the goods"
            />
          </Field>
          {/*
           * The city/zone is a routing bucket, and the old free-text box let a
           * typo ("Doula") save cleanly with no coordinate behind it. It is now
           * the same verified-place search every other location on a file uses,
           * and picking a place fills the address from it — so the address and
           * the keyed-in location can never quietly disagree.
           */}
          <Field
            label="City / zone"
            hint="Search the verified place catalogue — the address below follows from it."
          >
            <PlacePicker
              value={f.city_zone || null}
              label="City / zone"
              placeholder="Search a city, zone or delivery point…"
              kinds={["CITY", "ADDRESS", "WAREHOUSE", "INLAND", "OTHER"]}
              canCreate={canCreatePlace}
              onSelect={({ name, place }) => {
                set("city_zone", name);
                set(
                  "address",
                  place.formatted ||
                    [place.name, place.region, place.country]
                      .filter(Boolean)
                      .join(", "),
                );
              }}
            />
          </Field>
          <Field label="Contact person">
            <Input
              value={f.contact_person}
              onChange={(e) => set("contact_person", e.target.value)}
            />
          </Field>
          {/* G23 — a proof-of-delivery with no address proves nothing. */}
          <Field
            label="Delivery address"
            className="sm:col-span-2"
            hint="Filled from the place above — refine the gate or building, but keep it consistent with the keyed-in location."
          >
            <Input
              value={f.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Zone Industrielle, Rue 4321, Douala"
            />
          </Field>
          <Field label={tr("Phone")} hint="Reached at the gate if nobody answers.">
            <Input
              value={f.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+237 6 99 00 11 22"
            />
          </Field>
          <Field
            label={tr("Delivery date")}
            hint="When the goods are expected. Confirmed when somebody signs."
          >
            <DateField
              value={f.delivery_date}
              onChange={(v) => set("delivery_date", v)}
            />
          </Field>
        </div>

        {f.dossier_id && (
          <ShipmentDetailsPanel dossierId={f.dossier_id} variant="strip" />
        )}

        <DeliveryProgressPanel
          progress={progress}
          highlightNoteRef={note?.ref || null}
        />

        {/*
          * THE MANIFEST, ONLY WHERE THERE IS EQUIPMENT TO LIST.
          *
          * This panel used to render on every file. An AIR FREIGHT note showed
          * a "Containers" heading and a box to type a container number into —
          * on a shipment that travels in the hold of an aeroplane. Gating the
          * LIST while leaving the heading and the manual box was not a fix; the
          * question is wrong on that file, so it is not asked.
          */}
        {file?.captures_containers && (
          <Panel title={tr("Containers")}>
            <ContainerPicker
              dossierId={f.dossier_id}
              excludeNoteId={note?.delivery_note_id}
              selected={containers}
              onChange={setContainers}
              capturesContainers
            />
          </Panel>
        )}

        {/*
          * PACKAGES — what an air, road or LCL file actually hands over.
          *
          * Titled by what the file moves rather than "Other cargo", which only
          * made sense while containers were the main event. On a non-container
          * file this IS the document: the description, the count, the weight the
          * consignee checks at the counter and the marks on the cartons.
          *
          * Absent entirely for a service type that describes no cargo at all —
          * a business-representation or brokerage retainer hands nothing over,
          * and a delivery note for one has nothing to list.
          */}
        {file && !file.captures_cargo && !file.captures_containers && (
          <Callout tone="info" title="Nothing to itemise on this file">
            {(file.service_name_en || file.service_name_fr || "This service")} does
            not move goods, so there is no cargo to list. The note still records
            who received what was handed over, and when.
          </Callout>
        )}

        {/* Rendered only where there is cargo to describe. A retainer file gets
            the callout above and no list, because it hands nothing over. */}
        {(!file || file.captures_cargo || file.captures_containers) && (
        <Panel
          title={file?.captures_containers ? tr("Other cargo") : tr("Packages")}
          subtitle={file?.captures_containers
            ? "Anything travelling alongside the containers."
            : "What is being handed over — description, count, weight and marks."}
          action={
            <Button
              type="button"
              variant="outline"
              onClick={() => setLines((s) => [...s, blankGoods()])}
            >
              Add line
            </Button>
          }
        >
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[12rem] flex-1">
                  <InventoryItemSelect
                    value={l.inventory_item_id}
                    onPick={(id: string, label: string) =>
                      setLine(i, { inventory_item_id: id, label })
                    }
                  />
                </div>
                <Field label={tr("Description")} className="min-w-[12rem] flex-1">
                  <Input
                    value={l.label}
                    onChange={(e) => setLine(i, { label: e.target.value })}
                    placeholder="2 pallets, unlisted spares"
                  />
                </Field>
                <Field label={tr("Qty")} className="w-24">
                  <Input
                    inputMode="decimal"
                    value={l.qty}
                    onChange={(e) => setLine(i, { qty: e.target.value })}
                  />
                </Field>
                {/*
                  * Weight and marks, on the files where they are the substance.
                  * A container note identifies goods by the number on the box;
                  * a package note has only these, so hiding them behind the
                  * container manifest is how an air note ends up saying less
                  * than the file it came from.
                  */}
                {!file?.captures_containers && (
                  <>
                    <Field label={tr("Weight (kg)")} className="w-28">
                      <Input
                        inputMode="decimal"
                        value={l.gross_weight_kg}
                        onChange={(e) => setLine(i, { gross_weight_kg: e.target.value })}
                        placeholder="—"
                      />
                    </Field>
                    <Field label={tr("Marks")} className="min-w-[8rem] flex-1">
                      <Input
                        value={l.marks}
                        onChange={(e) => setLine(i, { marks: e.target.value })}
                        placeholder="SLS/001"
                      />
                    </Field>
                  </>
                )}
                {lines.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove line ${i + 1}`}
                    className="mb-2 text-muted hover:text-foreground"
                    onClick={() => setLines((s) => s.filter((_, idx) => idx !== i))}
                  >
                    <XIcon />
                  </button>
                )}
              </div>
            ))}
            <p className="text-xs text-muted">
              A line needs a description or a stock item — hand-typed cargo is
              kept, not silently dropped.
            </p>
          </div>
        </Panel>
        )}

        {/*
          * The file, not the entity. `issueBlockers` refuses to issue a note
          * without an operations file, and the entity is derived from it — so
          * gating on the entity was gating on a consequence.
          */}
        <FormButtons
          busy={busy}
          disabled={!f.dossier_id || busy}
          onCancel={onClose}
          saveLabel={editing ? "Save changes" : "Save draft"}
        />
      </form>
    </Dialog>
  );
}

/* ── Confirm the handover ───────────────────────────────────────────────── */

/**
 * The screen the legacy never had. Everything here is what the client wrote or
 * said at the gate, which is why `received_by_name` is required and the
 * reservations box is given real estate rather than a tooltip.
 */
function DeliverDialog({
  note,
  onClose,
  onDone,
}: {
  note: api.DeliveryNote;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = React.useState("");
  const [reservations, setReservations] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.confirmDelivery(note.delivery_note_id, {
        received_by_name: name.trim(),
        reservations: reservations.trim() || undefined,
      });
      onDone();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Confirm delivery" description={note.ref || undefined}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorState message={error} />}
        <Field
          label="Received by"
          required
          hint="The name of the person who signed for the goods."
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jean Mballa"
          />
        </Field>
        <Field
          label="Reservations"
          hint="Anything the client noted — damage, short count, refused items. Their words, recorded now."
        >
          <Textarea
            rows={3}
            value={reservations}
            onChange={(e) => setReservations(e.target.value)}
            placeholder="Carton 3 crushed; contents intact."
          />
        </Field>
        <Callout tone="warn" title="This is final">
          A confirmed delivery cannot be edited afterwards — it records what the
          client accepted.
        </Callout>
        <FormButtons
          busy={busy}
          disabled={!name.trim() || busy}
          onCancel={onClose}
          saveLabel="Confirm delivery"
        />
      </form>
    </Dialog>
  );
}

/* ── Detail ─────────────────────────────────────────────────────────────── */

function NoteDetail({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, error, reload } = useResource(() => api.getDeliveryNote(id), [id]);
  // Before the early returns below: the file is not known until `data` lands,
  // and a hook cannot be called conditionally. An empty id fetches nothing.
  const { data: progress, reload: reloadProgress } = useDeliveryProgress(data?.dossier_id || "");
  const [editing, setEditing] = React.useState(false);
  const [delivering, setDelivering] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [signOpen, setSignOpen] = React.useState(false);
  const [sendOpen, setSendOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const refresh = () => {
    reload();
    // Confirming a delivery moves boxes from "out with a driver" to "signed
    // for", and the panel is on this same screen — leaving it stale would show
    // the operator the file as it was before the act they just performed.
    reloadProgress();
    onChanged();
  };

  if (error) return <ErrorState message={errMsg(error)} />;
  if (!data) return null;

  const can = (s: api.DeliveryStatus) => (data.allowed_transitions || []).includes(s);

  async function issue() {
    setBusy(true);
    setActionError(null);
    try {
      await api.issueDeliveryNote(id);
      refresh();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={data.ref || "Delivery note"} size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={STATUS_TONE[data.status] || "mute"}>{data.status}</Pill>
          {data.dossier_ref && <span className="text-sm text-muted">{data.dossier_ref}</span>}
          <span className="flex-1" />
          <DocButton
            docType="DELIVERY_NOTE"
            id={data.delivery_note_id}
            title={data.ref || "Delivery note"}
            label={tr("Print")}
          />
        </div>

        {actionError && <ErrorState message={actionError} />}

        {data.status === "DRAFT" && (data.issue_blockers || []).length > 0 && (
          <Callout tone="warn" title="Not ready to issue">
            Still needed: {(data.issue_blockers || []).join(", ")}.
          </Callout>
        )}

        {data.status === "DELIVERED" && (
          <Callout tone="ok" title={`Received by ${data.received_by_name}`}>
            {data.received_at ? dateFmt(data.received_at) : null}
            {data.reservations ? ` — “${data.reservations}”` : null}
          </Callout>
        )}

        {data.status === "CANCELLED" && data.cancel_reason && (
          <Callout tone="bad" title={tr("Cancelled")}>
            {data.cancel_reason}
          </Callout>
        )}

        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase text-muted">{tr("Consignee")}</dt>
            <dd>{data.consignee || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted">{tr("Delivery date")}</dt>
            <dd>{data.delivery_date ? dateFmt(data.delivery_date) : "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase text-muted">{tr("Address")}</dt>
            <dd>{data.address || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted">{tr("Contact")}</dt>
            <dd>{data.contact_person || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted">{tr("Phone")}</dt>
            <dd>{data.phone || "—"}</dd>
          </div>
        </dl>

        <Panel
          title={`Containers (${
            (data.containers || []).reduce(
              (t, c) => t + (c.dossier_container_line_id ? Number(c.qty) || 1 : 1),
              0,
            )
          })`}
        >
          {(data.containers || []).length ? (
            <ul className="grid gap-1 sm:grid-cols-2">
              {(data.containers || []).map((c) => (
                <li key={c.delivery_note_container_id} className="text-sm">
                  {c.dossier_container_line_id && c.container_type_code ? (
                    // The GROUPED shape (10708): the note states the equipment
                    // the way the file does, before any box has a number.
                    <span className="font-medium">
                      {c.qty ?? 1} × {c.container_type_code}
                      <span className="text-muted"> — numbers not yet on file</span>
                    </span>
                  ) : (
                    <>
                      <span className="num font-medium">{c.container_no || "—"}</span>
                      {c.container_type_code && (
                        <span className="text-muted"> · {c.container_type_code}</span>
                      )}
                      {c.seal_no && <span className="text-muted"> · seal {c.seal_no}</span>}
                    </>
                  )}
                  {/* Why a box already signed for is on this note too. It
                      prints on the sheet, so it belongs on the screen the sheet
                      is raised from. */}
                  {c.redelivery_reason && (
                    <span className="block text-xs text-warn">
                      ↻ {c.redelivery_reason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No containers on this note.</p>
          )}
        </Panel>

        {/*
          * The FILE, not this note: how many of its boxes have been signed for,
          * how many are on the road, how many are still to go. This drawer is
          * where somebody decides whether another note is needed, so the answer
          * has to be here rather than one screen away.
          */}
        <DeliveryProgressPanel progress={progress} highlightNoteRef={data.ref || null} />

        {(data.lines || []).length > 0 && (
          <Panel title="Other cargo">
            <ul className="space-y-1">
              {(data.lines || []).map((l) => (
                <li key={l.delivery_note_line_id} className="flex justify-between text-sm">
                  <span>{l.label}</span>
                  <span className="num text-muted">{num(l.qty ?? 0)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {/*
          * Who was ASKED (the chain) and who HAS signed (the seals). Two panels
          * because they answer different questions — a request still out with
          * one signature already on the note is the normal mid-chain state, and
          * either view alone reads as a fault. Both render nothing when there
          * is nothing to show, so a tenant with signatures switched off never
          * sees an empty section for a feature it does not have.
          */}
        <SignatureChainOnRecord
          entityRef={`delivery_note:${data.delivery_note_id}`}
          title={tr("Out for signature")}
        />
        <SignaturesOnRecord
          entityRef={`delivery_note:${data.delivery_note_id}`}
          title={tr("Signatures on this note")}
        />

        <div className="flex flex-wrap justify-end gap-2">
          {data.status === "DRAFT" && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          {can("ISSUED") && (
            <Button onClick={issue} disabled={busy}>
              Issue &amp; number
            </Button>
          )}
          {can("DELIVERED") && (
            <Button onClick={() => setDelivering(true)}>Confirm delivery</Button>
          )}
          {/*
            * THREE DIFFERENT ACTS, and the screen has to keep them apart:
            *
            *   Confirm delivery     records what the client wrote at the gate —
            *                        the name, the reservations, the moment. It
            *                        moves the note to DELIVERED.
            *   Sign electronically  puts OUR attestation on the document: the
            *                        seal that prints in the company box with the
            *                        QR anyone holding the paper can check.
            *   Send for signature   emails the consignee a link to sign it
            *                        themselves, which is the same evidence
            *                        without the driver carrying a clipboard.
            *
            * Only once the note is numbered. The seal prints the note's own
            * reference as evidence and its hash covers the issued manifest, so
            * sealing a draft would attest to a document that does not exist yet
            * and would go stale the moment it was issued.
            */}
          {data.status !== "DRAFT" && data.status !== "CANCELLED" && (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setSignOpen(true)}>
                Sign electronically
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setSendOpen(true)}>
                Send for signature
              </Button>
            </>
          )}
          {can("CANCELLED") && (
            <Button variant="ghost" onClick={() => setCancelling(true)}>
              Cancel note
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <DeliveryForm
          note={data}
          onClose={() => setEditing(false)}
          onSaved={refresh}
        />
      )}
      {delivering && (
        <DeliverDialog note={data} onClose={() => setDelivering(false)} onDone={refresh} />
      )}
      <SignDocumentModal
        open={signOpen}
        entityRef={`delivery_note:${data.delivery_note_id}`}
        docType="DELIVERY_NOTE"
        onClose={() => setSignOpen(false)}
        onSaved={refresh}
      />
      <SendForSignatureModal
        open={sendOpen}
        entityRef={`delivery_note:${data.delivery_note_id}`}
        docType="DELIVERY_NOTE"
        onClose={() => setSendOpen(false)}
        onSent={refresh}
      />
      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title="Cancel this delivery note"
        confirmLabel="Cancel note"
        cancelLabel="Keep it"
        destructive
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          setActionError(null);
          try {
            await api.cancelDeliveryNote(id, reason);
            setCancelling(false);
            refresh();
          } catch (err) {
            setActionError(errMsg(err));
          } finally {
            setBusy(false);
          }
        }}
        body={
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              The number is retained and never re-used, so the reason is what
              explains the gap in the sequence later.
            </p>
            <Field label={tr("Reason")} required>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Client refused the delivery"
              />
            </Field>
          </div>
        }
      />
    </Dialog>
  );
}

/* ── List ───────────────────────────────────────────────────────────────── */

export function DeliveryNotesPage() {
  const [status, setStatus] = React.useState("");
  const { rows, error, loading, reload } = useList<api.DeliveryNote>(
    `/delivery-notes${status ? `?status=${status}` : ""}`,
  );
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const { data: counts, reload: reloadCounts } = useResource(
    () => api.deliveryNoteSummary(),
    [],
  );
  const [open, setOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<string | null>(null);
  const dref = nameMap(dossiers, "dossier_id", "ref");

  const refresh = () => {
    reload();
    reloadCounts();
  };

  const columns: Column<api.DeliveryNote>[] = [
    {
      key: "ref",
      label: "Ref",
      // With `onRowClick` set, data-list wraps column 0 in a real button
      // (RowActivator) — same affordance as the transit-orders list. The cell
      // itself stays plain text so we never nest a button inside it.
      render: (r) => (
        <span className="num font-medium text-foreground">
          {/* A draft has no number yet, and saying so beats showing a uuid stub. */}
          {r.ref || <span className="text-muted italic">draft</span>}
        </span>
      ),
    },
    {
      key: "dossier_id",
      label: "Dossier",
      render: (r) => (r.dossier_id ? dref[r.dossier_id] || "—" : "—"),
    },
    { key: "consignee", label: "Consignee" },
    {
      key: "address",
      label: "Address",
      render: (r) => r.address || <span className="text-muted">—</span>,
    },
    {
      key: "delivery_date",
      label: "Delivery date",
      // Historic notes predate the column, so "—" means "not recorded" rather
      // than "not delivered" — 10694 deliberately did not backfill a date it
      // could not know.
      render: (r) => (r.delivery_date ? dateFmt(r.delivery_date) : "—"),
    },
    {
      key: "received_by_name",
      label: "Signed by",
      render: (r) =>
        r.received_by_name || <span className="text-muted">—</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <Pill tone={STATUS_TONE[r.status] || "mute"}>{r.status}</Pill>,
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end">
          <DocButton
            docType="DELIVERY_NOTE"
            id={r.delivery_note_id}
            title={r.ref || `Delivery note ${r.delivery_note_id.slice(0, 8)}`}
            label={tr("View")}
          />
        </div>
      ),
    },
  ];

  return (
    <ListPage<api.DeliveryNote>
      eyebrow={<HubCrumb area="Operations" to="/operations" />}
      title={tr("Delivery notes")}
      description="Proof that goods reached the consignee — and who signed for them."
      action={<Button onClick={() => setOpen(true)}>New note</Button>}
      tabs={<HubTabs />}
      kpis={
        <KpiRow>
          {api.DELIVERY_STATUSES.map((s) => (
            <KpiTile
              key={s}
              label={s[0] + s.slice(1).toLowerCase()}
              value={num(counts?.[s] ?? 0)}
              tone={s === "DELIVERED" ? "ok" : s === "ISSUED" ? "warn" : undefined}
              // The tiles double as the status filter — clicking one narrows the
              // list, clicking it again clears it.
              onClick={() => setStatus(status === s ? "" : s)}
              ariaLabel={`${status === s ? "Clear" : "Show only"} ${s.toLowerCase()} delivery notes`}
            />
          ))}
        </KpiRow>
      }
      columns={columns}
      rows={rows}
      error={error}
      loading={loading}
      rowKey={(r) => r.delivery_note_id}
      // Click anywhere on a row opens the snapshot modal — same gesture as the
      // transit-orders list.
      onRowClick={(r) => setDetail(r.delivery_note_id)}
      empty={{
        title: "No delivery notes",
        hint: "Raise one when goods go out — it is the record of what the client accepted.",
        action: <Button onClick={() => setOpen(true)}>New note</Button>,
      }}
    >
      {open && <DeliveryForm onClose={() => setOpen(false)} onSaved={refresh} />}
      {detail && (
        <NoteDetail id={detail} onClose={() => setDetail(null)} onChanged={refresh} />
      )}
      <ScreenAi path="operations/delivery-notes" />
    </ListPage>
  );
}
