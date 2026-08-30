/**
 * Commercial — margin simulations (§3.1 rebuild).
 *
 * A simulation is deliberately NOT a quotation: it is the workings, kept so a
 * price can be defended later without re-deriving it. The rebuilt screen
 * restores what the legacy page had and ours lacked:
 *
 *  - LINK COSTING — the point of the screen. Pick the file's costing and its
 *    lines import as the cost base (converted at the costing's own rate,
 *    never a hardcoded FX number). Cost the file, then price it.
 *  - Financial-dictionary items per line (not free text only).
 *  - Per-line MARGIN + KPI — how a pricer finds which line kills the deal.
 *  - Per-line VAT toggle + notes.
 *  - GLOBAL MARGIN with a CRITICAL badge, VAT and TTC in the totals.
 *  - DRAFT → Submit → Approve/Reject workflow, and "Create quotation" from an
 *    APPROVED simulation.
 *  - Saved simulations are CLICKABLE — GET /margin-simulations/:id finally
 *    has a caller.
 */

import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Modal, Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import {
  errMsg,
  useList,
  useRefresh,
  useResource,
  type Row,
} from "@/lib/use-resource";
import { cell, dateFmt, money } from "@/lib/format";
import { Stat } from "@/components/ui/stat";
import { MeterGroup } from "@/components/ui/meter";
import { Pill, StatusPill, type Tone } from "@/components/ui/pill";
import { DictionaryFinder } from "@/components/dictionary-finder";
import { listCurrencies } from "@/lib/masterdata-api";
import type { Dossier } from "@/lib/operations-api";
import { usePrompt } from "@/components/ui/use-prompt";

const MARGIN_AI: AiAction[] = [
  {
    label: "Suggest pricing",
    kind: "assist",
    describe:
      "Suggest unit prices to hit a target margin on the service lines.",
  },
  {
    label: "Price from costing",
    kind: "read",
    describe:
      "Import a costing's lines as the cost base for a new simulation.",
  },
];

type MLine = {
  dictionary_item_id: string | null;
  label: string;
  qty: string;
  unit_cost: string;
  unit_price: string;
  is_disbursement: boolean;
  vat_applicable: boolean;
  notes: string;
};

const BLANK: MLine = {
  dictionary_item_id: null,
  label: "",
  qty: "1",
  unit_cost: "0",
  unit_price: "0",
  is_disbursement: false,
  vat_applicable: false,
  notes: "",
};

/**
 * The server's low-margin refusal (§2.5), told apart from any other 422 so the
 * screen can ask for a reason instead of just printing the error. Matched on
 * the error CODE, not its message — the message names the actual figures and is
 * translated.
 */
function isLowMargin(e: unknown): boolean {
  const c = e as { code?: string; body?: { code?: string; error?: string } } | null;
  return (
    c?.code === "LOW_MARGIN_JUSTIFICATION_REQUIRED" ||
    c?.body?.code === "LOW_MARGIN_JUSTIFICATION_REQUIRED" ||
    c?.body?.error === "LOW_MARGIN_JUSTIFICATION_REQUIRED" ||
    /LOW_MARGIN_JUSTIFICATION_REQUIRED/.test(errMsg(e))
  );
}

/** Editor-side line margin. The saved view shows the server's economics; this
 *  is the live feedback while typing (same formula, default bands). */
function lineKpi(l: MLine): { text: string; tone: Tone } {
  if (l.is_disbursement) return { text: tr("Pass-through"), tone: "mute" };
  const qty = Number(l.qty) || 1;
  const cost = (Number(l.unit_cost) || 0) * qty;
  const price = (Number(l.unit_price) || 0) * qty;
  const pct = price > 0 ? Math.round(((price - cost) / price) * 10000) / 100 : cost > 0 ? -100 : 0;
  const kpi = pct >= 20 ? "GOOD" : pct >= 10 ? "FAIR" : "POOR";
  return {
    text: `${kpi} (${pct}%)`,
    tone: kpi === "GOOD" ? "ok" : kpi === "FAIR" ? "warn" : "bad",
  };
}

