/**
 * Create / edit a delivery note.
 *
 * Split out of `delivery-notes.tsx` when the detail view became a 360 with its
 * own route: that file held a list, a 500-line form, a confirm dialog and a
 * 300-line drawer, and the 360 needs the form while the list needs the 360.
 * One file importing the other both ways is a cycle. Same shape as
 * `operation-files.tsx` / `dossier-form.tsx`.
 *
 * ── THE NOTE IS DERIVED FROM ITS FILE ───────────────────────────────────────
 * The form asks for the operations file and derives the rest: the consignee,
 * the address, the gate contact, the delivery date and the cargo all prefill
 * from it. And it takes its SHAPE from what the file moves — a container
 * manifest for a service type that captures containers, packages (description,
 * count, weight, marks) for one that does not, and neither for a
 * representation or brokerage retainer. No container manifest on an air
 * waybill's delivery note.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { DateField } from "@/components/ui/date-field";
import { FormButtons } from "@/components/ui/form-buttons";
import { ErrorState } from "@/components/ui/states";
import { Callout } from "@/components/ui/callout";
import { Panel } from "@/components/ui/panel";
import { InventoryItemSelect } from "@/components/catalogue-select";
import { PlacePicker } from "@/components/operations/place-picker";
import { OperationsFilePicker } from "@/components/operations/file-picker";
import { XIcon } from "@/components/ui/icons";
import { useResource, errMsg } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import { useCanUseModule } from "@/lib/route-access";
import * as api from "@/lib/operations-api";
import { ShipmentDetailsPanel } from "./shipment-details";
import { DeliveryProgressPanel } from "./delivery-progress";
import { useDeliveryProgress } from "./use-delivery-progress";

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

/* ── Create / edit ──────────────────────────────────────────────────────── */

export function DeliveryForm({
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
