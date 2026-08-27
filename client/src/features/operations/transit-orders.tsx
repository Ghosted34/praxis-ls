/**
 * Transit orders — the client's written authorisation to declare their cargo.
 *
 * ── WHAT THIS SCREEN REPLACED, AND WHY IT LOOKS LIKE THIS ───────────────────
 *
 * The legacy screen (`view/operations/transit-order.php`, 1031 lines) got one
 * big thing RIGHT that the first rebuild dropped, and several things wrong that
 * are worth not carrying forward.
 *
 * RIGHT: it was built around a FILE SEARCH. You typed a reference, a client
 * name or a B/L, and the whole shipment block — client, vessel, B/L, ports,
 * arrival, cargo, marks, weight — filled itself in read-only from the file.
 * The operator's job was to make the three or four DECISIONS the order records,
 * not to retype facts the system already had. The rebuild replaced that with a
 * bare `<select>` of dossier UUIDs and no context at all, so the operator had
 * to open another tab to check they had picked the right file. The file picker
 * and the live shipment panel below it are that idea restored — through the
 * shared ShipmentDetailsPanel, so it works on any service type rather than the
 * legacy's sea/air `if`.
 *
 * WRONG, and not carried forward:
 *   · The OT number was rendered into the form on page load, so abandoning the
 *     form burned a number. Here the number appears only once the order is
 *     issued, and the form says so.
 *   · There was no lifecycle. Print was the end of the story — nothing recorded
 *     whether the client ever signed. The status rail is the spine of this
 *     screen for that reason.
 *   · The cargo table printed one line. This edits many, with per-line value
 *     that reconciles against the declared total.
 *   · The document checklist was five hard-coded checkboxes, and the print
 *     template had a sixth (Certificate of Origin) the form could never tick.
 *     The list is now served by the API.
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
import { FormButtons } from "@/components/ui/form-buttons";
import { ErrorState } from "@/components/ui/states";
import { Callout } from "@/components/ui/callout";
import { Panel } from "@/components/ui/panel";
import { DocButton } from "@/components/doc-button";
import { ListPage } from "@/components/list-page";
import type { Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import type { Tone } from "@/components/ui/pill";
import { ScreenAi } from "@/components/screen-ai";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { XIcon } from "@/components/ui/icons";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { money, num } from "@/lib/format";
import type { Entity } from "@/lib/masterdata-api";
import * as api from "@/lib/operations-api";
// The vault upload lives in masterdata-api because the vault is master data,
// not an operations concern — the signed scan is stored the same way every
// other scan in the product is.
import * as masterApi from "@/lib/masterdata-api";
import { SCAN_ACCEPT, scanFileProblem, readFileAsDataUrl } from "@/lib/vault-file";
import { cn } from "@/lib/cn";
import { openVaultDoc } from "@/lib/vault-file";
import {
  SendForSignatureModal,
  SignatureChainOnRecord,
  SignDocumentModal,
  SignaturesOnRecord,
} from "@/features/vault/sign-document";
import { ShipmentDetailsPanel } from "./shipment-details";
import { humanizeKey, nameMap } from "./shared";

/**
 * The lifecycle tones. Deliberately NOT `shared.tone`, which maps the generic
 * operations vocabulary: here ISSUED means "out for signature, waiting on
 * someone else" (warn) rather than the neutral it would otherwise read as, and
 * LODGED is the successful end of the road.
 */
const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "mute",
  ISSUED: "warn",
  SIGNED: "blue",
  LODGED: "ok",
  CANCELLED: "bad",
};
const statusTone = (s?: string | null): Tone => STATUS_TONE[String(s || "")] || "mute";

const STATUS_HINT: Record<string, string> = {
  DRAFT: "Not numbered yet. Nothing is sent until you issue it.",
  ISSUED: "Numbered and out for the client's signature.",
  SIGNED: "Client-signed copy on file — you may lodge the declaration.",
  LODGED: "Declaration filed. This order is final.",
  CANCELLED: "Withdrawn. The number is retained and not re-used.",
};

type CargoLine = {
  label: string;
  marks: string;
  packages: string;
  weight: string;
  hs_code: string;
  value_amount: string;
};
/**
 * Where a filled-in value came from.
 *
 * Two words, and the difference between them is the whole point. "From the
 * file" is a copy and is exactly as true as the file. "Suggested" was worked out
 * — the direction, from the regime prefix — and might be wrong for this
 * particular order. An operator scanning a form somebody else's software filled
 * in needs to know which boxes to actually read.
 *
 * Rendered as a caption on the field rather than a colour, because the one
 * person who most needs this signal may be the one who cannot see the colour.
 */
function Source({ from, suggested }: { from?: boolean; suggested?: boolean }) {
  if (!from && !suggested) return null;
  return (
    <span
      className={cn(
        "ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium",
        suggested
          ? "bg-[rgb(var(--warn-fill)_/_0.16)] text-[rgb(var(--warn))]"
          : "bg-[rgb(var(--ink)/0.06)] text-muted-foreground",
      )}
    >
      {suggested ? "suggested — check it" : "from the file"}
    </span>
  );
}

