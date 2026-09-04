/**
 * Create / edit a transit order.
 *
 * Split out of `transit-orders.tsx` when the detail view became a 360 with its
 * own route: that file held a list, a 600-line form and a 190-line drawer, and
 * the 360 needs the form (Edit opens it in place) while the list needs the 360.
 * One file importing the other both ways is a cycle; three files with one job
 * each is not. Same shape as `operation-files.tsx` / `dossier-form.tsx`.
 *
 * ── WHAT THIS FORM IS FOR ───────────────────────────────────────────────────
 * It is built around a FILE SEARCH, which is the one thing the legacy screen
 * (`view/operations/transit-order.php`) got right and the first rebuild lost.
 * You pick the operations file and the whole shipment block fills itself in
 * read-only; the operator's job is the three or four DECISIONS the order
 * records, not retyping facts the system already holds. The panel comes from
 * the shared `ShipmentDetailsPanel`, so it works on any service type rather
 * than the legacy's sea/air `if`.
 *
 * The OT number is NOT rendered here. The legacy form allocated one on page
 * load, so abandoning the form burned a number; here the number appears only
 * once the order is issued, and the form says so.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { FormButtons } from "@/components/ui/form-buttons";
import { ErrorState } from "@/components/ui/states";
import { Callout } from "@/components/ui/callout";
import { Pill } from "@/components/ui/pill";
import { XIcon } from "@/components/ui/icons";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { money } from "@/lib/format";
import type { Entity } from "@/lib/masterdata-api";
import * as api from "@/lib/operations-api";
import { cn } from "@/lib/cn";
import { ShipmentDetailsPanel } from "./shipment-details";
import { DossierDocuments } from "./components";
import { transitTone, TRANSIT_STATUS_HINT } from "./shared";

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

export function TransitForm({
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
            <Pill tone={transitTone(row!.status)}>{row!.status}</Pill>
            <span className="text-xs text-muted-foreground">
              {TRANSIT_STATUS_HINT[row!.status]}
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
