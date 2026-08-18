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
import { Field, Select } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { DateField } from "@/components/ui/date-field";
import { FormButtons } from "@/components/ui/form-buttons";
import { ErrorState } from "@/components/ui/states";
import { Callout } from "@/components/ui/callout";
import { Panel } from "@/components/ui/panel";
import { DocButton } from "@/components/doc-button";
import { InventoryItemSelect } from "@/components/catalogue-select";
import { PlacePicker } from "@/components/operations/place-picker";
import { ListPage } from "@/components/list-page";
import type { Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import type { Tone } from "@/components/ui/pill";
import { ScreenAi } from "@/components/screen-ai";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { XIcon } from "@/components/ui/icons";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { num, dateFmt } from "@/lib/format";
import { useCanUseModule } from "@/lib/route-access";
import type { Entity } from "@/lib/masterdata-api";
import * as api from "@/lib/operations-api";
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

type GoodsLine = { inventory_item_id: string; label: string; qty: string };
const blankGoods = (): GoodsLine => ({ inventory_item_id: "", label: "", qty: "1" });

/* ── The container picker ───────────────────────────────────────────────── */

/**
 * The file's boxes, with a tick each. This is the legacy paste box replaced by
 * the thing the paste box was a workaround for.
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
}: {
  dossierId: string;
  excludeNoteId?: string;
  selected: api.DeliveryNoteContainer[];
  onChange: (next: api.DeliveryNoteContainer[]) => void;
  disabled?: boolean;
}) {
  const { data, error, loading } = useResource(
    () => (dossierId ? api.availableContainers(dossierId, excludeNoteId) : Promise.resolve([])),
    [dossierId, excludeNoteId],
  );
  const [manual, setManual] = React.useState("");

  const pickedUnits = new Set(
    selected.map((c) => c.dossier_container_unit_id).filter(Boolean) as string[],
  );
  const typed = selected.filter((c) => !c.dossier_container_unit_id);

  function toggle(u: api.AvailableContainer, on: boolean) {
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

  return (
    <div className="space-y-3">
      {loading && <p className="text-sm text-muted">Loading the file&rsquo;s containers…</p>}

      {!loading && !rows.length && (
        <Callout tone="info" title="No containers captured on this file">
          Nothing to tick yet. Either the file does not track equipment, or the
          B/L has not landed. You can still type a container number below.
        </Callout>
      )}

      {rows.length > 0 && (
        <div className="rounded-md border border-line divide-y divide-line">
          {rows.map((u) => {
            const on = pickedUnits.has(u.dossier_container_unit_id);
            return (
              <label
                key={u.dossier_container_unit_id}
                className="flex items-start gap-3 p-2 cursor-pointer"
              >
                <Checkbox
                  label={u.container_no || "Unnumbered container"}
                  checked={on}
                  disabled={disabled}
                  onCheckedChange={(v) => toggle(u, v === true)}
                />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="num font-medium">{u.container_no || "—"}</span>
                  {u.container_type_code && (
                    <span className="text-muted"> · {u.container_type_code}</span>
                  )}
                  {u.seal_no && <span className="text-muted"> · seal {u.seal_no}</span>}
                  {u.already_on && u.already_on.length > 0 && (
                    <span className="block text-xs text-warn">
                      Already on {u.already_on.join(", ")} — tick only if this is a split load.
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
        {selected.length} container{selected.length === 1 ? "" : "s"} on this note.
        The number and seal are copied onto it, so a later correction to the file
        cannot change what was signed for.
      </p>
    </div>
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
  const { rows: entities } = useList<Entity>("/entities");
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const canCreatePlace = useCanUseModule("MOD-29");
  const editing = !!note;

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
   * Picking the file fills the note from it — above all, the CONTAINERS.
   *
   * A file with twelve boxes carries twelve container numbers and twelve seal
   * numbers, and this note is the document they exist to travel on. Typed by
   * hand that is twenty-four eleven-character alphanumerics, which is not a task
   * people do accurately; copied, the note cannot drift from the file.
   *
   * Only on a NEW note, and never over something already typed. The consignee
   * block is deliberately left alone — the file does not record one, and a
   * client is not a consignee.
   */
  async function pickDossier(id: string) {
    set("dossier_id", id);
    if (!id || note) return;
    try {
      const { body } = await api.deliveryNotePrefill(id);
      setF((prev) =>
        body.entity_id && !prev.entity_id
          ? { ...prev, dossier_id: id, entity_id: body.entity_id }
          : { ...prev, dossier_id: id },
      );
      if (body.lines?.length && lines.every((l) => !l.label.trim())) {
        setLines(
          body.lines.map((l) => ({
            inventory_item_id: "",
            label: l.label ?? "",
            qty: String(l.qty ?? 1),
          })),
        );
      }
      // Containers replace only an empty grid: on a new note there is nothing
      // to lose, and an operator who has already picked boxes has made a
      // choice the file should not overrule.
      if (body.containers?.length && !containers.length) {
        setContainers(body.containers as api.DeliveryNoteContainer[]);
      }
    } catch {
      /* @silent:parse -- a convenience. The file is selected and every field is
         still editable, so reporting a failed shortcut as an error would say
         something is broken when nothing is. */
    }
  }

  const [lines, setLines] = React.useState<GoodsLine[]>(
    note?.lines?.length
      ? note.lines.map((l) => ({
          inventory_item_id: l.inventory_item_id || "",
          label: l.label || "",
          qty: String(l.qty ?? 1),
        }))
      : [blankGoods()],
  );
  const setLine = (i: number, patch: Partial<GoodsLine>) =>
    setLines((s) => s.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const [containers, setContainers] = React.useState<api.DeliveryNoteContainer[]>(
    note?.containers?.map((c) => ({
      dossier_container_unit_id: c.dossier_container_unit_id,
      container_no: c.dossier_container_unit_id ? undefined : c.container_no,
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

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("Entity")} required>
            <Select
              value={f.entity_id}
              onChange={(e) => set("entity_id", e.target.value)}
            >
              <option value="">{tr("Select…")}</option>
              {(entities || []).map((x) => (
                <option key={x.entity_id} value={x.entity_id}>
                  {x.trading_name || x.legal_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Dossier")} hint="The consignee and containers come from the file.">
            <Select
              value={f.dossier_id}
              onChange={(e) => void pickDossier(e.target.value)}
            >
              <option value="">{tr("Select…")}</option>
              {(dossiers || []).map((d) => (
                <option key={d.dossier_id} value={d.dossier_id}>
                  {d.ref}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Consignee")} className="sm:col-span-2">
            <Input
              value={f.consignee}
              onChange={(e) => set("consignee", e.target.value)}
              placeholder="Defaults to the file's client"
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

        <Panel title={tr("Containers")}>
          <ContainerPicker
            dossierId={f.dossier_id}
            excludeNoteId={note?.delivery_note_id}
            selected={containers}
            onChange={setContainers}
          />
        </Panel>

        <Panel
          title="Other cargo"
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

        <FormButtons
          busy={busy}
          disabled={!f.entity_id || busy}
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
  const [editing, setEditing] = React.useState(false);
  const [delivering, setDelivering] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const refresh = () => {
    reload();
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

        <Panel title={`Containers (${(data.containers || []).length})`}>
          {(data.containers || []).length ? (
            <ul className="grid gap-1 sm:grid-cols-2">
              {(data.containers || []).map((c) => (
                <li key={c.delivery_note_container_id} className="text-sm">
                  <span className="num font-medium">{c.container_no || "—"}</span>
                  {c.seal_no && <span className="text-muted"> · seal {c.seal_no}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No containers on this note.</p>
          )}
        </Panel>

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