const blankCargo = (): CargoLine => ({
  label: "",
  marks: "",
  packages: "1",
  weight: "",
  hs_code: "",
  value_amount: "",
});
const toCargo = (l: api.TransitOrderLine): CargoLine => ({
  label: l.label || "",
  marks: l.marks || "",
  packages: l.packages != null ? String(l.packages) : "1",
  weight: l.weight || "",
  hs_code: l.hs_code || "",
  value_amount: l.value_amount != null ? String(l.value_amount) : "",
});

/**
 * The file's own vault documents, shown under the checklist so an operator can
 * preview what is actually attached before ticking the corresponding box —
 * the checklist alone is just a list of nouns, and an order raised on a file
 * whose B/L was never uploaded should be visible at the moment of decision.
 */
function DossierDocuments({ dossierId }: { dossierId: string }) {
  const { data, error, loading } = useResource(
    () => api.listDossierDocuments(dossierId),
    [dossierId],
  );

  if (error) return <ErrorState message={errMsg(error)} />;

  const rows = data || [];
  if (!loading && rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No documents in this file's vault yet — attach them from the file's
        documents tab, then they will preview here.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-line">
      <div className="micro border-b border-line px-2 py-1.5 text-muted-foreground">
        On this file
      </div>
      {rows.map((d) => (
        <div
          key={d.doc_id}
          className="flex items-center justify-between gap-2 border-b border-line px-2 py-1.5 last:border-b-0"
        >
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm text-foreground">
              {d.doc_type ? humanizeKey(d.doc_type) : "Document"}
              {d.version_no && d.version_no > 1 ? ` · v${d.version_no}` : ""}
            </span>
            <span className="micro text-muted-foreground">{d.status || "—"}</span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void openVaultDoc(d.doc_id)}
          >
            Preview
          </Button>
        </div>
      ))}
    </div>
  );
}

/* ── The form ──────────────────────────────────────────────────────────────── */