/**
 * PROFITABILITY SNAPSHOT — the legacy screen's live picture, restored.
 *
 * `updateSnapshot()` (margin-simulator-billing.php:2155-2192) redrew Cost / Rev
 * / Net on every keystroke, so a pricer watched the Net bar grow as they
 * priced. Ours showed six flat figures and no shape at all, which is why
 * SBX-2026-0001 — 95.7M of cost against nothing — looked like an ordinary row
 * of numbers instead of the cliff it is.
 *
 * Everything here is already on the response: the server returns the totals and
 * the service/disbursement split. Nothing is recomputed.
 *
 * Bars share one scale, so Net is read against Cost rather than stretched to
 * fill its own track. Colour by job: cost is context (neutral), revenue is the
 * brand figure, net is genuine state — and its sign is also in the number and
 * the badge beside it, never colour alone.
 */
function ProfitabilitySnapshot({
  totals,
  currency,
}: {
  totals: Row;
  currency: string;
}) {
  const cost = Number(totals.total_cost) || 0;
  const revenue = Number(totals.total_price) || 0;
  const net = Number(totals.margin_amount) || 0;
  const pct = totals.margin_percent != null ? Number(totals.margin_percent) : null;
  const disbursement = Number(totals.disbursement_total) || 0;
  return (
    <div className="lux-card space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-micro uppercase text-muted-foreground">
          {tr("Profitability snapshot")}
        </p>
        {pct != null && (
          <Pill tone={pct >= 20 ? "ok" : pct >= 10 ? "warn" : "bad"}>
            {`${tr("Global margin")} ${pct}%${pct < 10 ? ` · ${tr("CRITICAL")}` : ""}`}
          </Pill>
        )}
      </div>
      <MeterGroup
        // Not wrapped in tr(): the extractor needs static keys, and this string
        // is figures. The words around them are already translated labels.
        ariaLabel={`${tr("Cost")} ${cost}, ${tr("Revenue")} ${revenue}, ${tr("Net")} ${net} ${currency} — ${pct ?? 0}%`}
        rows={[
          {
            label: tr("Cost"),
            value: cost,
            display: money(cost, currency),
            tone: "neutral",
            // Margin is earned on services only, so say how much of the cost is
            // pass-through — otherwise a débours-heavy file looks unprofitable.
            hint: disbursement
              ? `${tr("incl. débours")} ${money(disbursement, currency)}`
              : undefined,
          },
          {
            label: tr("Revenue"),
            value: revenue,
            display: money(revenue, currency),
            tone: "accent",
          },
          {
            label: tr("Net"),
            value: net,
            display: money(net, currency),
            tone: net > 0 ? "ok" : net < 0 ? "bad" : "warn",
          },
        ]}
      />
    </div>
  );
}

/**
 * Target margin → price (§2.4b). The server already exposes this maths as
 * `priceForMargin`; the screen had no control that used it, so a pricer typed
 * prices in and hoped. price = cost / (1 - margin/100), same formula, applied
 * to the SERVICE lines only — a débours is pass-through and priced at cost by
 * definition, so marking one up is not a pricing decision, it is an error.
 */
function priceForMargin(cost: number, marginPercent: number): number {
  if (!Number.isFinite(cost) || cost < 0) return 0;
  if (!Number.isFinite(marginPercent) || marginPercent < 0 || marginPercent >= 100) return cost;
  return Math.round((cost / (1 - marginPercent / 100)) * 100) / 100;
}

