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
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, type Tone } from "@/components/ui/pill";
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
import { money, num, dateFmt, todayISO } from "@/lib/format";
import { reportActionError } from "@/lib/action-error";
import type { Entity, DictItem, DictSearchHit } from "@/lib/masterdata-api";
import { resolveExpenseRate } from "@/lib/masterdata-api";
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
  onChange,
  onPickMulti,
  onRemove,
  removable,
}: {
  line: CostingLineDraft;
  dossierId?: string;
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
  const [margin, setMargin] = React.useState("");
  const [lines, setLines] = React.useState<CostingLineDraft[]>([
    { ...BLANK_LINE },
  ]);
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
        margin_percent: margin === "" ? undefined : Number(margin),
        lines: lines
          .filter((l) => l.label || l.dictionary_item_id)
          .map((l) => ({
            dictionary_item_id: l.dictionary_item_id,
            label: l.label,
            qty: Number(l.qty) || 1,
            unit_cost: Number(l.unit_cost) || 0,
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
      description="Planned cost + margin for a dossier."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Dossier")} required>
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
          <Field label={tr("Margin %")}>
            <Input
              type="number"
              step="0.01"
              className="num text-right"
              value={margin}
              onChange={(e) => setMargin(e.target.value)}
            />
          </Field>
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
        </div>
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

export function CostingPage() {
  const { rows, error, loading, reload } = useList<api.Costing>("/costings");
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [open, setOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
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
      label: "Dossier",
      render: (r) => (r.dossier_id ? dref[r.dossier_id] || "—" : "—"),
    },
    {
      key: "margin_percent",
      label: "Margin",
      render: (r) => (r.margin_percent != null ? `${r.margin_percent}%` : "—"),
    },
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
        description="Planned cost sheets and margin per dossier."
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
        empty={{
          title: "No costings yet",
          hint: "Build a costing sheet for a dossier.",
        }}
      />
      {open && <CostingForm onClose={() => setOpen(false)} onSaved={reload} />}
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

export function CostTrackingPage() {
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [dossierId, setDossierId] = React.useState("");
  const entries = useResource(
    () =>
      dossierId ? api.costEntriesByDossier(dossierId) : Promise.resolve([]),
    [dossierId],
  );
  const recon = useResource<Record<string, unknown>>(
    () => (dossierId ? api.reconcileDossier(dossierId) : Promise.resolve({})),
    [dossierId],
  );

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
  const rc = (recon.data || {}) as Record<string, number>;

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Costing" to="/costing" />}
        title="Cost tracking"
        description="Actual costs booked against a dossier, vs the plan."
      />
      <HubTabs />
      <div className="mb-4 flex items-center gap-3">
        <span className="micro">{tr("Dossier")}</span>
        <Select
          aria-label="Filter by dossier"
          value={dossierId}
          onChange={(e) => setDossierId(e.target.value)}
          className="max-w-xs"
        >
          <option value="">Select a dossier…</option>
          {(dossiers || []).map((d) => (
            <option key={d.dossier_id} value={d.dossier_id}>
              {d.ref}
            </option>
          ))}
        </Select>
      </div>
      {!dossierId && <CostPortfolio />}
      {dossierId && (
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
                rc.coverage_percent == null
                  ? "—"
                  : `${num(rc.coverage_percent)}%`
              }
            />
          </KpiRow>
          <DataList
            columns={cols}
            rows={entries.data}
            error={entries.error}
            loading={entries.loading}
            rowKey={(r, i) => r.cost_entry_id || String(i)}
            empty={{
              title: "No cost entries",
              hint: "No actuals booked to this dossier yet.",
            }}
          />
        </>
      )}
    </section>
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
      label: "Dossier",
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
          hint: "Dossiers appear here once they have an approved costing or a booked actual.",
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
  const [dossierId, setDossierId] = React.useState("");
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
        dossier_id: dossierId || undefined,
        lines: lines
          .filter((l) => l.dictionary_item_id || l.label)
          .map((l) => ({
            dictionary_item_id: l.dictionary_item_id || undefined,
            label: l.label || "Line",
            budget_amount: Number(l.budget_amount) || 0,
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
      description="Request an advance against a dossier budget."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label={tr("Dossier")}>
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
                className="grid grid-cols-[1fr_140px_auto] items-end gap-2"
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
    to: "SUBMITTED" | "APPROVED" | "REJECTED",
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
      label: "Dossier",
      render: (r) => (r.dossier_id ? dref[r.dossier_id] || "—" : "—"),
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
        description="Advances requested against dossier budgets."
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
          hint: "Request an advance for a dossier.",
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
  const {
    data: watch,
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
