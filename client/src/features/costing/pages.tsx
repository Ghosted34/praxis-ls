/**
 * Costing screens (Wave 3) — costing sheets, cost tracking (actuals), cash
 * requests, régie d'avance. Locked shared kit; line editors kept minimal.
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { DocButton } from "@/components/doc-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, type Tone } from "@/components/ui/pill";
import { Chips } from "@/components/ui/chips";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { exportCsv } from "@/lib/export-csv";
import { cn } from "@/lib/cn";
import { RowActions } from "@/components/ui/row-actions";
import { Panel } from "@/components/ui/panel";
import {
  RegieDetail,
  MyAdvances,
  WindowPill,
  regieTone,
} from "./regie-detail";
import {
  DisburseForm,
  JustifyForm,
  CashRequestActions,
} from "./cash-request-actions";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { money, money0, num, dateFmt, todayISO } from "@/lib/format";
import { reportActionError } from "@/lib/action-error";
import type { Entity, DictItem, DictSearchHit } from "@/lib/masterdata-api";
import {
  resolveExpenseRate,
  listCurrencies,
  listSalesTaxCodes,
} from "@/lib/masterdata-api";
import { DictionaryFinder } from "@/components/dictionary-finder";
import type { EquipmentPick } from "@/components/equipment-step";
import type { Dossier } from "@/lib/operations-api";
import * as api from "@/lib/costing-api";

const shell = pageShell.wide;
const TONES: Record<string, Tone> = {
  DRAFT: "mute",
  COMPUTED: "blue",
  APPROVED: "ok",
  APPROVED_LOCKED: "ok",
  SUBMITTED: "warn",
  SUBMITTED_FOR_VALIDATION: "warn",
  SUBMITTED_FOR_APPROVAL: "warn",
  REJECTED: "bad",
  VALIDATED: "blue",
  PARTIALLY_DISBURSED: "warn",
  DISBURSED: "ok",
  OPEN: "blue",
  SETTLED: "ok",
};
const tone = (s?: string | null): Tone =>
  TONES[String(s || "").toUpperCase()] || "mute";
const refOf = (rows: Dossier[] | null) => {
  const m: Record<string, string> = {};
  (rows || []).forEach((d) => {
    m[d.dossier_id] = d.ref;
  });
  return m;
};

/* ═══════════════════ Costing sheets ═══════════════════ */

/**
 * One cost line's draft state. `dictionary_item_id` is what makes the line
 * price itself: once it and (for equipment-varying items) a container type
 * are known, the line resolves against the dossier's carrier via the same
 * cascading resolver Expense Rates uses (specific carrier+type → carrier
 * general → item default). `rateStatus` is purely a UI hint — the number
 * that actually lands on the line is always `unit_cost`, editable either way.
 */
type CostingLineDraft = {
  dictionary_item_id?: string;
  label: string;
  qty: number;
  unit_cost: number;
  /** §3.3 — legacy per-line toggles (save.php:84 vat_applicable; débours). */
  is_disbursement?: boolean;
  tax_code_id?: string;
  variesByEquipment?: boolean;
  containerTypeRefId?: string;
  /** Display snapshot of the container type, so the line reads correctly without
   *  the form holding the whole registry. */
  containerTypeLabel?: string;
  rateStatus?: "idle" | "resolving" | "resolved" | "manual";
};
const BLANK_LINE: CostingLineDraft = {
  label: "",
  qty: 1,
  unit_cost: 0,
  rateStatus: "idle",
};