function TransitForm({
  row,
  onClose,
  onSaved,
}: {
  row: api.TransitOrder | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = row === null;
  const { rows: entities } = useList<Entity>("/entities");
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  // The checklist comes from the server, so the form can never be a stale copy
  // of a vocabulary the API has moved on from.
  const { data: docTypes } = useResource(() => api.transitDocTypes(), []);
  // The declared-value currency is a select over the tenant's master data, and
  // the rate to XAF beside it is a derived read-out, not a second input.
  const { data: currencies } = useResource(() => api.transitOrderCurrencies(), []);

  // A draft is editable; an issued order is not, except for the three fields
  // the API still accepts. Mirrored here so the inputs are visibly disabled
  // rather than failing on save.
  const locked = !isNew && row!.status !== "DRAFT";
  const dead = !isNew && (row!.status === "LODGED" || row!.status === "CANCELLED");

  const [f, setF] = React.useState({
    entity_id: row?.entity_id ?? "",
    dossier_id: row?.dossier_id ?? "",
    customs_regime: row?.customs_regime ?? "",
    customs_regime_other: row?.customs_regime_other ?? "",
    service_direction: row?.service_direction ?? "IMPORT",
    declared_value: row?.declared_value != null ? String(row.declared_value) : "",
    declared_currency: row?.declared_currency ?? "XAF",
    insurance_type: row?.insurance_type ?? "CLIENT",
    surveyor_party: row?.surveyor_party ?? "CLIENT",
    departure_date: row?.departure_date ?? "",
    instructions: row?.instructions ?? "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  const [docs, setDocs] = React.useState<Set<string>>(
    () => new Set((row?.submitted_docs || []).map((d) => d.code)),
  );
  const toggleDoc = (code: string, on: boolean) =>
    setDocs((s) => {
      const n = new Set(s);
      if (on) n.add(code);
      else n.delete(code);
      return n;
    });

  const [lines, setLines] = React.useState<CargoLine[]>(() =>
    row?.lines?.length ? row.lines.map(toCargo) : [blankCargo()],
  );
  const setLine = (i: number, patch: Partial<CargoLine>) =>
    setLines((s) => s.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [duplicate, setDuplicate] = React.useState(false);

  /**
   * The lines-vs-declared reconciliation, shown while typing.
   *
   * The legacy form had one free-text value box and no arithmetic at all, so a
   * declared value that did not match the cargo was discovered by a customs
   * officer. Stating it here is not a validation — the operator may legitimately
   * declare a rounded figure — so it warns and never blocks.
   */
  const linesTotal = lines.reduce((s, l) => s + (Number(l.value_amount) || 0), 0);
  const declared = f.declared_value === "" ? null : Number(f.declared_value);
  const mismatch =
    declared !== null && linesTotal > 0 && Math.abs(linesTotal - declared) > 0.01;

  // The file's own facts, shown live under the picker — the legacy screen's one
  // genuinely good idea, restored through the shared panel.
  const pickedDossier = f.dossier_id || null;

  /**
   * Which fields the file filled in, and which it merely suggested.
   *
   * Kept apart because they are not the same claim. `prefilled` was COPIED off
   * the file and is as true as the file is; `suggested` was DERIVED — the
   * direction, read off the regime prefix — and an operator running an IM7
   * unusually has to see that it was assumed. Marking them identically would
   * make every filled box look equally authoritative, which is the failure this
   * whole feature is trying not to introduce.
   */
  const [prefilled, setPrefilled] = React.useState<Set<string>>(new Set());
  const [suggested, setSuggested] = React.useState<Set<string>>(new Set());

  /**
   * Picking a file fills the form from it.
   *
   * The panel above already SHOWS the operator the regime, commodity, weight,
   * packages and marks; the form underneath then asked them to type the same
   * things in again. That gap is where a transit order comes to disagree with
   * the file it was raised from — and the one that disagrees is the document
   * lodged with customs.
   *
   * Only on a NEW order, and only into fields the operator has not already
   * filled: re-picking the file on a half-typed form must not silently discard
   * what they typed. A prefill failure is deliberately silent — the file is
   * still selected and the form still works, so an error banner would report a
   * convenience that did not happen as though something broke.
   */
  async function pickDossier(id: string) {
    set("dossier_id", id);
    if (!id || !isNew) return;
    try {
      const { body, from, inferred } = await api.transitOrderPrefill(id);
      setF((prev) => {
        const next = { ...prev, dossier_id: id };
        const take = (k: keyof typeof prev, v: unknown) => {
          if (v === undefined || v === null || v === "") return;
          // `String(...)` because the form holds every scalar as text; the
          // submit path converts back on the way out.
          if (!String(prev[k] ?? "").trim()) next[k] = String(v) as never;
        };
        take("entity_id", body.entity_id);
        take("customs_regime", body.customs_regime);
        take("customs_regime_other", body.customs_regime_other);
        take("service_direction", body.service_direction);
        take("declared_currency", body.declared_currency);
        return next;
      });
      // Cargo replaces only an untouched line grid. One empty row is the
      // initial state, so this catches "the operator has not started" without
      // treating a deliberately blank line as fair game.
      if (body.lines?.length && lines.every((l) => !l.label.trim())) {
        setLines(
          body.lines.map((l) => ({
            ...blankCargo(),
            label: l.label ?? "",
            marks: l.marks ?? "",
            // `blankCargo` defaults packages to "1"; keep that when the file
            // does not state a count rather than blanking a sensible default.
            ...(l.packages != null ? { packages: String(l.packages) } : {}),
            weight: l.weight ?? "",
          })),
        );
      }
      setPrefilled(new Set(from));
      setSuggested(new Set(inferred));
    } catch {
      /* @silent:parse -- the prefill is a convenience. The file is selected,
         every field is still editable, and reporting a failed shortcut as an
         error would tell the operator something is broken when nothing is. */
    }
  }

  async function submit(e: React.FormEvent, allowDuplicate = false) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const cargo = lines
      .filter((l) => l.label.trim())
      .map((l) => ({
        label: l.label.trim(),
        marks: l.marks || null,
        hs_code: l.hs_code || null,
        packages: Number(l.packages) || 1,
        weight: l.weight || null,
        value_amount: l.value_amount === "" ? null : Number(l.value_amount),
      }));
    const body: api.TransitOrderInput = {
      entity_id: f.entity_id || undefined,
      dossier_id: f.dossier_id || undefined,
      customs_regime: f.customs_regime || null,
      customs_regime_other: f.customs_regime ? null : f.customs_regime_other || null,
      service_direction: f.service_direction || null,
      declared_value: f.declared_value === "" ? null : Number(f.declared_value),
      declared_currency: f.declared_currency || "XAF",
      insurance_type: f.insurance_type,
      surveyor_party: f.surveyor_party,
      departure_date: f.departure_date || null,
      instructions: f.instructions || null,
      submitted_docs: [...docs],
      ...(allowDuplicate ? { allow_duplicate: true } : {}),
      ...(!locked ? { lines: cargo } : {}),
    };
    try {
      if (isNew) await api.createTransitOrder(body);
      else await api.updateTransitOrder(row!.transit_order_id, body);
      onSaved();
      onClose();
    } catch (err) {
      // The duplicate guard is a question, not a failure — offer the answer
      // rather than making the operator find the flag.
      const msg = errMsg(err);
      if (/already has a transit order/i.test(msg)) {
        setDuplicate(true);
        setError(msg);
      } else setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={isNew ? "New transit order" : `Transit order ${row!.ref || "(draft)"}`}
      description="The client's written authorisation to declare this cargo."
    >
      <form className="space-y-5" onSubmit={(e) => submit(e)}>
        {!isNew && (
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={statusTone(row!.status)}>{row!.status}</Pill>
            <span className="text-xs text-muted-foreground">
              {STATUS_HINT[row!.status]}
            </span>
          </div>
        )}

        {dead && (
          <Callout tone="info" title="Read-only">
            {row!.status === "LODGED"
              ? "A declaration has been filed against this order, so it can no longer change."
              : `Cancelled${row!.cancel_reason ? `: ${row!.cancel_reason}` : "."}`}
          </Callout>
        )}
        {locked && !dead && (
          <Callout tone="warn" title="Issued — mostly locked">
            This order has been numbered and sent to the client. Only the
            departure date, the special instructions and the document checklist
            can still change; the declared value and the regime are what they
            signed.
          </Callout>
        )}

        {/* ── 1. The file. Everything below is decided ABOUT this file. ─────── */}
        <section className="space-y-3">
          <div className="micro">1 · Operations file</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Operations file" required>
              <Select
                value={f.dossier_id}
                disabled={locked}
                onChange={(e) => void pickDossier(e.target.value)}
              >
                <option value="">—</option>
                {(dossiers || []).map((d) => (
                  <option key={d.dossier_id} value={d.dossier_id}>
                    {d.ref}
                    {d.client_name ? ` — ${d.client_name}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Issuing entity"
              hint="Whose letterhead this prints on. Defaults to the file's."
            >
              <Select
                value={f.entity_id}
                disabled={locked}
                onChange={(e) => set("entity_id", e.target.value)}
              >
                <option value="">From the file</option>
                {(entities || []).map((en) => (
                  <option key={en.entity_id} value={en.entity_id}>
                    {en.legal_name || en.code}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/*
           * The shipment block, read-only and live from the file. This is the
           * legacy screen's central idea and the rebuild had dropped it: the
           * operator confirms they picked the right file without leaving the
           * form, and never retypes a vessel or a B/L that already exists.
           */}
          {pickedDossier && (
            <ShipmentDetailsPanel
              dossierId={pickedDossier}
              title="From the file"
            />
          )}
        </section>

        {/* ── 2. The decisions. This is what the order actually records. ────── */}
        <section className="space-y-3">
          <div className="micro">2 · Customs instruction</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={
                <>
                  Direction
                  <Source suggested={suggested.has("service_direction")} />
                </>
              }
              required
            >
              <Select
                value={f.service_direction}
                disabled={locked}
                onChange={(e) => set("service_direction", e.target.value)}
              >
                <option value="IMPORT">{tr("Import")}</option>
                <option value="EXPORT">{tr("Export")}</option>
              </Select>
            </Field>
            <Field
              label={
                <>
                  Customs regime
                  <Source from={prefilled.has("customs_regime")} />
                </>
              }
              hint="Or write in a regime below if it is not one of these."
            >
              <Select
                value={f.customs_regime}
                disabled={locked}
                onChange={(e) => set("customs_regime", e.target.value)}
              >
                <option value="">— (write-in)</option>
                {api.CUSTOMS_REGIMES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            {!f.customs_regime && (
              <Field
                label="Other regime"
                hint="The write-in line on the printed form."
              >
                <Input
                  value={f.customs_regime_other}
                  disabled={locked}
                  onChange={(e) => set("customs_regime_other", e.target.value)}
                />
              </Field>
            )}
            <Field
              label="Departure date"
              hint="Prints as “Date de départ”. May still change after issue."
            >
              <Input
                type="date"
                value={f.departure_date}
                disabled={dead}
                onChange={(e) => set("departure_date", e.target.value)}
              />
            </Field>
          </div>

          {/*
           * The declared value gets a currency. Legacy's box was free text with
           * the placeholder "e.g. 50.000 EUR", so the currency lived inside the
           * number; the first rebuild stored a bare numeric, which looks precise
           * and is not — duty is assessed in XAF at a rate on a date.
           */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Declared value"
              required
              hint="The customs value of the cargo — the base duty is assessed on. Usually the supplier-invoice value, and not necessarily in XAF."
            >
              <Input
                type="number"
                min="0"
                step="0.01"
                className="num text-right"
                value={f.declared_value}
                disabled={locked}
                onChange={(e) => set("declared_value", e.target.value)}
              />
            </Field>
            <Field
              label={tr("Currency")}
              hint="From Master data → Currencies."
            >
              <Select
                value={f.declared_currency}
                disabled={locked}
                onChange={(e) => set("declared_currency", e.target.value)}
              >
                {(currencies || []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                    {c.name ? ` — ${c.name}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            {(() => {
              const picked = (currencies || []).find(
                (c) => c.code === (f.declared_currency || "XAF"),
              );
              // An issued order keeps the rate it was frozen with; a draft shows
              // the live derived rate, since that is what save will record.
              const rate = locked
                ? row?.declared_fx_to_xaf ?? null
                : picked?.rate_to_xaf ?? null;
              return (
                <Field
                  label="Rate to XAF"
                  hint={
                    f.declared_currency === "XAF"
                      ? "1 — the value is already in XAF."
                      : locked
                        ? "Frozen when this order was issued."
                        : rate == null
                          ? "No live rate yet — sync it in Master data → Currencies."
                          : `Derived from the live FX rate${picked?.rate_as_of_date ? ` (${picked.rate_as_of_date})` : ""}.`
                  }
                >
                  <Input
                    readOnly
                    tabIndex={-1}
                    className="num cursor-default bg-muted/50 text-right"
                    value={rate == null ? "" : String(rate)}
                    placeholder="—"
                    aria-label="Rate to XAF"
                  />
                </Field>
              );
            })()}
          </div>
        </section>

        {/* ── 3. Liability — printed as a clause the client signs under. ────── */}
        <section className="space-y-3">
          <div className="micro">3 · Liability</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Insurance carried by"
              hint="Prints the “Assurance non couverte…” clause."
            >
              <Select
                value={f.insurance_type}
                disabled={locked}
                onChange={(e) => set("insurance_type", e.target.value)}
              >
                <option value="CLIENT">The client</option>
                <option value="COMPANY">Us</option>
              </Select>
            </Field>
            <Field
              label="Surveyor applied for by"
              hint="Who calls the expert if the cargo is damaged."
            >
              <Select
                value={f.surveyor_party}
                disabled={locked}
                onChange={(e) => set("surveyor_party", e.target.value)}
              >
                <option value="CLIENT">The client</option>
                <option value="COMPANY">Us</option>
              </Select>
            </Field>
          </div>
        </section>

        {/* ── 4. Cargo. Many lines, each with its own value. ────────────────── */}
        {!locked && (
          <section className="space-y-2">
            <div className="micro">4 · Cargo</div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2">
                <Input
                  className="col-span-3"
                  value={l.label}
                  onChange={(e) => setLine(i, { label: e.target.value })}
                  aria-label={`Description, cargo line ${i + 1}`}
                  placeholder="Description (e.g. 30 sacs ciment)"
                />
                <Input
                  className="col-span-2"
                  value={l.marks}
                  onChange={(e) => setLine(i, { marks: e.target.value })}
                  aria-label={`Marks, cargo line ${i + 1}`}
                  placeholder="Marks"
                />
                <Input
                  type="number"
                  min="0"
                  step="any"
                  className="num col-span-2 text-right"
                  value={l.packages}
                  onChange={(e) => setLine(i, { packages: e.target.value })}
                  aria-label={`Packages, cargo line ${i + 1}`}
                  placeholder="Pkgs"
                />
                <Input
                  className="col-span-2"
                  value={l.weight}
                  onChange={(e) => setLine(i, { weight: e.target.value })}
                  aria-label={`Weight, cargo line ${i + 1}`}
                  placeholder={tr("Weight")}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="num col-span-2 text-right"
                  value={l.value_amount}
                  onChange={(e) => setLine(i, { value_amount: e.target.value })}
                  aria-label={`Value, cargo line ${i + 1}`}
                  placeholder={tr("Value")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="col-span-1"
                  aria-label={`Remove cargo line ${i + 1}`}
                  onClick={() =>
                    setLines((s) =>
                      s.length > 1 ? s.filter((_, idx) => idx !== i) : s,
                    )
                  }
                >
                  <XIcon width={16} height={16} />
                </Button>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLines((s) => [...s, blankCargo()])}
              >
                Add cargo
              </Button>
              {linesTotal > 0 && (
                <span
                  className={`num text-xs ${mismatch ? "text-warn" : "text-muted-foreground"}`}
                >
                  Lines total {money(linesTotal)} {f.declared_currency}
                  {mismatch ? ` · declared ${money(declared!)}` : ""}
                </span>
              )}
            </div>
            {mismatch && (
              <Callout tone="warn">
                The cargo lines do not sum to the declared value. That is allowed
                — a declaration may be rounded — but check it is deliberate.
              </Callout>
            )}
          </section>
        )}

        {/* ── 5. The checklist, served by the API, with the file's own documents
               beside it so an operator can look at the invoice/BL they are
               about to tick, rather than ticking blind. ──────────────────── */}
        <section className="space-y-2">
          <div className="micro">5 · Attached documents</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(docTypes || []).map((d) => (
              <Checkbox
                key={d.code}
                checked={docs.has(d.code)}
                disabled={dead}
                onCheckedChange={(on) => toggleDoc(d.code, on)}
                label={`${d.label_en} / ${d.label_fr}`}
              />
            ))}
          </div>
          {f.dossier_id && <DossierDocuments dossierId={f.dossier_id} />}
        </section>

        <Field label="Special instructions">
          <Textarea
            rows={2}
            value={f.instructions}
            disabled={dead}
            onChange={(e) => set("instructions", e.target.value)}
            placeholder="Anything the declarant or the driver must know."
          />
        </Field>

        {error && <ErrorState message={error} />}
        {duplicate && (
          <Callout
            tone="warn"
            title="This file already has a transit order"
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={(e) => submit(e as unknown as React.FormEvent, true)}
              >
                Raise a second anyway
              </Button>
            }
          >
            A consolidation legitimately needs several. Otherwise, re-send the
            existing one rather than quoting customs a second number.
          </Callout>
        )}

        <FormButtons
          busy={busy}
          disabled={dead || busy}
          onCancel={onClose}
          saveLabel={isNew ? "Save draft" : "Save changes"}
        />
      </form>
    </Dialog>
  );
}

/* ── Lifecycle actions ─────────────────────────────────────────────────────── */

/**
 * The status rail. Every control here is derived from `allowed_transitions`, so
 * the UI cannot offer a move the API would reject — the failure the legacy
 * screen had no way to have, because it had no transitions at all.
 */
function OrderActions({
  row,
  onDone,
}: {
  row: api.TransitOrder;
  onDone: () => void;
}) {
  const allowed = new Set(row.allowed_transitions || []);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ask, setAsk] = React.useState<null | "sign" | "lodge" | "cancel">(null);
  const [text, setText] = React.useState("");
  /** The client-signed copy, held until the transition that needs it. */
  const [scan, setScan] = React.useState<File | null>(null);
  const [scanError, setScanError] = React.useState<string | null>(null);
  /** The signatures engine (MOD-64), on this order's own screen. */
  const [signOpen, setSignOpen] = React.useState(false);
  const [sendOpen, setSendOpen] = React.useState(false);
  const entityRef = `transit_order:${row.transit_order_id}`;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAsk(null);
      setText("");
      onDone();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const blockers = row.issue_blockers || [];

  return (
    <div className="space-y-2">
      {error && <ErrorState message={error} />}
      <div className="flex flex-wrap gap-2">
        {allowed.has("ISSUED") && (
          <Button
            size="sm"
            disabled={busy || blockers.length > 0}
            title={
              blockers.length
                ? `Still needed: ${blockers.join(", ")}`
                : "Allocates the OT number and freezes the shipment details."
            }
            onClick={() => run(() => api.issueTransitOrder(row.transit_order_id))}
          >
            Issue &amp; number
          </Button>
        )}
        {allowed.has("SIGNED") && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setAsk("sign")}>
            Record client signature
          </Button>
        )}
        {/*
          * Sign it OURSELVES, through the signatures engine.
          *
          * A different act from "Record client signature" beside it, and the
          * screen has to keep them apart: that one files the scan the CLIENT
          * stamped and moves the order to SIGNED; this one puts OUR
          * countersignature on the document — the approval that prints as the
          * seal in the company box, with the QR that lets anyone holding the
          * paper verify it.
          *
          * Only once the order is numbered. The seal prints the order's own
          * reference as evidence and its hash covers the issued figures, so
          * sealing a draft would attest to a document that does not exist yet
          * and would go stale the moment it was issued.
          */}
        {row.status !== "DRAFT" && row.status !== "CANCELLED" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setSignOpen(true)}>
            Sign electronically
          </Button>
        )}
        {/*
          * Ask the CLIENT to sign it — the external chain.
          *
          * The third of three distinct acts on this rail, and the screen has to
          * keep them apart:
          *   Record client signature  files the scan they stamped by hand
          *   Sign electronically      puts OUR countersignature on the document
          *   Send for signature       emails the client a link to sign it
          *
          * Only once numbered, for the same reason as the countersignature: the
          * chain's hash covers the issued figures and its email names the
          * order's own reference.
          */}
        {row.status !== "DRAFT" && row.status !== "CANCELLED" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setSendOpen(true)}>
            Send for signature
          </Button>
        )}
        {allowed.has("LODGED") && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setAsk("lodge")}>
            Record declaration
          </Button>
        )}
        {allowed.has("CANCELLED") && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsk("cancel")}>
            Cancel order
          </Button>
        )}
      </div>

      {/* Why the Issue button is disabled, in words rather than a silent no-op. */}
      {allowed.has("ISSUED") && blockers.length > 0 && (
        <Callout tone="warn" title="Not ready to issue">
          Still needed: {blockers.join(", ")}.
        </Callout>
      )}

      <ConfirmDialog
        open={ask === "sign"}
        busy={busy}
        onClose={() => setAsk(null)}
        title="Record the client's signature"
        confirmLabel="Record"
        onConfirm={() =>
          run(async () => {
            /*
             * THE SCAN IS UPLOADED HERE, not "attached from the file's documents
             * tab" as this dialog used to claim.
             *
             * That instruction described a route nobody could follow: the API
             * refuses the transition without a `signature_vault_id`, and the
             * only control that could produce one was on another screen — so
             * "Record signature" was a button that could not succeed. The right
             * place to attach the evidence is the moment you are asserting it
             * exists.
             *
             * Uploaded FIRST, then the transition. If the upload fails the order
             * stays ISSUED and nothing is recorded, which is the safe way round:
             * the alternative marks an order signed and then fails to store the
             * proof.
             */
            const doc = await masterApi.uploadVaultDocument({
              data_url: await readFileAsDataUrl(scan!),
              doc_type: "TRANSIT_ORDER_SIGNED",
              entity_ref: `transit_order:${row.transit_order_id}`,
              ...(row.dossier_id ? { dossier_id: row.dossier_id } : {}),
              original_name: scan!.name,
            });
            await api.signTransitOrder(row.transit_order_id, {
              signed_by_name: text || undefined,
              signature_vault_id: doc.doc_id,
            });
            setScan(null);
            setScanError(null);
          })
        }
        confirmDisabled={!scan}
        body={
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Attach the copy the client signed. The signature is the
              authorisation to declare, so a scan is required — a status on its
              own is not evidence.
            </p>
            <Field
              label={tr("Signed copy")}
              required
              error={scanError || undefined}
              hint="PDF or a photo of the stamped page."
            >
              <input
                type="file"
                accept={SCAN_ACCEPT}
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  // Refused against the vault's own limits BEFORE the file is
                  // base64-inflated and pushed over the wire — a 25 MB scan on a
                  // Douala connection is a long wait for a rejection.
                  const problem = file ? scanFileProblem(file) : null;
                  setScanError(problem);
                  setScan(problem ? null : file);
                  if (problem) e.target.value = "";
                }}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label={tr("Signed by")}>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Name on the client's stamp"
              />
            </Field>
          </div>
        }
      />

      <ConfirmDialog
        open={ask === "lodge"}
        busy={busy}
        onClose={() => setAsk(null)}
        title="Record the customs declaration"
        confirmLabel="Record"
        onConfirm={() => run(() => api.lodgeTransitOrder(row.transit_order_id, text))}
        body={
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              This closes the file's “transit declaration lodged” milestone. The
              order becomes final.
            </p>
            <Field label="Declaration reference" required>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. D-4471/2026"
              />
            </Field>
          </div>
        }
      />

      <ConfirmDialog
        open={ask === "cancel"}
        busy={busy}
        destructive
        onClose={() => setAsk(null)}
        title="Cancel this transit order"
        confirmLabel="Cancel order"
        cancelLabel="Keep it"
        onConfirm={() => run(() => api.cancelTransitOrder(row.transit_order_id, text))}
        body={
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              The OT number is retained and never re-used, so the reason is what
              explains the gap in the sequence later.
            </p>
            <Field label={tr("Reason")} required>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Client withdrew the booking"
              />
            </Field>
          </div>
        }
      />

      <SignDocumentModal
        open={signOpen}
        entityRef={entityRef}
        docType="TRANSIT_ORDER"
        onClose={() => setSignOpen(false)}
        onSaved={onDone}
      />

      <SendForSignatureModal
        open={sendOpen}
        entityRef={entityRef}
        docType="TRANSIT_ORDER"
        onClose={() => setSendOpen(false)}
        onSent={onDone}
      />
    </div>
  );
}