function MarginSimForm({
  open,
  onClose,
  onSaved,
  editing = null,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /**
   * The simulation being edited (§2.4a), or null to create a new one. Editing
   * used to be impossible — there was no endpoint — so a mistyped price meant
   * abandoning the document and building it again. DRAFT and REJECTED only;
   * the detail screen decides which, and the server refuses the rest.
   */
  editing?: Row | null;
}) {
  const [currency, setCurrency] = React.useState("XAF");
  // Currencies come from the live currency module (GET /currencies), not a
  // free-text box — the column is char(3) REFERENCES currency(code), so a
  // typo used to surface as a raw FK violation (SS4).
  const currencies = useResource(() => listCurrencies(), []);
  // Code in `label`, name in `hint` — Radix clones ItemText into the closed
  // trigger, so a name in the label wraps the collapsed control (it did exactly
  // that on the extra-charge rail). The picker still names the currency.
  const currencyOptions = (currencies.data || [])
    .filter((c) => c.is_active !== false)
    .map((c) => ({ value: c.code, label: c.code, hint: c.name || undefined }));

  // Header context: the file, and the costing to price from.
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [dossierId, setDossierId] = React.useState("");
  const [costingId, setCostingId] = React.useState("");
  const [linking, setLinking] = React.useState(false);
  const [prompt, promptDialog] = usePrompt();
  const costings = useResource<{ data?: Row[] } | Row[]>(
    () =>
      dossierId
        ? tenant<Row[]>(`/costings?dossier_id=${encodeURIComponent(dossierId)}`)
        : Promise.resolve([]),
    [dossierId],
  );
  const costingRows = Array.isArray(costings.data) ? costings.data : [];

  const [lines, setLines] = React.useState<MLine[]>([{ ...BLANK }]);
  const [totals, setTotals] = React.useState<Row | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // §2.4a — unclassified lines from an import. The catalogue is the SSOT for
  // cost nature; a line with no catalogue entry only has a copied flag, and the
  // screen should say so rather than imply the classification is known.
  const [unclassified, setUnclassified] = React.useState<string[]>([]);
  const [target, setTarget] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setUnclassified([]);
    setTarget("");
    setError(null);
    if (editing) {
      setCurrency(String(editing.currency || "XAF"));
      setDossierId(editing.dossier_id ? String(editing.dossier_id) : "");
      setCostingId(editing.costing_id ? String(editing.costing_id) : "");
      const existing = (editing.lines as Row[] | undefined) || [];
      setLines(
        existing.length
          ? existing.map((l) => ({
              dictionary_item_id: l.dictionary_item_id ? String(l.dictionary_item_id) : null,
              label: String(l.label || ""),
              qty: String(l.qty ?? "1"),
              unit_cost: String(l.unit_cost ?? "0"),
              unit_price: String(l.unit_price ?? "0"),
              is_disbursement: l.is_disbursement === true,
              vat_applicable: l.vat_applicable === true,
              notes: String(l.notes || ""),
            }))
          : [{ ...BLANK }],
      );
      setTotals((editing.totals as Row | undefined) || null);
      return;
    }
    setCurrency("XAF");
    setDossierId("");
    setCostingId("");
    setLines([{ ...BLANK }]);
    setTotals(null);
  }, [open, editing]);

  const setLine = (i: number, patch: Partial<MLine>) =>
    setLines((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const payloadLines = () =>
    lines
      .filter(
        (l) => l.label.trim() || Number(l.unit_price) || Number(l.unit_cost),
      )
      .map((l) => ({
        dictionary_item_id: l.dictionary_item_id || undefined,
        label: l.label.trim() || "Line",
        qty: Number(l.qty) || 1,
        unit_cost: Number(l.unit_cost) || 0,
        unit_price: Number(l.unit_price) || 0,
        is_disbursement: l.is_disbursement,
        vat_applicable: l.vat_applicable,
        notes: l.notes.trim() || undefined,
      }));

  /** LINK COSTING — import the costing's lines as the cost base. */
  async function linkCosting(id: string) {
    setCostingId(id);
    if (!id) return;
    setLinking(true);
    setError(null);
    try {
      const out = await tenant<{
        costing: Row;
        unclassified?: string[];
        lines: {
          dictionary_item_id: string | null;
          label: string;
          qty: number;
          unit_cost: number;
          is_disbursement: boolean;
          vat_applicable: boolean;
        }[];
      }>(`/margin-simulations/from-costing/${id}`);
      setUnclassified(out.unclassified || []);
      setLines(
        out.lines.length
          ? out.lines.map((l) => ({
              dictionary_item_id: l.dictionary_item_id,
              label: l.label,
              qty: String(l.qty),
              unit_cost: String(l.unit_cost),
              unit_price: "0",
              is_disbursement: l.is_disbursement,
              vat_applicable: l.vat_applicable,
              notes: "",
            }))
          : [{ ...BLANK }],
      );
      setTotals(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLinking(false);
    }
  }

  async function preview() {
    setPreviewing(true);
    setError(null);
    try {
      const t = await tenant<Row>("/margin-simulations/preview", {
        method: "POST",
        body: { lines: payloadLines() },
      });
      setTotals(t);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPreviewing(false);
    }
  }

  async function save(andSubmit: boolean) {
    setBusy(true);
    setError(null);
    try {
      const body = {
        dossier_id: dossierId || undefined,
        costing_id: costingId || undefined,
        currency: currency.trim().toUpperCase() || "XAF",
        lines: payloadLines(),
      };
      // §2.4a — PATCH an existing DRAFT/REJECTED, POST a new one. Editing a
      // REJECTED simulation returns it to DRAFT server-side, which is what
      // makes acting on a rejection possible at all.
      const id = editing
        ? String(editing.margin_simulation_id)
        : (
            await tenant<{ margin_simulation_id: string }>("/margin-simulations", {
              method: "POST",
              body,
            })
          ).margin_simulation_id;
      if (editing) {
        await tenant(`/margin-simulations/${id}`, { method: "PATCH", body });
      }
      if (andSubmit) {
        // §2.5 — submitting at or below cost needs a written reason. Ask for it
        // only when the server says so, rather than nagging on every healthy
        // deal: the server owns the threshold and the maths.
        try {
          await tenant(`/margin-simulations/${id}/submit`, { method: "POST" });
        } catch (e) {
          if (!isLowMargin(e)) throw e;
          // The 10-character minimum is now enforced BY THE DIALOG rather than
          // after it: the old prompt accepted anything, and a too-short answer
          // was punished with an error and a lost draft. `usePrompt` disables
          // the submit button until the justification is long enough.
          const why = await prompt({
            title: tr("Priced at or below cost"),
            description: tr(
              "This is priced at or below cost. Why is it being submitted? The approver reads this.",
            ),
            label: tr("Justification"),
            hint: tr("At least 10 characters."),
            multiline: true,
            confirmLabel: tr("Submit for approval"),
            validate: (v) =>
              v.trim().length < 10
                ? tr("At least 10 characters.")
                : null,
          });
          if (why === null) {
            // Cancelled. The draft is already saved, so nothing is lost —
            // say so rather than leaving the screen silent.
            setError(
              tr(
                "Not submitted — a justification is required below cost. The draft has been saved.",
              ),
            );
            onSaved();
            return;
          }
          await tenant(`/margin-simulations/${id}/submit`, {
            method: "POST",
            body: { justification: why },
          });
        }
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  /** Apply a target margin to every SERVICE line (débours stay at cost). */
  function applyTarget() {
    const pct = Number(target);
    if (!Number.isFinite(pct) || pct < 0 || pct >= 100) return;
    setLines((rs) =>
      rs.map((l) =>
        l.is_disbursement
          ? { ...l, unit_price: l.unit_cost }
          : { ...l, unit_price: String(priceForMargin(Number(l.unit_cost) || 0, pct)) },
      ),
    );
    setTotals(null);
  }

  const globalPct =
    totals && totals.margin_percent != null
      ? Number(totals.margin_percent)
      : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? tr("Edit margin simulation") : tr("Margin simulation")}
      description="Rapid quote maths — margin on services only, débours pass-through. No GL (KB §6.7)."
      size="wide"
    >
      {promptDialog}
      <div className="space-y-4">
        {/* Header: the file and its costing — cost the file, then price it. */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={tr("Dossier")} hint="The file being priced">
            <Select
              value={dossierId}
              onValueChange={(v) => {
                setDossierId(v);
                setCostingId("");
              }}
              options={[
                { value: "", label: "— ad-hoc —" },
                ...(dossiers || []).map((d) => ({
                  value: d.dossier_id,
                  label: d.ref,
                })),
              ]}
              aria-label={tr("Dossier")}
            />
          </Field>
          <Field
            label={tr("Link costing")}
            hint="Imports the costing's lines as the cost base"
          >
            <Select
              value={costingId}
              onValueChange={(v) => void linkCosting(v)}
              options={[
                { value: "", label: dossierId ? "— none —" : "Pick a dossier first" },
                ...costingRows.map((c) => ({
                  value: String(c.costing_id),
                  label: `${cell(c.doc_number ?? String(c.costing_id).slice(0, 8))} · ${cell(c.status)}`,
                })),
              ]}
              aria-label={tr("Link costing")}
            />
          </Field>
          <Field label={tr("Currency")}>
            <Select
              value={currency}
              onValueChange={setCurrency}
              options={currencyOptions}
              aria-label={tr("Currency")}
            />
          </Field>
        </div>
        {linking && (
          <p className="micro" role="status">
            {tr("Importing costing lines…")}
          </p>
        )}
        {unclassified.length > 0 && (
          <p className="micro text-[rgb(var(--warn))]" role="status">
            {tr("Not in the charge catalogue, so their cost nature is only a copied flag — check before pricing")}
            {": "}
            {unclassified.join(", ")}
          </p>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{tr("Lines")}</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLines((l) => [...l, { ...BLANK }])}
            >
              {tr("Add ad-hoc line (financial dictionary)")}
            </Button>
          </div>
          <div className="space-y-3">
            {lines.map((l, i) => {
              const kpi = lineKpi(l);
              return (
                <div key={i} className="lux-card space-y-2 p-3">
                  <div className="grid items-end gap-2 sm:grid-cols-[minmax(10rem,1fr)_4rem_7rem_7rem_auto]">
                    <DictionaryFinder
                      id={`msim-line-${i}`}
                      value={l.dictionary_item_id}
                      valueLabel={l.label || null}
                      onPick={(id, label) =>
                        setLine(i, { dictionary_item_id: id, label })
                      }
                      label={tr("Item")}
                    />
                    <Field label={tr("Qty")}>
                      <Input
                        type="number"
                        min="0"
                        className="num text-right"
                        value={l.qty}
                        onChange={(e) => setLine(i, { qty: e.target.value })}
                      />
                    </Field>
                    <Field label={tr("Unit cost")}>
                      <Input
                        type="number"
                        min="0"
                        className="num text-right"
                        value={l.unit_cost}
                        onChange={(e) =>
                          setLine(i, { unit_cost: e.target.value })
                        }
                      />
                    </Field>
                    <Field label={tr("Unit price")}>
                      <Input
                        type="number"
                        min="0"
                        className="num text-right"
                        value={l.unit_price}
                        onChange={(e) =>
                          setLine(i, { unit_price: e.target.value })
                        }
                      />
                    </Field>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={tr("Remove line")}
                      onClick={() =>
                        setLines((rs) =>
                          rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs,
                        )
                      }
                    >
                      ✕
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={l.is_disbursement}
                        onChange={(e) =>
                          setLine(i, { is_disbursement: e.target.checked })
                        }
                      />
                      {tr("Débours")}
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={l.vat_applicable}
                        disabled={l.is_disbursement}
                        onChange={(e) =>
                          setLine(i, { vat_applicable: e.target.checked })
                        }
                      />
                      {tr("VAT")}
                    </label>
                    <Pill tone={kpi.tone}>{kpi.text}</Pill>
                    <div className="min-w-40 flex-1">
                      <Input
                        value={l.notes}
                        onChange={(e) => setLine(i, { notes: e.target.value })}
                        placeholder={tr("Notes")}
                        aria-label={tr("Line notes")}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={preview} loading={previewing}>
            {tr("Preview")}
          </Button>
          {/* §2.4b — the screen proposes a price instead of seeding zero. */}
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="0"
              max="99"
              className="num w-20 text-right"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="20"
              aria-label={tr("Target margin %")}
            />
            <Button size="sm" variant="outline" onClick={applyTarget}>
              {tr("Price at target margin %")}
            </Button>
          </div>
          {globalPct != null && (
            <Pill tone={globalPct >= 20 ? "ok" : globalPct >= 10 ? "warn" : "bad"}>
              {globalPct < 10 ? `CRITICAL · ${globalPct}%` : `GLOBAL MARGIN ${globalPct}%`}
            </Pill>
          )}
        </div>

        {totals && <ProfitabilitySnapshot totals={totals} currency={currency} />}

        {totals && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat
              label={tr("Total cost")}
              value={money(totals.total_cost, currency)}
            />
            <Stat
              label="Total price"
              value={money(totals.total_price, currency)}
            />
            <Stat
              label="Margin"
              value={money(totals.margin_amount, currency)}
              tone="accent"
            />
            <Stat
              label={tr("Margin %")}
              value={
                totals.margin_percent != null
                  ? `${cell(totals.margin_percent)}%`
                  : "—"
              }
              tone="accent"
            />
            <Stat label="VAT" value={money(totals.vat_total, currency)} />
            <Stat
              label="Total TTC"
              value={money(totals.total_ttc, currency)}
            />
          </div>
        )}

        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => save(false)} loading={busy}>
            {editing ? tr("Save changes") : tr("Save draft")}
          </Button>
          <Button onClick={() => save(true)} loading={busy}>
            {tr("Save and submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Saved simulation detail — clickable at last ─────────────────────────── */

type SimLineRow = Row & {
  economics?: {
    margin_percent: number | null;
    margin_amount: number;
    kpi: string;
  };
};

function kpiTone(kpi: string | undefined): Tone {
  if (kpi === "GOOD") return "ok";
  if (kpi === "FAIR") return "warn";
  if (kpi === "POOR") return "bad";
  return "mute";
}

function SimDetail({
  id,
  dossierRef,
  onClose,
  onChanged,
  onEdit,
}: {
  id: string;
  dossierRef: Map<string, string>;
  onClose: () => void;
  onChanged: () => void;
  /** §2.4a — reopen this simulation in the editor. */
  onEdit: (sim: Row) => void;
}) {
  const sim = useResource<Row | null>(
    () => tenant<Row>(`/margin-simulations/${id}`),
    [id],
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rejectReason, setRejectReason] = React.useState("");
  const [rejecting, setRejecting] = React.useState(false);
  const [prompt, promptDialog] = usePrompt();
  const s = sim.data;

  async function act(path: string, body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await tenant(`/margin-simulations/${id}/${path}`, {
        method: "POST",
        body,
      });
      sim.reload();
      onChanged();
      return true;
    } catch (e) {
      // §2.5 — the one refusal the screen can answer rather than just report.
      if (path === "submit" && isLowMargin(e)) {
        const why = await prompt({
          title: tr("Priced at or below cost"),
          description: tr(
            "This is priced at or below cost. Why is it being submitted? The approver reads this.",
          ),
          label: tr("Justification"),
          hint: tr("At least 10 characters."),
          multiline: true,
          confirmLabel: tr("Submit for approval"),
          validate: (v) =>
            v.trim().length < 10 ? tr("At least 10 characters.") : null,
        });
        if (why) {
          setBusy(false);
          return act("submit", { justification: why });
        }
        setError(
          tr(
            "Submitting at or below cost needs a written justification of at least 10 characters.",
          ),
        );
        return false;
      }
      setError(errMsg(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const lines = ((s?.lines as SimLineRow[] | undefined) || []).map((l) => l);
  const totals = (s?.totals as Row | undefined) || null;
  const currency = s ? String(s.currency || "XAF") : "XAF";

  const lineColumns: Column<SimLineRow>[] = [
    {
      key: "label",
      label: "Item",
      render: (l) => (
        <span className="font-medium text-foreground">
          {cell(l.label)}
          {l.notes ? (
            <span className="ml-2 text-xs text-muted-foreground">
              {cell(l.notes)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "qty",
      label: "Qty",
      className: "num text-right",
      render: (l) => cell(l.qty),
    },
    {
      key: "unit_cost",
      label: "Unit cost",
      className: "num text-right",
      render: (l) => money(l.unit_cost, currency),
    },
    {
      key: "unit_price",
      label: "Unit price",
      className: "num text-right",
      render: (l) => money(l.unit_price, currency),
    },
    {
      key: "margin",
      label: "Margin",
      className: "num text-right",
      render: (l) =>
        l.economics && l.economics.margin_percent != null
          ? `${money(l.economics.margin_amount, currency)} (${l.economics.margin_percent}%)`
          : "—",
    },
    {
      key: "kpi",
      label: "KPI",
      render: (l) =>
        l.economics ? (
          <Pill tone={kpiTone(l.economics.kpi)}>{l.economics.kpi}</Pill>
        ) : (
          "—"
        ),
    },
    {
      key: "vat",
      label: "VAT",
      render: (l) => (l.vat_applicable ? tr("Yes") : "—"),
    },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={
        s?.dossier_id
          ? (dossierRef.get(String(s.dossier_id)) ??
            `Dossier ${String(s.dossier_id).slice(0, 8)}`)
          : tr("Ad-hoc simulation")
      }
      description="The saved workings — per-line margin and KPI, VAT, and the approval trail."
      size="wide"
    >
      {promptDialog}
      {sim.error ? (
        <ErrorState message={sim.error} />
      ) : !s ? null : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={String(s.status || "DRAFT")} />
            {s.costing_id ? (
              <Pill tone="blue">{tr("Linked to costing")}</Pill>
            ) : null}
            {s.quotation_id ? <Pill tone="ok">{tr("Quoted")}</Pill> : null}
            <span className="text-xs text-muted-foreground">
              {dateFmt(s.created_at)}
            </span>
            {s.status === "REJECTED" && s.reject_reason ? (
              <span className="text-xs text-muted-foreground">
                {tr("Rejected")}: {cell(s.reject_reason)}
              </span>
            ) : null}
          </div>

          <DataList
            columns={lineColumns}
            rows={lines}
            error={null}
            loading={false}
            rowKey={(l) => String(l.margin_simulation_line_id)}
            empty={{ title: tr("No lines") }}
          />

          {totals && <ProfitabilitySnapshot totals={totals} currency={currency} />}

          {s.low_margin_justification ? (
            <p className="micro text-[rgb(var(--warn))]">
              {tr("Submitted below cost")}: {cell(s.low_margin_justification)}
            </p>
          ) : null}

          {totals && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat
                label={tr("Total cost")}
                value={money(totals.total_cost, currency)}
              />
              <Stat
                label="Total price"
                value={money(totals.total_price, currency)}
              />
              <Stat
                label="Margin"
                value={money(totals.margin_amount, currency)}
                tone="accent"
              />
              <Stat
                label={tr("Margin %")}
                value={
                  totals.margin_percent != null
                    ? `${cell(totals.margin_percent)}%`
                    : "—"
                }
                tone="accent"
              />
              <Stat label="VAT" value={money(totals.vat_total, currency)} />
              <Stat
                label="Total TTC"
                value={money(totals.total_ttc, currency)}
              />
            </div>
          )}

          {error && <ErrorState message={error} />}

          {rejecting ? (
            <div className="space-y-2">
              <Field label={tr("Reject reason")} required>
                <Textarea
                  rows={2}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setRejecting(false)}
                  disabled={busy}
                >
                  {tr("Cancel")}
                </Button>
                <Button
                  loading={busy}
                  disabled={rejectReason.trim().length < 3}
                  onClick={() =>
                    void act("reject", { reason: rejectReason }).then((ok) => {
                      if (ok) setRejecting(false);
                    })
                  }
                >
                  {tr("Reject")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              {/* §2.4a — DRAFT and REJECTED are editable, matching the legacy
                  screen's isEditableStatus(). Editing a REJECTED simulation is
                  the ONLY way to act on the rejection: without it, REJECTED is
                  a terminal state and the document has to be rebuilt. */}
              {(s.status === "DRAFT" || s.status === "REJECTED") && (
                <Button variant="outline" disabled={busy} onClick={() => onEdit(s)}>
                  {tr("Edit")}
                </Button>
              )}
              {s.status === "DRAFT" && (
                <Button loading={busy} onClick={() => void act("submit")}>
                  {tr("Submit")}
                </Button>
              )}
              {s.status === "SUBMITTED" && (
                <>
                  <Button loading={busy} onClick={() => void act("approve")}>
                    {tr("Approve")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setRejecting(true)}
                  >
                    {tr("Reject")}
                  </Button>
                </>
              )}
              {s.status === "APPROVED" && !s.quotation_id && (
                <Button loading={busy} onClick={() => void act("quote")}>
                  {tr("Create quotation")}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function MarginSimulationsPage() {
  const reload = useRefresh();
  const { rows, error, loading } = useList("/margin-simulations");
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [formOpen, setFormOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // §2.4a — the simulation being edited. Held here rather than inside the
  // detail modal so the editor replaces it cleanly instead of stacking a second
  // modal on top of the first.
  const [editing, setEditing] = React.useState<Row | null>(null);

  const dossierRef = React.useMemo(
    () =>
      new Map((dossiers || []).map((d) => [String(d.dossier_id), d.ref])),
    [dossiers],
  );

  const columns: Column<Row>[] = [
    {
      key: "dossier",
      label: "Dossier",
      render: (r) => (
        <span className="font-medium text-foreground">
          {r.dossier_id
            ? (dossierRef.get(String(r.dossier_id)) ??
              String(r.dossier_id).slice(0, 8))
            : tr("Ad-hoc")}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <StatusPill status={String(r.status || "DRAFT")} />,
    },
    {
      key: "margin_percent",
      label: "Margin %",
      className: "num text-right",
      render: (r) =>
        r.margin_percent != null ? `${cell(r.margin_percent)}%` : "—",
    },
    {
      key: "total_price",
      label: "Price",
      className: "num text-right",
      render: (r) => money(r.total_price, String(r.currency || "XAF")),
    },
    {
      key: "total_cost",
      label: "Cost",
      className: "num text-right",
      render: (r) => money(r.total_cost, String(r.currency || "XAF")),
    },
    {
      key: "created_at",
      label: "Created",
      render: (r) => dateFmt(r.created_at),
    },
  ];

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Commercial" to="/commercial" />}
        title="Margin simulation"
        description="Cost the file, then price it — margin on services only, no accounting entries. Link a costing to import its lines."
        action={
          <Button onClick={() => setFormOpen(true)}>New simulation</Button>
        }
      />
      <HubTabs />

      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading || rows === null}
        rowKey={(r) => String(r.margin_simulation_id)}
        onRowClick={(r) => setSelectedId(String(r.margin_simulation_id))}
        empty={{
          title: "No simulations yet",
          hint: "Run a margin simulation to price a service package before quoting.",
          action: (
            <Button onClick={() => setFormOpen(true)}>New simulation</Button>
          ),
        }}
      />

      <AiActions actions={MARGIN_AI} />
      <MarginSimForm
        open={formOpen}
        editing={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={reload}
      />
      {selectedId && !formOpen && (
        <SimDetail
          id={selectedId}
          dossierRef={dossierRef}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
          onEdit={(sim) => {
            setEditing(sim);
            setFormOpen(true);
          }}
        />
      )}
    </section>
  );
}