function CostingLineRow({
  line,
  dossierId,
  vatCodes,
  onChange,
  onPickMulti,
  onRemove,
  removable,
}: {
  line: CostingLineDraft;
  dossierId?: string;
  /** Sales-applicable VAT codes for the per-line toggle (§3.3). */
  vatCodes: { tax_code_id: string; code: string; rate_percent?: number | null }[];
  onChange: (patch: Partial<CostingLineDraft>) => void;
  /** One pick, several container types → several lines. The form owns line
   *  creation; the picker only says what was chosen. */
  onPickMulti: (
    id: string,
    label: string,
    hit: DictSearchHit,
    picks: EquipmentPick[],
  ) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const pickItem = (id: string, label: string, hit?: DictSearchHit) => {
    onChange({
      dictionary_item_id: id || undefined,
      label: id ? label : "",
      variesByEquipment: id ? hit?.varies_by_equipment : false,
      containerTypeRefId: undefined,
      containerTypeLabel: undefined,
      rateStatus: "idle",
    });
  };

  return (
    <div className="rounded-lg border bg-card p-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Field label={tr("Charge")}>
          <DictionaryFinder
            value={line.dictionary_item_id}
            valueLabel={line.label}
            dossierId={dossierId || null}
            onPick={pickItem}
            onPickMulti={onPickMulti}
            placeholder="Search a charge…"
          />
        </Field>
        <div className="flex items-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!removable}
            onClick={onRemove}
          >
            ✕
          </Button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
        {/* The container type is CHOSEN in the finder's equipment step and only
            reported here. A second picker on the row was the thing that used to
            drift from the file's own equipment, and it is gone. */}
        {line.containerTypeRefId && (
          <Field label={tr("Container type")}>
            <p className="flex h-9 items-center text-sm text-foreground">
              {line.containerTypeLabel || "—"}
            </p>
          </Field>
        )}
        <Field label={tr("Qty")}>
          <Input
            type="number"
            className="num text-right"
            value={String(line.qty ?? "")}
            onChange={(e) => onChange({ qty: Number(e.target.value) })}
          />
        </Field>
        <Field label={tr("Unit cost")}>
          <Input
            type="number"
            className="num text-right"
            value={String(line.unit_cost ?? "")}
            onChange={(e) =>
              onChange({
                unit_cost: Number(e.target.value),
                rateStatus: "manual",
              })
            }
          />
        </Field>
        {/* §3.3 — the legacy sheet's per-line VAT toggle (save.php:84). A
            débours line never carries VAT (0640 ledger rule), so the select
            disables itself when the line is flagged pass-through. */}
        <Field label={tr("VAT")}>
          <Select
            value={line.tax_code_id || ""}
            onChange={(e) =>
              onChange({ tax_code_id: e.target.value || undefined })
            }
            disabled={line.is_disbursement}
            aria-label={tr("VAT code")}
          >
            <option value="">{tr("No VAT")}</option>
            {vatCodes.map((tc) => (
              <option key={tc.tax_code_id} value={tc.tax_code_id}>
                {tc.code}
                {tc.rate_percent != null ? ` (${tc.rate_percent}%)` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("Débours")}>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={line.is_disbursement === true}
              onChange={(e) =>
                onChange({
                  is_disbursement: e.target.checked,
                  // pass-through is never taxed — clear the code with the flag
                  tax_code_id: e.target.checked ? undefined : line.tax_code_id,
                })
              }
              aria-label={tr("Débours (pass-through)")}
            />
            {tr("Pass-through")}
          </label>
        </Field>
      </div>
      {line.dictionary_item_id && (
        <p className="mt-1 micro">
          {line.rateStatus === "resolving"
            ? "Resolving rate…"
            : line.rateStatus === "resolved"
              ? "Rate filled from the carrier's rate card — still editable."
              : line.rateStatus === "manual"
                ? "No rate on file for this carrier/container type — entered manually."
                : line.variesByEquipment && !line.containerTypeRefId
                  ? "Re-pick this charge to choose a container type and look up the rate."
                  : null}
        </p>
      )}
    </div>
  );
}

function CostingForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [dossierId, setDossierId] = React.useState("");
  // §3.3 — the legacy header controls: Curr + Rate (conversion where you
  // work), remarks for the validator, and the validator picker (a submission
  // with nobody named goes to no one's queue — the server now refuses it).
  const [currency, setCurrency] = React.useState("XAF");
  const [rate, setRate] = React.useState("1");
  const [remarks, setRemarks] = React.useState("");
  const [validatorId, setValidatorId] = React.useState("");
  const currencies = useResource(() => listCurrencies(), []);
  const { rows: users } = useList<{
    user_id: string;
    full_name?: string | null;
    email?: string;
  }>("/users");
  // Sales-applicable VAT codes for the per-line toggle. `degraded` is surfaced
  // — silently offering zero codes is indistinguishable from "no tax set up".
  // Memoised because `?.codes || []` would mint a fresh [] on every render
  // while the fetch is pending, re-running the liveTotals memo below each time
  // (react-hooks/exhaustive-deps).
  const vat = useResource(() => listSalesTaxCodes(), []);
  const vatCodes = React.useMemo(() => vat.data?.codes || [], [vat.data]);
  const [lines, setLines] = React.useState<CostingLineDraft[]>([
    { ...BLANK_LINE },
  ]);
  // Live footer — the same arithmetic the server's computeCosting does
  // (per-line VAT from the picked code's rate; débours never taxed).
  const liveTotals = React.useMemo(() => {
    let ht = 0;
    let vatTotal = 0;
    for (const l of lines) {
      const amt = (Number(l.qty) || 0) * (Number(l.unit_cost) || 0);
      ht += amt;
      if (!l.is_disbursement && l.tax_code_id) {
        const rate = Number(
          vatCodes.find((tc) => tc.tax_code_id === l.tax_code_id)
            ?.rate_percent || 0,
        );
        vatTotal += (amt * rate) / 100;
      }
    }
    const r = (n: number) => Math.round(n * 100) / 100;
    return {
      total_ht: r(ht),
      vat_total: r(vatTotal),
      total_ttc: r(ht + vatTotal),
    };
  }, [lines, vatCodes]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const setLine = (i: number, p: Partial<CostingLineDraft>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  const dossierProviderId =
    (dossiers || []).find((d) => d.dossier_id === dossierId)
      ?.rate_provider_id || undefined;

  // Resolve one line's rate against the dossier's carrier — cascading from a
  // carrier+container-type match down to the item's plain default. A miss
  // (no rate on file for that scope) is not an error state for the form: the
  // line just falls back to whatever the user types in Unit cost.
  const resolveLine = React.useCallback(
    async (i: number, l: CostingLineDraft) => {
      if (
        !l.dictionary_item_id ||
        (l.variesByEquipment && !l.containerTypeRefId)
      )
        return;
      setLine(i, { rateStatus: "resolving" });
      try {
        const resolved = await resolveExpenseRate({
          dictionary_item_id: l.dictionary_item_id,
          rate_provider_id: dossierProviderId,
          container_type_ref_id: l.containerTypeRefId,
        });
        setLine(i, {
          unit_cost: Number(resolved.rate),
          rateStatus: "resolved",
        });
      } catch {
        setLine(i, { rateStatus: "manual" });
      }
    },
    [dossierProviderId],
  );

  // Re-resolve every priced line when the dossier (and so its carrier)
  // changes — a line picked before the dossier was chosen is not stuck with
  // no scope, and switching dossiers re-prices for the new carrier.
  React.useEffect(() => {
    lines.forEach((l, i) => {
      if (l.dictionary_item_id) resolveLine(i, l);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierProviderId]);

  // One pick of an equipment-varying charge becomes one line PER container
  // type, each resolving its own rate through the cascade that already exists.
  // The picker returns data; the form owns line creation, which is why the
  // expansion lives here and not inside the popover.
  const pickMulti =
    (at: number) =>
    (id: string, label: string, hit: DictSearchHit, picks: EquipmentPick[]) => {
      const made: CostingLineDraft[] = picks.map((p) => ({
        ...BLANK_LINE,
        dictionary_item_id: id,
        label,
        variesByEquipment: hit.varies_by_equipment,
        containerTypeRefId: p.container_type_ref_id,
        containerTypeLabel: p.label,
        qty: p.qty || 1,
      }));
      if (!made.length) return;
      setLines((ls) => [...ls.slice(0, at), ...made, ...ls.slice(at + 1)]);
      made.forEach((l, k) => resolveLine(at + k, l));
    };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createCosting({
        dossier_id: dossierId,
        currency: currency || "XAF",
        exchange_rate_to_xaf:
          currency !== "XAF" && Number(rate) > 0 ? Number(rate) : undefined,
        remarks: remarks.trim() || undefined,
        validator_id: validatorId || undefined,
        lines: lines
          .filter((l) => l.label || l.dictionary_item_id)
          .map((l) => ({
            dictionary_item_id: l.dictionary_item_id,
            label: l.label,
            qty: Number(l.qty) || 1,
            unit_cost: Number(l.unit_cost) || 0,
            is_disbursement: l.is_disbursement === true,
            // §3.3: the per-line VAT toggle persists as the line's tax code.
            tax_code_id: l.tax_code_id || undefined,
            // 0663: the equipment dimension the form used to resolve a rate with
            // and then throw away.
            container_type_ref_id: l.containerTypeRefId || null,
          })),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="New costing sheet"
      description="Planned cost for an operations file — what the file will cost us, HT / VAT / TTC. Pricing (margin) lives in the margin simulator and the quotation."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Operations file")} required>
            <Select
              value={dossierId}
              onChange={(e) => setDossierId(e.target.value)}
            >
              <option value="">—</option>
              {(dossiers || []).map((d) => (
                <option key={d.dossier_id} value={d.dossier_id}>
                  {d.ref}
                  {d.rate_provider_name ? ` — ${d.rate_provider_name}` : ""}
                </option>
              ))}
            </Select>
            {dossierId && !dossierProviderId && (
              <p className="mt-1 micro">
                No carrier confirmed on this file yet — lines fall back to each
                item's default rate.
              </p>
            )}
          </Field>
          {/* §2.2: the Margin % field is gone. Costing answers "what will this
              cost us?" and stops — the legacy sheet never had margin either. */}
          <Field label={tr("Validator")} hint="Who this sheet is submitted to">
            <Select
              value={validatorId}
              onChange={(e) => setValidatorId(e.target.value)}
            >
              <option value="">—</option>
              {(users || []).map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.full_name || u.email || u.user_id.slice(0, 8)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Currency")}>
            <Select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {(currencies.data || [])
                .filter((c) => c.is_active !== false)
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name ? `${c.code} — ${c.name}` : c.code}
                  </option>
                ))}
            </Select>
          </Field>
          {currency !== "XAF" && (
            <Field
              label={tr("Rate to XAF")}
              hint="The conversion the sheet was priced at"
            >
              <Input
                type="number"
                min="0"
                step="0.0001"
                className="num text-right"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </Field>
          )}
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="micro">Cost lines</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setLines((l) => [...l, { ...BLANK_LINE }])}
            >
              + Add line
            </Button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <CostingLineRow
                key={i}
                line={l}
                dossierId={dossierId}
                vatCodes={vatCodes}
                onPickMulti={pickMulti(i)}
                removable={lines.length > 1}
                onRemove={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                onChange={(patch) => {
                  const next = { ...l, ...patch };
                  setLine(i, patch);
                  if (
                    patch.dictionary_item_id !== undefined ||
                    patch.containerTypeRefId !== undefined
                  )
                    resolveLine(i, next);
                }}
              />
            ))}
          </div>
          {vat.data?.degraded && (
            <p className="mt-1 micro">
              {tr(
                "Some jurisdictions failed to list their VAT codes — the VAT picker may be incomplete.",
              )}
            </p>
          )}
        </div>

        {/* §3.3 — the legacy footer, live: Subtotal (HT) / VAT / Total Estimate. */}
        <div className="grid grid-cols-3 gap-3">
          <KpiTile
            label={tr("Subtotal (HT)")}
            value={money(liveTotals.total_ht, currency)}
          />
          <KpiTile label="VAT" value={money(liveTotals.vat_total, currency)} />
          <KpiTile
            label={tr("Total estimate")}
            value={money(liveTotals.total_ttc, currency)}
          />
        </div>

        <Field
          label={tr("Remarks")}
          hint="Context for the validator — prints on the costing sheet"
        >
          <Textarea
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </Field>

        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={!dossierId || busy}
          onCancel={onClose}
          saveLabel="Create costing"
        />
      </form>
    </Modal>
  );
}

/**
 * §3.3 — the costing worksheet, opened by clicking a row (the list used to be
 * inert). Lines with their VAT, the legacy footer (Subtotal HT / VAT / Total
 * Estimate), remarks, the named validator, and Print via the document studio
 * (docType COSTING).
 */
function CostingDetail({
  id,
  dref,
  onClose,
}: {
  id: string;
  dref: Record<string, string>;
  onClose: () => void;
}) {
  const costing = useResource(() => api.getCosting(id), [id]);
  const { rows: users } = useList<{
    user_id: string;
    full_name?: string | null;
    email?: string;
  }>("/users");
  const c = costing.data;
  const ccy = c?.currency || "XAF";
  const validatorName = React.useMemo(() => {
    if (!c?.validator_id) return null;
    const u = (users || []).find((x) => x.user_id === c.validator_id);
    return u ? u.full_name || u.email || c.validator_id.slice(0, 8) : c.validator_id.slice(0, 8);
  }, [users, c]);

  const lineColumns: Column<api.CostingLine>[] = [
    {
      key: "label",
      label: "Charge",
      render: (l) => (
        <span className="font-medium text-foreground">
          {l.label || "—"}
          {l.container_type_code ? (
            <span className="ml-2 text-xs text-muted-foreground">
              {l.container_type_code}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "qty",
      label: "Qty",
      className: "num text-right",
      render: (l) => String(l.qty ?? 1),
    },
    {
      key: "unit_cost",
      label: "Unit cost",
      className: "num text-right",
      render: (l) => money(l.unit_cost, ccy),
    },
    {
      key: "vat",
      label: "VAT",
      render: (l) =>
        l.is_disbursement
          ? "—"
          : l.tax_rate_percent != null
            ? `${l.tax_rate_percent}%`
            : "—",
    },
    {
      key: "kind",
      label: "Kind",
      render: (l) =>
        l.is_disbursement ? (
          <Pill tone="mute">{tr("Débours")}</Pill>
        ) : (
          <Pill tone="blue">{tr("Service")}</Pill>
        ),
    },
    {
      key: "amount",
      label: "Amount (HT)",
      className: "num text-right",
      render: (l) => money((Number(l.qty) || 1) * (Number(l.unit_cost) || 0), ccy),
    },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={c?.doc_number || tr("Costing sheet")}
      description="What this file will cost us — HT / VAT / TTC. Margin lives in the margin simulator and the quotation."
      size="wide"
    >
      {costing.error ? (
        <ErrorState message={costing.error} />
      ) : !c ? null : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={tone(c.status)}>{c.status}</Pill>
            <span className="text-sm text-muted-foreground">
              {c.dossier_id ? (dref[c.dossier_id] ?? "") : ""}
            </span>
            {c.currency && c.currency !== "XAF" && (
              <Pill tone="orange">
                {c.currency} @ {String(c.exchange_rate_to_xaf ?? 1)}
              </Pill>
            )}
            {validatorName && (
              <span className="text-xs text-muted-foreground">
                {tr("Validator")}: {validatorName}
                {c.validator_assigned_at
                  ? ` (${dateFmt(c.validator_assigned_at)})`
                  : ""}
              </span>
            )}
            <span className="ml-auto">
              {/* Print / Preview — the legacy sheet's output, via the document
                  studio (settings section document_template, docType COSTING). */}
              <DocButton
                docType="COSTING"
                id={c.costing_id}
                title={c.doc_number || "Costing sheet"}
                label={tr("Print / preview")}
              />
            </span>
          </div>

          <DataList
            columns={lineColumns}
            rows={c.lines || []}
            error={null}
            loading={false}
            rowKey={(l, i) => String(l.costing_line_id ?? i)}
            empty={{ title: tr("No lines") }}
          />

          {/* The legacy footer: Subtotal (HT) / VAT / Total Estimate. */}
          <div className="grid grid-cols-3 gap-3">
            <KpiTile
              label={tr("Subtotal (HT)")}
              value={money(c.totals?.total_ht, ccy)}
              hint={
                c.totals && c.totals.disbursement_total > 0
                  ? `of which débours ${money(c.totals.disbursement_total, ccy)}`
                  : undefined
              }
            />
            <KpiTile label="VAT" value={money(c.totals?.vat_total, ccy)} />
            <KpiTile
              label={tr("Total estimate")}
              value={money(c.totals?.total_ttc, ccy)}
            />
          </div>

          {c.remarks && (
            <div>
              <p className="micro mb-1">{tr("Remarks")}</p>
              <p className="rounded-lg border bg-card p-3 text-sm">
                {c.remarks}
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function CostingPage() {
  const { rows, error, loading, reload } = useList<api.Costing>("/costings");
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [open, setOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  // §3.3 — rows are clickable; the worksheet opens as a detail view.
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const dref = refOf(dossiers);
  const list = rows || [];

  // The screen had Approve and nothing else, so `costing.submitted` — the event
  // the approval chain binds to — could never fire from the UI. A costing went
  // DRAFT → APPROVED_LOCKED in one click by one person, with the configured
  // chain bypassed entirely because it was never opened.
  const [actionError, setActionError] = React.useState<string | null>(null);
  async function setStatus(c: api.Costing, to: "SUBMIT_APPROVAL" | "APPROVE") {
    setBusyId(c.costing_id);
    setActionError(null);
    try {
      await api.setCostingStatus(c.costing_id, to);
      reload();
    } catch (err) {
      // try/finally with no catch is why the old button failed silently.
      setActionError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  }

  // The unlock loop (10718). APPROVED_LOCKED used to be terminal: a wrong rate
  // or a carrier credit had no remedy but a second costing competing with the
  // first for the same dossier. UNLOCK is refused server-side once the dossier's
  // final invoice has left DRAFT, and that 422 surfaces here verbatim.
  const [unlockFor, setUnlockFor] = React.useState<api.Costing | null>(null);
  async function unlock(
    c: api.Costing,
    action: "UNLOCK" | "DENY_UNLOCK",
  ) {
    setBusyId(c.costing_id);
    setActionError(null);
    try {
      await api.unlockCosting(c.costing_id, action);
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<api.Costing>[] = [
    {
      key: "ref",
      label: "Ref",
      render: (r) => (
        <span className="num font-medium text-foreground">
          {r.doc_number || r.ref || r.costing_id?.slice(0, 8) || "—"}
        </span>
      ),
    },
    {
      key: "dossier_id",
      label: "File",
      render: (r) => (r.dossier_id ? dref[r.dossier_id] || "—" : "—"),
    },
    // §2.2: the Margin column is gone — costing carries no margin. Pricing
    // lives in the margin simulator and the quotation.
    {
      key: "total",
      label: "Total",
      className: "num text-right",
      render: (r) => money(r.total ?? r.total_cost),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <Pill tone={tone(r.status)}>{r.status}</Pill>,
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <RowActions>
          {/* Submit opens the approval chain; Approve is the direct path, which
              now refuses while a chain is pending (W4). */}
          {["DRAFT", "SUBMITTED_FOR_VALIDATION"].includes(r.status) && (
            <Button
              size="sm"
              variant="outline"
              loading={busyId === r.costing_id}
              onClick={() => setStatus(r, "SUBMIT_APPROVAL")}
            >
              Submit for approval
            </Button>
          )}
          {!["APPROVED_LOCKED", "REJECTED", "UNLOCK_REQUESTED"].includes(
            r.status,
          ) && (
            <Button
              size="sm"
              variant="outline"
              loading={busyId === r.costing_id}
              onClick={() => setStatus(r, "APPROVE")}
            >
              Approve
            </Button>
          )}
          {r.status === "APPROVED_LOCKED" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setUnlockFor(r)}
            >
              {tr("Request unlock")}
            </Button>
          )}
          {r.status === "UNLOCK_REQUESTED" && (
            <>
              <Button
                size="sm"
                variant="outline"
                loading={busyId === r.costing_id}
                onClick={() => unlock(r, "UNLOCK")}
              >
                {tr("Unlock")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                loading={busyId === r.costing_id}
                onClick={() => unlock(r, "DENY_UNLOCK")}
              >
                {tr("Deny")}
              </Button>
            </>
          )}
        </RowActions>
      ),
    },
  ];
  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Costing" to="/costing" />}
        title={tr("Costing")}
        description="Planned cost sheets per operations file — HT / VAT / TTC. Margin lives in the margin simulator and the quotation."
        action={<Button onClick={() => setOpen(true)}>New costing</Button>}
      />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Costings" value={num(list.length)} />
        <KpiTile
          label={tr("Approved")}
          value={num(list.filter((c) => c.status === "APPROVED_LOCKED").length)}
        />
        <KpiTile
          label={tr("Draft")}
          value={num(list.filter((c) => c.status === "DRAFT").length)}
        />
      </KpiRow>
      {actionError && <ErrorState message={actionError} />}
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r) => r.costing_id}
        onRowClick={(r) => setSelectedId(r.costing_id)}
        empty={{
          title: "No costings yet",
          hint: "Build a costing sheet for an operations file.",
          action: (
            <Button onClick={() => setOpen(true)}>New costing</Button>
          ),
        }}
      />
      {open && <CostingForm onClose={() => setOpen(false)} onSaved={reload} />}
      {selectedId && (
        <CostingDetail
          id={selectedId}
          dref={dref}
          onClose={() => setSelectedId(null)}
        />
      )}
      {unlockFor && (
        <UnlockRequestForm
          costing={unlockFor}
          onClose={() => setUnlockFor(null)}
          onSaved={reload}
        />
      )}
    </section>
  );
}

/**
 * REQUEST_UNLOCK needs a reason — it is the audit answer to "why is this
 * approved costing open again", and the server refuses without one
 * (REASON_REQUIRED). Its own dialog rather than a window.prompt, so the text is
 * a real labelled control.
 */
function UnlockRequestForm({
  costing,
  onClose,
  onSaved,
}: {
  costing: api.Costing;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.unlockCosting(costing.costing_id, "REQUEST_UNLOCK", reason);
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={tr("Request unlock")}
      description="Asks an approver to reopen this costing for correction. It returns to DRAFT only once the request is granted."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field
          label={tr("Reason")}
          required
          hint="Kept on the costing as the audit trail, whether or not the request is granted."
        >
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={busy || !reason.trim()}
          onCancel={onClose}
          saveLabel={tr("Request unlock")}
        />
      </form>
    </Modal>
  );
}

/* ═══════════════════ Cost tracking (actuals) ═══════════════════ */

/**
 * §3.4 — Cost tracking, the legacy's three tabs on OUR data model:
 * Summary & balance (portfolio + the master-ledger matrix), Actual costs
 * (per-file entries + fast multi-line entry in one transaction), Advances
 * received (per FILE — owner-decided — with optional per-item earmarks).
 */
export function CostTrackingPage() {
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [tab, setTab] = React.useState("summary");
  const [dossierId, setDossierId] = React.useState("");

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Costing" to="/costing" />}
        title="Cost tracking"
        description="Actual costs booked against each file, vs the plan — and the advances funding them."
      />
      <HubTabs />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Chips
          label="Cost tracking tabs"
          value={tab}
          onChange={setTab}
          options={[
            { value: "summary", label: tr("Summary & balance") },
            { value: "actuals", label: tr("Actual costs") },
            { value: "advances", label: tr("Advances received") },
          ]}
        />
        {tab !== "summary" && (
          <Select
            aria-label="Filter by operations file"
            value={dossierId}
            onChange={(e) => setDossierId(e.target.value)}
            className="max-w-xs"
          >
            <option value="">Select an operations file…</option>
            {(dossiers || []).map((d) => (
              <option key={d.dossier_id} value={d.dossier_id}>
                {d.ref}
              </option>
            ))}
          </Select>
        )}
      </div>

      {tab === "summary" && (
        <div className="space-y-4">
          <CostPortfolio />
          <MatrixPanel />
        </div>
      )}
      {tab === "actuals" &&
        (dossierId ? (
          <ActualCostsTab dossierId={dossierId} />
        ) : (
          <EmptyState
            title={tr("Pick an operations file")}
            hint="Actual costs are recorded against one file at a time."
          />
        ))}
      {tab === "advances" &&
        (dossierId ? (
          <AdvancesTab dossierId={dossierId} />
        ) : (
          <EmptyState
            title={tr("Pick an operations file")}
            hint="A client advances money against the file; earmarking part of it to a cost item is optional."
          />
        ))}
    </section>
  );
}

/**
 * §3.4 — the master-ledger matrix: one row per file, categories as COLUMNS
 * derived from the dictionary (the legacy hardcoded 15 in PHP and matched by
 * array index — add a category there and you edit code; here you add a
 * dictionary item). TOTAL SPEND / TOTAL BALANCE close the row; Export ships
 * exactly what is on screen.
 */
function MatrixPanel() {
  const m = useResource(() => api.costMatrix(), []);
  const items = m.data?.items || [];
  const rows = m.data?.rows || [];

  function exportMatrix() {
    exportCsv<api.MatrixRow>({
      filename: "cost-tracking-matrix",
      columns: [
        { header: "File", value: (r) => r.ref || r.dossier_id },
        { header: "Client", value: (r) => r.client_name || "" },
        ...items.map((it) => ({
          header: it.code,
          value: (r: api.MatrixRow) =>
            r.cells[it.dictionary_item_id ?? "OTHER"] ?? 0,
        })),
        { header: "TOTAL SPEND", value: (r) => r.total_spend },
        { header: "Advance received", value: (r) => r.advance_received },
        { header: "TOTAL BALANCE", value: (r) => r.total_balance },
      ],
      rows,
    });
  }

  return (
    <Panel
      title={tr("Master ledger")}
      subtitle="Files × cost items — columns grow with the dictionary, not a fixed list"
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={exportMatrix}
          disabled={!rows.length}
        >
          {tr("Export")}
        </Button>
      }
    >
      {m.error ? (
        <ErrorState message={m.error} />
      ) : rows.length === 0 && !m.loading ? (
        <EmptyState
          title={tr("Nothing tracked yet")}
          hint="Record an actual cost against a file and the grid grows."
        />
      ) : (
        <Table sticky maxHeight="480px" density="compact" freezeFirstColumn>
          <THead>
            <TR>
              <TH>File</TH>
              {items.map((it) => (
                <TH
                  key={it.dictionary_item_id ?? "OTHER"}
                  className="text-right"
                >
                  {it.code}
                </TH>
              ))}
              <TH className="text-right">TOTAL SPEND</TH>
              <TH className="text-right">Advance</TH>
              <TH className="text-right">TOTAL BALANCE</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.dossier_id}>
                <TD>
                  <span className="font-medium text-foreground">
                    {r.ref || r.dossier_id.slice(0, 8)}
                  </span>
                  {r.client_name ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {r.client_name}
                    </span>
                  ) : null}
                </TD>
                {items.map((it) => {
                  const v = r.cells[it.dictionary_item_id ?? "OTHER"];
                  return (
                    <TD
                      key={it.dictionary_item_id ?? "OTHER"}
                      className="num text-right"
                    >
                      {v ? money0(v) : "—"}
                    </TD>
                  );
                })}
                <TD className="num text-right font-semibold">
                  {money0(r.total_spend)}
                </TD>
                <TD className="num text-right">{money0(r.advance_received)}</TD>
                <TD
                  className={cn(
                    "num text-right font-semibold",
                    r.total_balance > 0 && "text-[rgb(var(--warn))]",
                  )}
                >
                  {money0(r.total_balance)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Panel>
  );
}

/** §3.4 — per-file actuals + the fast multi-line sheet (one transaction). */
function ActualCostsTab({ dossierId }: { dossierId: string }) {
  const entries = useResource(
    () => api.costEntriesByDossier(dossierId),
    [dossierId],
  );
  const recon = useResource<Record<string, unknown>>(
    () => api.reconcileDossier(dossierId),
    [dossierId],
  );
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const rc = (recon.data || {}) as Record<string, number>;

  const cols: Column<api.CostEntry>[] = [
    {
      key: "label",
      label: "Item",
      render: (r) => r.label || r.category || "—",
    },
    { key: "category", label: "Category" },
    { key: "entry_date", label: "Date", render: (r) => dateFmt(r.entry_date) },
    {
      key: "amount",
      label: "Amount",
      className: "num text-right",
      render: (r) => money(r.amount),
    },
  ];

  return (
    <>
      <KpiRow>
        {/* `budget`, not `planned_cost` — reconcile() returns
            { budget, actual, variance, variance_percent, over_budget }
            and this tile read two keys that have never existed, so it
            rendered empty for every dossier ever selected. */}
        <KpiTile label={tr("Budget")} value={money(rc.budget)} />
        <KpiTile label={tr("Actual")} value={money(rc.actual)} />
        <KpiTile
          label={tr("Variance")}
          value={money(rc.variance)}
          tone={rc.over_budget ? "bad" : "ok"}
        />
        <KpiTile
          label={tr("Advance received")}
          value={money(rc.advance_received)}
        />
        <KpiTile
          label={tr("Coverage")}
          value={
            rc.coverage_percent == null ? "—" : `${num(rc.coverage_percent)}%`
          }
        />
      </KpiRow>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setSheetOpen(true)}>
          {tr("Record costs (sheet)")}
        </Button>
      </div>
      <DataList
        columns={cols}
        rows={entries.data}
        error={entries.error}
        loading={entries.loading}
        rowKey={(r, i) => r.cost_entry_id || String(i)}
        empty={{
          title: "No cost entries",
          hint: "No actuals booked to this file yet.",
          action: (
            <Button onClick={() => setSheetOpen(true)}>
              {tr("Record costs (sheet)")}
            </Button>
          ),
        }}
      />
      {sheetOpen && (
        <BulkCostSheet
          dossierId={dossierId}
          onClose={() => setSheetOpen(false)}
          onSaved={() => {
            entries.reload();
            recon.reload();
          }}
        />
      )}
    </>
  );
}

/**
 * §3.4 — fast multi-line entry. The legacy saved every category in one
 * transaction; making a user issue 15 round trips (and explain 7 half-saved
 * lines when the 8th fails) is the defect this closes: the whole sheet posts
 * atomically via POST /cost-tracking/bulk.
 */
function BulkCostSheet({
  dossierId,
  onClose,
  onSaved,
}: {
  dossierId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: entities } = useList<Entity>("/entities");
  const [entityId, setEntityId] = React.useState("");
  const [entryDate, setEntryDate] = React.useState(todayISO());
  const [docRef, setDocRef] = React.useState("");
  type SheetLine = {
    dictionary_item_id: string | null;
    label: string;
    amount: string;
    is_disbursement: boolean;
  };
  const BLANK: SheetLine = {
    dictionary_item_id: null,
    label: "",
    amount: "",
    is_disbursement: false,
  };
  const [rows, setRows] = React.useState<SheetLine[]>([{ ...BLANK }]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const setRow = (i: number, p: Partial<SheetLine>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const total = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const valid = rows.filter(
    (r) => Number(r.amount) > 0 && (r.dictionary_item_id || r.label.trim()),
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.bulkRecordCosts({
        dossier_id: dossierId,
        entity_id: entityId,
        entry_date: entryDate,
        source_doc_ref: docRef,
        lines: valid.map((r) => ({
          dictionary_item_id: r.dictionary_item_id || undefined,
          category: r.label.trim() || undefined,
          amount: Number(r.amount),
          is_disbursement: r.is_disbursement,
        })),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={tr("Record costs — sheet")}
      description="Every line posts to the ledger in ONE transaction — all or nothing, like the legacy sheet."
      size="lg"
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={tr("Entity")} required>
            <Select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            >
              <option value="">—</option>
              {(entities || []).map((en) => (
                <option key={en.entity_id} value={en.entity_id}>
                  {en.legal_name || en.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Date")} required>
            <Input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </Field>
          <Field label={tr("Source doc ref")} required>
            <Input value={docRef} onChange={(e) => setDocRef(e.target.value)} />
          </Field>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="micro">{tr("Lines")}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setRows((rs) => [...rs, { ...BLANK }])}
            >
              + {tr("Add line")}
            </Button>
          </div>
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid items-end gap-2 sm:grid-cols-[minmax(10rem,1fr)_8rem_auto_auto]"
            >
              <DictionaryFinder
                id={`bulk-line-${i}`}
                value={r.dictionary_item_id}
                valueLabel={r.label || null}
                onPick={(id, label) =>
                  setRow(i, { dictionary_item_id: id, label })
                }
                label={tr("Cost item")}
              />
              <Field label={tr("Amount")}>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="num text-right"
                  value={r.amount}
                  onChange={(e) => setRow(i, { amount: e.target.value })}
                />
              </Field>
              <label className="flex h-9 items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={r.is_disbursement}
                  onChange={(e) =>
                    setRow(i, { is_disbursement: e.target.checked })
                  }
                />
                {tr("Débours")}
              </label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={tr("Remove line")}
                onClick={() =>
                  setRows((rs) =>
                    rs.length > 1 ? rs.filter((_, j) => j !== i) : rs,
                  )
                }
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
        <p className="num text-right text-sm font-semibold">
          {tr("Sheet total")}: {money(total)}
        </p>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={!entityId || !docRef || valid.length === 0 || busy}
          onCancel={onClose}
          saveLabel={tr("Post sheet")}
        />
      </form>
    </Modal>
  );
}

/** §3.4 — advances per FILE, with the optional per-item earmark the owner
 *  asked for ("this money is for demurrage"). */
function AdvancesTab({ dossierId }: { dossierId: string }) {
  const adv = useResource(() => api.dossierAdvances(dossierId), [dossierId]);
  const [allocFor, setAllocFor] = React.useState<api.DossierAdvance | null>(
    null,
  );
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function removeAlloc(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await api.removeAdvanceAllocation(id);
      adv.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  const list = adv.data || [];
  const received = list.reduce((a, r) => a + Number(r.amount || 0), 0);
  const earmarked = list.reduce(
    (a, r) =>
      a + r.allocations.reduce((x, al) => x + Number(al.amount || 0), 0),
    0,
  );

  return (
    <div className="space-y-4">
      <KpiRow>
        <KpiTile label={tr("Advances received")} value={money(received)} />
        <KpiTile
          label={tr("Earmarked to items")}
          value={money(earmarked)}
          hint="Optional — an advance funds the file either way"
        />
        <KpiTile
          label={tr("Unallocated")}
          value={money(received - earmarked)}
        />
      </KpiRow>
      {error && <ErrorState message={error} />}
      {adv.error ? (
        <ErrorState message={adv.error} />
      ) : list.length === 0 && !adv.loading ? (
        <EmptyState
          title={tr("No advances on this file")}
          hint="Client advances are recorded in Finance; they appear here against the file."
        />
      ) : (
        <div className="space-y-2">
          {list.map((a) => (
            <div key={a.advance_id} className="lux-card space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="num text-sm font-semibold">
                  {money(a.amount)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {tr("received")} {dateFmt(a.received_on)} ·{" "}
                  {tr("applied to invoices")} {money(a.applied_amount)}
                </span>
                <span className="ml-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAllocFor(a)}
                  >
                    {tr("Earmark to item")}
                  </Button>
                </span>
              </div>
              {a.allocations.length > 0 && (
                <ul className="space-y-1">
                  {a.allocations.map((al) => (
                    <li
                      key={al.advance_allocation_id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Pill tone="blue">{al.item_code || "—"}</Pill>
                      <span className="num">{money(al.amount)}</span>
                      {al.note && (
                        <span className="text-xs text-muted-foreground">
                          {al.note}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        loading={busyId === al.advance_allocation_id}
                        onClick={() =>
                          void removeAlloc(al.advance_allocation_id)
                        }
                      >
                        {tr("Remove")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {allocFor && (
        <AllocateModal
          advance={allocFor}
          onClose={() => setAllocFor(null)}
          onSaved={() => adv.reload()}
        />
      )}
    </div>
  );
}

function AllocateModal({
  advance,
  onClose,
  onSaved,
}: {
  advance: api.DossierAdvance;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [itemId, setItemId] = React.useState<string | null>(null);
  const [itemLabel, setItemLabel] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const already = advance.allocations.reduce(
    (a, al) => a + Number(al.amount || 0),
    0,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!itemId) return;
    setBusy(true);
    setError(null);
    try {
      await api.allocateAdvance(advance.advance_id, {
        dictionary_item_id: itemId,
        amount: Number(amount),
        note: note.trim() || undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={tr("Earmark advance to a cost item")}
      description={`${money(advance.amount)} received — ${money(already)} already earmarked. The advance itself stays on the file; this only records what the client said the money is for.`}
    >
      <form className="space-y-4" onSubmit={submit}>
        <DictionaryFinder
          value={itemId}
          valueLabel={itemLabel}
          onPick={(id, label) => {
            setItemId(id);
            setItemLabel(label);
          }}
          label={tr("Cost item")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Amount")} required>
            <Input
              type="number"
              min="0"
              step="0.01"
              className="num text-right"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label={tr("Note")}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={!itemId || !(Number(amount) > 0) || busy}
          onCancel={onClose}
          saveLabel={tr("Earmark")}
        />
      </form>
    </Modal>
  );
}

/**
 * The portfolio sheet — every dossier with a budget or an actual.
 *
 * The legacy had a master sheet and a KPI view across all files; this module
 * had only `/dossier/:dossierId/…`, so "which files are over budget" could not
 * be asked without one round-trip per dossier. Shown when no single dossier is
 * selected, so the page opens on the overview and narrows on demand.
 *
 * Every figure here is computed by the SAME `reconcile` and `coverage`
 * functions the single-dossier read uses — not a second implementation in SQL.
 * The legacy computed its status in a view AND again in PHP and the two
 * disagreed; see doc/COST_TRACKING_LEGACY_COMPARISON.md §5.
 */
function CostPortfolio() {
  const rows = useResource<api.CostPortfolioRow[]>(() => api.costPortfolio(), []);
  const kpis = useResource<api.CostPortfolioKpis>(
    () => api.costPortfolioKpis(),
    [],
  );
  const k = kpis.data;

  const cols: Column<api.CostPortfolioRow>[] = [
    {
      key: "ref",
      label: "File",
      render: (r) => (
        <span className="num font-medium text-foreground">{r.ref || "—"}</span>
      ),
    },
    { key: "client_name", label: "Client", render: (r) => r.client_name || "—" },
    {
      key: "budget",
      label: "Budget",
      className: "num text-right",
      render: (r) => money(r.budget),
    },
    {
      key: "actual",
      label: "Actual",
      className: "num text-right",
      render: (r) => money(r.actual),
    },
    {
      key: "variance",
      label: "Variance",
      className: "num text-right",
      render: (r) => (
        <span className={r.over_budget ? "text-bad" : undefined}>
          {money(r.variance)}
        </span>
      ),
    },
    {
      key: "advance_received",
      label: "Advanced",
      className: "num text-right",
      render: (r) => money(r.advance_received),
    },
    {
      key: "coverage_percent",
      label: "Coverage",
      className: "num text-right",
      // null means nothing has been spent yet — "0%" would read as "nothing is
      // covered" when the true answer is "there is nothing to cover".
      render: (r) =>
        r.coverage_percent == null ? "—" : `${num(r.coverage_percent)}%`,
    },
  ];

  return (
    <>
      <KpiRow>
        <KpiTile label={tr("Files tracked")} value={num(k?.files_tracked)} />
        <KpiTile
          label={tr("Over budget")}
          value={num(k?.over_budget)}
          tone={k && k.over_budget > 0 ? "bad" : "ok"}
        />
        <KpiTile label={tr("Total actual")} value={money(k?.total_actual)} />
        <KpiTile
          label={tr("Variance")}
          value={money(k?.total_variance)}
          tone={k && k.total_variance > 0 ? "bad" : "ok"}
        />
        <KpiTile
          label={tr("Coverage")}
          value={
            k?.overall_coverage_percent == null
              ? "—"
              : `${num(k.overall_coverage_percent)}%`
          }
        />
      </KpiRow>
      <DataList
        columns={cols}
        rows={rows.data}
        error={rows.error || kpis.error}
        loading={rows.loading}
        rowKey={(r) => r.dossier_id}
        empty={{
          title: "Nothing tracked yet",
          hint: "Files appear here once they have an approved costing or a booked actual.",
        }}
      />
    </>
  );
}

/* ═══════════════════ Cash requests ═══════════════════ */

function CashRequestForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: dossiers } = useList<Dossier>("/operations");
  const { rows: dict } = useList<DictItem>("/financial-dictionary");
  const { rows: costings } = useList<api.Costing>("/costings");
  const [dossierId, setDossierId] = React.useState("");
  // 10720: the legacy cash request carried beneficiary + an OPS/OVH context —
  // OPS requires an operations file, OVH requires a cost centre + justification.
  const [category, setCategory] = React.useState<"OPS" | "OVH">("OPS");
  const [costingId, setCostingId] = React.useState("");
  // Auto-link the dossier's APPROVED_LOCKED costing when one is picked, so
  // "Import costing" works without hunting — the legacy linked it through the
  // ops file automatically.
  React.useEffect(() => {
    if (!dossierId) return;
    const match = (costings || []).find(
      (c) => c.dossier_id === dossierId && c.status === "APPROVED_LOCKED",
    );
    if (match) setCostingId(match.costing_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId]);
  const [beneficiary, setBeneficiary] = React.useState("");
  const [costCenter, setCostCenter] = React.useState("");
  const [overheadJustification, setOverheadJustification] = React.useState("");
  const [remarks, setRemarks] = React.useState("");
  // §3.5 — how the money leaves (legacy :499). Each method carries its own
  // required fields (:505-514); the server refuses submission without one.
  const [method, setMethod] = React.useState<"" | api.DisbursementMethod>("");
  const [details, setDetails] = React.useState<Record<string, string>>({});
  const setDetail = (k: string, v: string) =>
    setDetails((d) => ({ ...d, [k]: v }));
  const [lines, setLines] = React.useState<api.CashLine[]>([
    { dictionary_item_id: null, label: "", budget_amount: 0 },
  ]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const setLine = (i: number, p: Partial<api.CashLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  // Pick a budget line from the Financial Dictionary; the item's label is stored
  // alongside its id so the request reads the same standardised category names.
  const pickItem = (i: number, id: string) => {
    const item = (dict || []).find((d) => d.dictionary_item_id === id);
    setLine(i, {
      dictionary_item_id: id || null,
      label: item ? item.label_fr || item.code : "",
    });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createCashRequest({
        dossier_id: category === "OPS" ? dossierId || undefined : undefined,
        costing_id: costingId || undefined,
        category,
        beneficiary: beneficiary || undefined,
        cost_center: category === "OVH" ? costCenter || undefined : undefined,
        overhead_justification:
          category === "OVH" ? overheadJustification || undefined : undefined,
        remarks: remarks || undefined,
        disbursement_method: method || undefined,
        disbursement_details: method ? details : undefined,
        lines: lines
          .filter((l) => l.dictionary_item_id || l.label)
          .map((l) => ({
            dictionary_item_id: l.dictionary_item_id || undefined,
            label: l.label || "Line",
            budget_amount: Number(l.budget_amount) || 0,
            vat_percent:
              l.vat_percent === null || l.vat_percent === undefined
                ? undefined
                : Number(l.vat_percent),
            justification_required: l.justification_required === true,
          })),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="New cash request"
      description="Request an advance against an operations file budget."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Category")}>
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as "OPS" | "OVH")}
            >
              <option value="OPS">Operations</option>
              <option value="OVH">Overhead</option>
            </Select>
          </Field>
          <Field label={tr("Beneficiary")}>
            <Input
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
              placeholder="Who is paid"
            />
          </Field>
          {category === "OPS" ? (
            <>
              <Field label={tr("Operations file")}>
                <Select
                  value={dossierId}
                  onChange={(e) => setDossierId(e.target.value)}
                >
                  <option value="">—</option>
                  {(dossiers || []).map((d) => (
                    <option key={d.dossier_id} value={d.dossier_id}>
                      {d.ref}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Costing" hint="Approved costing feeding the budget lines (Import costing).">
                <Select
                  value={costingId}
                  onChange={(e) => setCostingId(e.target.value)}
                >
                  <option value="">—</option>
                  {(costings || []).map((c) => (
                    <option key={c.costing_id} value={c.costing_id}>
                      {c.doc_number || c.costing_id.slice(0, 8)}
                      {c.status === "APPROVED_LOCKED" ? " ✓" : ` (${c.status})`}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : (
            <>
              <Field label={tr("Cost centre")}>
                <Input
                  value={costCenter}
                  onChange={(e) => setCostCenter(e.target.value)}
                />
              </Field>
              <Field label={tr("Justification")}>
                <Input
                  value={overheadJustification}
                  onChange={(e) => setOverheadJustification(e.target.value)}
                />
              </Field>
            </>
          )}
        </div>
        <Field label={tr("Remarks")}>
          <Input
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Instructions that print on the request"
          />
        </Field>
        {/* §3.5 — the disbursement method and its conditional fields (legacy
            :499, :505-514). The server refuses submission without a method. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={tr("Disbursement method")}
            hint="Required before the request can be submitted"
          >
            <Select
              value={method}
              onChange={(e) => {
                setMethod(e.target.value as "" | api.DisbursementMethod);
                setDetails({});
              }}
            >
              <option value="">—</option>
              <option value="CASH">Cash</option>
              <option value="BANK">Bank transfer</option>
              <option value="CHEQUE">Cheque</option>
              <option value="MOMO">Mobile money</option>
            </Select>
          </Field>
          {method === "BANK" && (
            <>
              <Field label={tr("Bank name")} required>
                <Input
                  value={details.bank_name || ""}
                  onChange={(e) => setDetail("bank_name", e.target.value)}
                />
              </Field>
              <Field label={tr("Account number")} required>
                <Input
                  value={details.account_number || ""}
                  onChange={(e) => setDetail("account_number", e.target.value)}
                />
              </Field>
              <Field label={tr("Account name")} required>
                <Input
                  value={details.account_name || ""}
                  onChange={(e) => setDetail("account_name", e.target.value)}
                />
              </Field>
            </>
          )}
          {method === "MOMO" && (
            <>
              <Field label={tr("MoMo number")} required>
                <Input
                  value={details.momo_number || ""}
                  onChange={(e) => setDetail("momo_number", e.target.value)}
                />
              </Field>
              <Field label={tr("Network")} required>
                <Select
                  value={details.network || ""}
                  onChange={(e) => setDetail("network", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="MTN">MTN</option>
                  <option value="ORANGE">ORANGE</option>
                </Select>
              </Field>
            </>
          )}
          {method === "CHEQUE" && (
            <Field label={tr("Cheque number")} required>
              <Input
                value={details.cheque_number || ""}
                onChange={(e) => setDetail("cheque_number", e.target.value)}
              />
            </Field>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="micro">Budget lines</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                setLines((l) => [
                  ...l,
                  { dictionary_item_id: null, label: "", budget_amount: 0 },
                ])
              }
            >
              + Add line
            </Button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div
                key={i}
                className="grid items-end gap-2 sm:grid-cols-[1fr_120px_90px_auto_auto]"
              >
                <Field label="Budget line">
                  <Select
                    value={l.dictionary_item_id ?? ""}
                    onChange={(e) => pickItem(i, e.target.value)}
                  >
                    <option value="">Select a category…</option>
                    {(dict || [])
                      .filter((d) => d.is_active !== false)
                      .map((d) => (
                        <option
                          key={d.dictionary_item_id}
                          value={d.dictionary_item_id}
                        >
                          {d.label_fr || d.code}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label={tr("Budget")}>
                  <Input
                    type="number"
                    className="num text-right"
                    value={String(l.budget_amount ?? "")}
                    onChange={(e) =>
                      setLine(i, { budget_amount: Number(e.target.value) })
                    }
                  />
                </Field>
                {/* §3.5 — legacy per-line VAT % and "Just. Req?". */}
                <Field label={tr("VAT %")}>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    className="num text-right"
                    value={
                      l.vat_percent === null || l.vat_percent === undefined
                        ? ""
                        : String(l.vat_percent)
                    }
                    onChange={(e) =>
                      setLine(i, {
                        vat_percent:
                          e.target.value === ""
                            ? null
                            : Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <label className="flex h-9 items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={l.justification_required === true}
                    onChange={(e) =>
                      setLine(i, { justification_required: e.target.checked })
                    }
                    aria-label={tr("Justification required")}
                  />
                  {tr("Just. req?")}
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>
        </div>
        {/* §3.5 — the voucher footer, live: Subtotal / VAT / TOTAL PAYABLE. */}
        {(() => {
          const subtotal = lines.reduce(
            (a, l) => a + (Number(l.budget_amount) || 0),
            0,
          );
          const vat = lines.reduce(
            (a, l) =>
              a +
              ((Number(l.budget_amount) || 0) * (Number(l.vat_percent) || 0)) /
                100,
            0,
          );
          return (
            <p className="num text-right text-sm">
              {tr("Subtotal")} {money(subtotal)} · {tr("VAT")} {money(vat)} ·{" "}
              <span className="font-semibold">
                {tr("TOTAL PAYABLE")} {money(subtotal + vat)}
              </span>
            </p>
          );
        })()}
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={busy}
          onCancel={onClose}
          saveLabel="Create request"
        />
      </form>
    </Modal>
  );
}

export function CashRequestsPage() {
  const { rows, error, loading, reload } =
    useList<api.CashRequest>("/cash-requests");
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [open, setOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const dref = refOf(dossiers);
  const list = rows || [];

  // The two money actions open a dialog; the three status moves are one call.
  const [disbursing, setDisbursing] = React.useState<api.CashRequest | null>(null);
  const [justifying, setJustifying] = React.useState<api.CashRequest | null>(null);

  async function moveCr(
    c: api.CashRequest,
    to: "SUBMITTED" | "VALIDATED" | "APPROVED" | "REJECTED",
  ) {
    setBusyId(c.cash_request_id);
    try {
      await api.transitionCashRequest(c.cash_request_id, to);
      reload();
    } catch (e) {
      reportActionError(e);
    } finally {
      setBusyId(null);
    }
  }

  // The legacy cash request imported its lines from the APPROVED_LOCKED costing
  // (costing_lines_get); the route exists again and DRAFT rows get the button.
  async function importCosting(c: api.CashRequest) {
    setBusyId(c.cash_request_id);
    try {
      await api.importCostingLines(c.cash_request_id);
      reload();
    } catch (e) {
      reportActionError(e);
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<api.CashRequest>[] = [
    {
      key: "ref",
      label: "Ref",
      render: (r) => (
        <span className="num font-medium text-foreground">
          {r.doc_number || r.ref || r.cash_request_id?.slice(0, 8) || "—"}
        </span>
      ),
    },
    {
      key: "dossier_id",
      label: "File",
      render: (r) => (r.dossier_id ? dref[r.dossier_id] || "—" : "—"),
    },
    {
      key: "beneficiary",
      label: "Beneficiary",
      render: (r) => r.beneficiary || "—",
    },
    {
      key: "category",
      label: "Type",
      render: (r) =>
        r.category ? <Pill tone="mute">{r.category}</Pill> : "—",
    },
    {
      key: "total_budget",
      label: "Budget",
      className: "num text-right",
      render: (r) => money(r.total_budget),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <Pill tone={tone(r.status)}>{r.status}</Pill>,
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <RowActions>
          <DocButton
            docType="CASH_REQUEST"
            id={r.cash_request_id}
            title={r.ref || `Cash request ${r.cash_request_id.slice(0, 8)}`}
            label={tr("View")}
          />
          {r.status === "DRAFT" && (
            <Button
              size="sm"
              variant="outline"
              loading={busyId === r.cash_request_id}
              onClick={() => importCosting(r)}
              title="Import budget lines from the approved costing"
            >
              Import costing
            </Button>
          )}
          <CashRequestActions
            request={r}
            busy={busyId === r.cash_request_id}
            onTransition={(to) => moveCr(r, to)}
            onDisburse={() => setDisbursing(r)}
            onJustify={() => setJustifying(r)}
          />
        </RowActions>
      ),
    },
  ];
  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Costing" to="/costing" />}
        title="Cash requests"
        description="Advances requested against operations file budgets."
        action={<Button onClick={() => setOpen(true)}>{tr("New request")}</Button>}
      />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Requests" value={num(list.length)} />
        <KpiTile
          label={tr("Approved")}
          value={num(list.filter((c) => c.status === "APPROVED").length)}
        />
        <KpiTile
          label="Submitted"
          value={num(list.filter((c) => c.status === "SUBMITTED").length)}
        />
      </KpiRow>
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r) => r.cash_request_id}
        empty={{
          title: "No cash requests",
          hint: "Request an advance for an operations file.",
        }}
      />
      {open && (
        <CashRequestForm onClose={() => setOpen(false)} onSaved={reload} />
      )}
      {disbursing && (
        <DisburseForm
          request={disbursing}
          onClose={() => setDisbursing(null)}
          onSaved={reload}
        />
      )}
      {justifying && (
        <JustifyForm
          request={justifying}
          onClose={() => setJustifying(null)}
          onSaved={reload}
        />
      )}
    </section>
  );
}

/* ═══════════════════ Régie d'avance ═══════════════════ */

function RegieForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: entities } = useList<Entity>("/entities");
  const [f, setF] = React.useState({
    entity_id: "",
    amount: "",
    source_doc_ref: "",
    entry_date: todayISO(),
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.issueRegie({
        entity_id: f.entity_id,
        amount: Number(f.amount),
        source_doc_ref: f.source_doc_ref,
        entry_date: f.entry_date,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Issue régie advance"
      description="Cash float issued to a holder; ages back to the client if unjustified."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Entity")} required>
            <Select
              value={f.entity_id}
              onChange={(e) => set("entity_id", e.target.value)}
            >
              <option value="">—</option>
              {(entities || []).map((en) => (
                <option key={en.entity_id} value={en.entity_id}>
                  {en.legal_name || en.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Amount")} required>
            <Input
              type="number"
              min="0"
              step="0.01"
              className="num text-right"
              value={f.amount}
              onChange={(e) => set("amount", e.target.value)}
            />
          </Field>
          <Field label={tr("Source doc ref")} required>
            <Input
              value={f.source_doc_ref}
              onChange={(e) => set("source_doc_ref", e.target.value)}
            />
          </Field>
          <Field label={tr("Date")} required>
            <Input
              type="date"
              value={f.entry_date}
              onChange={(e) => set("entry_date", e.target.value)}
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={
            !f.entity_id || f.amount === "" || !f.source_doc_ref || busy
          }
          onCancel={onClose}
          saveLabel="Issue advance"
        />
      </form>
    </Modal>
  );
}

/**
 * Régie list + the aging watchlist, with the detail view (retire / query /
 * write off / un-age) opening over the row.
 *
 * The watchlist is a SEPARATE endpoint (`/regie/watchlist`) rather than a
 * client-side filter, because "near its window" depends on each advance's own
 * frozen `policy_window_days` and on the tenant's `warn_before_window_days`
 * setting. Filtering here would mean shipping both to the browser and
 * reimplementing `isDueSoon` in TSX.
 */
export function RegiePage() {
  const { rows, error, loading, reload } = useList<api.Regie>("/regie");
  // `error` and `loading` are destructured because DataList REQUIRES them —
  // they are not optional props. Passing the real ones (rather than nulls to
  // satisfy the compiler) means a failed watchlist fetch shows as an error
  // instead of silently rendering as "nothing due", which on an AGEING
  // watchlist would be the most misleading possible empty state.
  const {
    data: watch,
    error: watchError,
    loading: watchLoading,
    reload: reloadWatch,
  } = useResource(() => api.regieWatchlist(), []);
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const list = rows || [];
  const watchRows = watch || [];
  const aged = watchRows.filter((w) => w.is_aged);

  const refreshAll = () => {
    reload();
    reloadWatch();
  };

  const columns: Column<api.Regie>[] = [
    {
      key: "ref",
      label: "Ref",
      render: (r) => (
        <span className="num font-medium text-foreground">
          {r.doc_number || r.ref || r.regie_advance_id?.slice(0, 8) || "—"}
        </span>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      className: "num text-right",
      render: (r) => money(r.amount, r.currency),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => {
        const st = r.state ?? r.status;
        return st ? <Pill tone={regieTone(st)}>{st}</Pill> : "—";
      },
    },
    {
      key: "issued_on",
      label: "Issued",
      render: (r) => dateFmt(r.issued_on || r.created_at),
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setSelected(r.regie_advance_id);
            }}
          >
            {tr("Manage")}
          </Button>
          <DocButton
            docType="REGIE_ADVANCE"
            id={r.regie_advance_id}
            title={`Régie ${r.regie_advance_id.slice(0, 8)}`}
            label={tr("View")}
          />
        </div>
      ),
    },
  ];

  const watchColumns: Column<api.RegieWatch>[] = [
    {
      key: "ref",
      label: "Ref",
      render: (r) => (
        <span className="num font-medium text-foreground">
          {r.doc_number || r.ref || r.regie_advance_id?.slice(0, 8) || "—"}
        </span>
      ),
    },
    {
      key: "open_balance",
      label: "Open",
      className: "num text-right",
      render: (r) => money(r.open_balance, r.currency),
    },
    {
      key: "days_to_window",
      label: "Window",
      render: (r) => <WindowPill days={r.days_to_window} aged={r.is_aged} />,
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelected(r.regie_advance_id)}
          >
            {tr("Manage")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Costing" to="/costing" />}
        title="Régie d'avance"
        description="Cash advances (floats), their justification and their ageing."
        action={<Button onClick={() => setOpen(true)}>Issue advance</Button>}
      />
      <HubTabs />
      <KpiRow>
        <KpiTile label={tr("Advances")} value={num(list.length)} />
        <KpiTile
          label="Total float"
          value={money(list.reduce((s, r) => s + (Number(r.amount) || 0), 0))}
        />
        <KpiTile
          label={tr("Open (watchlist)")}
          value={money(
            watchRows.reduce((s, r) => s + (Number(r.open_balance) || 0), 0),
          )}
        />
        <KpiTile
          label={tr("Aged")}
          value={num(aged.length)}
          tone={aged.length > 0 ? "bad" : "accent"}
        />
      </KpiRow>

      <MyAdvances onManage={(id) => setSelected(id)} />

      {watchRows.length > 0 && (
        <Panel
          title={tr("Ageing watchlist")}
          subtitle={tr(
            "Open advances at or near their own policy window — chase these before they reclassify to 4211.",
          )}
        >
          <DataList
            columns={watchColumns}
            rows={watchRows}
            error={watchError}
            loading={watchLoading}
            rowKey={(r) => r.regie_advance_id}
            empty={{ title: tr("Nothing due") }}
          />
        </Panel>
      )}

      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r) => r.regie_advance_id}
        onRowClick={(r) => setSelected(r.regie_advance_id)}
        highlightRowKey={selected || undefined}
        empty={{
          title: "No advances",
          hint: "Issue a cash advance to a holder.",
        }}
      />

      {open && <RegieForm onClose={() => setOpen(false)} onSaved={refreshAll} />}
      {selected && (
        <Modal
          open
          size="wide"
          onClose={() => setSelected(null)}
          title={tr("Régie advance")}
          description={tr(
            "Balance, retirement ledger, and the actions this advance's state allows.",
          )}
        >
          <RegieDetail advanceId={selected} onChanged={refreshAll} />
        </Modal>
      )}
    </section>
  );
}