/* ── The detail drawer ─────────────────────────────────────────────────────── */

function OrderDetail({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, error, reload } = useResource(() => api.getTransitOrder(id), [id]);
  const [editing, setEditing] = React.useState(false);

  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const refresh = () => {
    void reload();
    onChanged();
  };

  if (editing) {
    return (
      <TransitForm
        row={data}
        onClose={() => setEditing(false)}
        onSaved={refresh}
      />
    );
  }

  const t = data.totals;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={data.ref || "Transit order (draft)"}
      description={data.dossier_ref ? `File ${data.dossier_ref}` : undefined}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={statusTone(data.status)}>{data.status}</Pill>
          <span className="text-xs text-muted-foreground">
            {STATUS_HINT[data.status]}
          </span>
        </div>

        <OrderActions row={data} onDone={refresh} />

        {/*
         * Which facts the reader is looking at. A document that cannot say
         * whether it is current or historic is exactly how the legacy reprint
         * problem went unnoticed for years.
         */}
        {data.shipment_details_source === "SNAPSHOT" && (
          <Callout tone="info" title="Shows what was agreed">
            These shipment details are the copy frozen when the order was issued,
            not the file as it stands today.
          </Callout>
        )}

        {data.dossier_id && (
          <ShipmentDetailsPanel
            data={data.shipment_details || undefined}
            dossierId={data.shipment_details ? undefined : data.dossier_id}
            title={tr("Shipment")}
          />
        )}

        <Panel title="Instruction">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Fact label={tr("Direction")} value={data.service_direction} />
            <Fact
              label="Regime"
              value={data.customs_regime || data.customs_regime_other}
            />
            <Fact
              label="Declared"
              value={
                t?.declared_value != null
                  ? `${money(t.declared_value)} ${data.declared_currency || ""}`
                  : null
              }
            />
            <Fact
              label="In XAF"
              value={
                data.declared_currency !== "XAF" && t?.declared_value_xaf != null
                  ? money(t.declared_value_xaf)
                  : null
              }
            />
            <Fact label="Departure" value={data.departure_date} />
            <Fact
              label={tr("Insurance")}
              value={data.insurance_type === "COMPANY" ? "Us" : "Client"}
            />
            <Fact
              label={tr("Surveyor")}
              value={data.surveyor_party === "COMPANY" ? "Us" : "Client"}
            />
            <Fact label={tr("Declaration")} value={data.declaration_ref} />
          </dl>
        </Panel>

        <Panel title="Cargo">
          {data.lines?.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="micro text-left text-muted-foreground">
                  <th className="pb-1">{tr("Description")}</th>
                  <th className="pb-1">Marks</th>
                  <th className="pb-1 text-right">Pkgs</th>
                  <th className="pb-1 text-right">{tr("Weight")}</th>
                  <th className="pb-1 text-right">{tr("Value")}</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l) => (
                  <tr key={l.transit_order_line_id || l.label} className="border-t border-border">
                    <td className="py-1">{l.label}</td>
                    <td className="py-1 text-muted-foreground">{l.marks || "—"}</td>
                    <td className="num py-1 text-right">{num(Number(l.packages || 0))}</td>
                    <td className="num py-1 text-right">{l.weight || "—"}</td>
                    <td className="num py-1 text-right">
                      {l.value_amount != null ? money(l.value_amount) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No cargo lines.</p>
          )}
          {t && !t.reconciles && (
            <Callout tone="warn" className="mt-2">
              Lines total {money(t.lines_total)} against a declared{" "}
              {money(t.declared_value || 0)}.
            </Callout>
          )}
        </Panel>

        {/*
         * What is already attested on this order, and by whom.
         *
         * `SignaturesOnRecord` renders nothing when the tenant has signatures
         * switched off or when nothing has been signed, so the panel only
         * appears once there is something in it — a record screen must not
         * sprout an empty section for a feature its tenant never bought.
         */}
        {/*
         * Who was ASKED (the chain) and who HAS signed (the signatures). Two
         * panels because they answer different questions — a request that is
         * PARTIALLY_SIGNED with one signature on the document is the normal
         * mid-chain state, and either view alone reads as a fault. Both hide
         * themselves when there is nothing to show.
         */}
        <SignatureChainOnRecord
          entityRef={`transit_order:${data.transit_order_id}`}
          title={tr("Out for signature")}
        />
        <SignaturesOnRecord
          entityRef={`transit_order:${data.transit_order_id}`}
          title={tr("Signatures on this order")}
        />

        <div className="flex justify-end gap-2">
          {data.status !== "LODGED" && data.status !== "CANCELLED" && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          <DocButton
            docType="TRANSIT_ORDER"
            id={data.transit_order_id}
            title={data.ref || "Transit order"}
            label="View document"
          />
        </div>
      </div>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="micro text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium text-foreground">{value || "—"}</dd>
    </div>
  );
}

/* ── The list ──────────────────────────────────────────────────────────────── */

export function TransitOrdersPage() {
  const [status, setStatus] = React.useState<string>("");
  const { rows, error, loading, reload } = useList<api.TransitOrder>(
    `/transit-orders${status ? `?status=${status}` : ""}`,
  );
  // Counted in the database. The tiles used to filter the loaded page in
  // JavaScript, which reads "3 import" on a tenant with four hundred orders.
  const { data: counts, reload: reloadCounts } = useResource(
    () => api.transitOrderSummary(),
    [],
  );
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const [creating, setCreating] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const dref = nameMap(dossiers, "dossier_id", "ref");

  const refresh = () => {
    reload();
    void reloadCounts();
  };

  const columns: Column<api.TransitOrder>[] = [
    {
      key: "ref",
      label: "OT number",
      render: (r) =>
        r.ref ? (
          <span className="num font-medium text-foreground">{r.ref}</span>
        ) : (
          // A draft genuinely has no number — saying so beats printing eight
          // characters of a UUID that looks like one.
          <span className="text-muted-foreground">Not yet numbered</span>
        ),
    },
    {
      key: "dossier_id",
      label: "File",
      render: (r) => r.dossier_ref || (r.dossier_id ? dref[r.dossier_id] : null) || "—",
    },
    { key: "client_name", label: "Client", render: (r) => r.client_name || "—" },
    {
      key: "customs_regime",
      label: "Regime",
      render: (r) =>
        r.customs_regime || r.customs_regime_other ? (
          <Pill tone="mute">{r.customs_regime || r.customs_regime_other}</Pill>
        ) : (
          "—"
        ),
    },
    { key: "service_direction", label: "Direction" },
    {
      key: "declared_value",
      label: "Declared value",
      className: "num text-right",
      render: (r) =>
        r.declared_value == null
          ? "—"
          : `${money(r.declared_value)} ${r.declared_currency || ""}`,
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill>,
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end">
          <DocButton
            docType="TRANSIT_ORDER"
            id={r.transit_order_id}
            title={r.ref || `Transit order ${r.transit_order_id.slice(0, 8)}`}
            label={tr("View")}
          />
        </div>
      ),
    },
  ];

  return (
    <ListPage<api.TransitOrder>
      eyebrow={<HubCrumb area="Operations" to="/operations" />}
      title={tr("Transit orders")}
      description="The client's written authorisation to declare their cargo."
      action={<Button onClick={() => setCreating(true)}>New order</Button>}
      tabs={<HubTabs />}
      kpis={
        <KpiRow>
          {/*
           * The lifecycle, as tiles that filter. "Awaiting signature" is the
           * number anyone running this desk actually chases — the legacy screen
           * could not have shown it, because it did not record signatures.
           */}
          <KpiTile
            label="All orders"
            value={num(counts?.TOTAL ?? 0)}
            onClick={() => setStatus("")}
          />
          <KpiTile
            label={tr("Drafts")}
            value={num(counts?.DRAFT ?? 0)}
            onClick={() => setStatus("DRAFT")}
          />
          <KpiTile
            label="Awaiting signature"
            value={num(counts?.ISSUED ?? 0)}
            onClick={() => setStatus("ISSUED")}
          />
          <KpiTile
            label="Ready to lodge"
            value={num(counts?.SIGNED ?? 0)}
            onClick={() => setStatus("SIGNED")}
          />
          <KpiTile
            label="Lodged"
            value={num(counts?.LODGED ?? 0)}
            onClick={() => setStatus("LODGED")}
          />
        </KpiRow>
      }
      columns={columns}
      rows={rows}
      error={error}
      loading={loading}
      rowKey={(r) => r.transit_order_id}
      onRowClick={(r) => setOpenId(r.transit_order_id)}
      empty={{
        title: status ? `No ${status.toLowerCase()} orders` : "No transit orders",
        hint: "Raise a transit order against a file to authorise a customs declaration.",
        action: <Button onClick={() => setCreating(true)}>New order</Button>,
      }}
    >
      {creating && (
        <TransitForm
          row={null}
          onClose={() => setCreating(false)}
          onSaved={refresh}
        />
      )}
      {openId && (
        <OrderDetail
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      )}
      <ScreenAi path="operations/transit-orders" />
    </ListPage>
  );
}
