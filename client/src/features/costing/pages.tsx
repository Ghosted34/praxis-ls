/**
 * Costing screens (Wave 3) — costing sheets, cost tracking (actuals), cash
 * requests, régie d'avance. Locked shared kit; line editors kept minimal.
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { DocButton } from "@/components/doc-button";
import { Input } from "@/components/ui/input";
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
import type { Entity, DictItem } from "@/lib/masterdata-api";
import { listCurrencies } from "@/lib/masterdata-api";
import { DictionaryFinder } from "@/components/dictionary-finder";
import type { Dossier } from "@/lib/operations-api";
import * as api from "@/lib/costing-api";
import { useDebounced } from "@/lib/use-debounced";
// The worksheet owns the route and the status vocabulary; the register links
// into it rather than keeping a second copy of either.
import { COSTING_BASE, statusLabel } from "./costing-model";

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
 * New costing — pick the file, and nothing else.
 *
 * The old dialog asked for the lines too, which is why it was 320 lines long
 * and why a costing could be created and then never edited. Lines belong on the
 * worksheet, where Suggest can fill them and the shipment strip is there to
 * price against. This asks only what the sheet cannot derive: which file, in
 * which currency, and who validates it.
 */
function CostingForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { rows: dossiers } = useList<Dossier>("/operations");
  const { rows: users } = useList<{
    user_id: string;
    full_name?: string | null;
    email?: string;
  }>("/users");
  const currencies = useResource(() => listCurrencies(), []);
  const [dossierId, setDossierId] = React.useState("");
  const [currency, setCurrency] = React.useState("XAF");
  const [validatorId, setValidatorId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const file = (dossiers || []).find((d) => d.dossier_id === dossierId);

  return (
    <Modal
      open
      onClose={onClose}
      title={tr("New costing")}
      description={tr(
        "What this operations file will cost us. Charges are added on the worksheet — Suggest loads the standard set for the file's service.",
      )}
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const made = await api.createCosting({
              dossier_id: dossierId,
              currency,
              validator_id: validatorId || undefined,
            });
            onCreated(made.costing_id);
          } catch (err) {
            setError(errMsg(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={tr("Operations file")} required>
          <Select value={dossierId} onChange={(e) => setDossierId(e.target.value)}>
            <option value="">—</option>
            {(dossiers || []).map((d) => (
              <option key={d.dossier_id} value={d.dossier_id}>
                {d.ref}
                {d.rate_provider_name ? ` — ${d.rate_provider_name}` : ""}
              </option>
            ))}
          </Select>
          {file && !file.rate_provider_id && (
            <p className="mt-1 micro">
              {tr(
                "No carrier confirmed on this file yet — suggested charges will fall back to each item's default rate.",
              )}
            </p>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={tr("Currency")}
            hint={tr("The rate to XAF is taken from Currencies & FX.")}
          >
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {(currencies.data || [])
                .filter((c) => c.is_active !== false)
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name ? `${c.code} — ${c.name}` : c.code}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={tr("Validator")} hint={tr("Who this sheet is submitted to")}>
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
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={!dossierId || busy}
          onCancel={onClose}
          saveLabel={tr("Open worksheet")}
        />
      </form>
    </Modal>
  );
}

/**
 * The costing register.
 *
 * ── WHAT CHANGED, AND WHY ──────────────────────────────────────────────────
 *
 * It filtered on nothing, showed a Total column against `r.total ?? r.total_cost`
 * — two fields that were never columns, so it was permanently blank — and its
 * KPI strip counted the rows it had been handed, which is the first fifty. So
 * "Approved: 3" meant three on this page.
 *
 * 12766 gave the row its money and the API a `/kpis` endpoint that aggregates
 * over the SAME filter, which is what legacy's "shadow query" did
 * (`api/costing/list.php:112-130`) and the one part of its registry worth
 * copying exactly.
 */
export function CostingPage() {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<string>("");
  const debouncedQ = useDebounced(q, 300);

  const query = React.useMemo(
    () => ({ q: debouncedQ || undefined, status: status || undefined }),
    [debouncedQ, status],
  );
  const qs = React.useMemo(() => JSON.stringify(query), [query]);

  const list = useResource(() => api.listCostings(query), [qs]);
  const kpis = useResource(() => api.costingKpis(query), [qs]);
  const rows = list.data;

  const navigate = useNavigate();
  const [creating, setCreating] = React.useState(false);

  const columns: Column<api.Costing>[] = [
    {
      key: "ref",
      label: tr("Reference"),
      render: (r) => (
        <span className="num font-medium text-foreground">
          {r.doc_number || tr("Draft — unnumbered")}
        </span>
      ),
    },
    {
      key: "file",
      label: tr("File"),
      render: (r) => (
        <span className="num">{r.dossier_ref || "—"}</span>
      ),
    },
    {
      key: "client",
      label: tr("Client"),
      render: (r) => r.client_name || "—",
    },
    {
      key: "service",
      label: tr("Service"),
      render: (r) => r.service_name_en || r.service_type_key || "—",
    },
    {
      key: "date",
      label: tr("Raised"),
      render: (r) => (r.created_at ? dateFmt(r.created_at) : "—"),
    },
    {
      key: "total",
      label: tr("Total"),
      className: "num text-right",
      // 12766: a real column at last. `total_ttc` is in the sheet's own
      // currency, which is why the code rides beside it — the XAF-normalised
      // figure is what the KPI strip sums, never this one.
      render: (r) =>
        r.total_ttc != null ? (
          <span>
            {money(r.total_ttc, r.currency || "XAF")}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "status",
      label: tr("Status"),
      render: (r) => <Pill tone={tone(r.status)}>{statusLabel(r.status)}</Pill>,
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Costing" to="/costing" />}
        title={tr("Costing")}
        description={tr(
          "What each operations file will cost us — HT / VAT / TTC. Pricing lives in the margin simulator and the quotation.",
        )}
        action={<Button onClick={() => setCreating(true)}>{tr("New costing")}</Button>}
      />
      <HubTabs />

      {/* Counts and money over the WHOLE filter, not the page. */}
      <KpiRow>
        <KpiTile label={tr("Costings")} value={num(kpis.data?.total ?? 0)} />
        <KpiTile label={tr("To validate")} value={num(kpis.data?.to_validate ?? 0)} />
        <KpiTile label={tr("To approve")} value={num(kpis.data?.to_approve ?? 0)} />
        <KpiTile
          label={tr("Approved total")}
          value={money0(kpis.data?.total_ttc_xaf ?? 0)}
          hint={tr("XAF, at each sheet's own rate")}
        />
      </KpiRow>

      <div className="flex flex-wrap items-end gap-3">
        <Field label={tr("Search")} hint={tr("Reference, file or client")}>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr("CST-2026-0043, SLAS-2026-0001, FMA…")}
          />
        </Field>
        <Chips
          label={tr("Status")}
          value={status}
          options={[
            { value: "", label: tr("All") },
            { value: "DRAFT", label: tr("Draft") },
            { value: "SUBMITTED_FOR_VALIDATION", label: tr("To validate") },
            { value: "SUBMITTED_FOR_APPROVAL", label: tr("To approve") },
            { value: "APPROVED_LOCKED", label: tr("Approved") },
            { value: "UNLOCK_REQUESTED", label: tr("Unlock requested") },
            { value: "REJECTED", label: tr("Rejected") },
          ]}
          onChange={setStatus}
        />
      </div>

      <DataList
        columns={columns}
        rows={rows}
        error={list.error}
        loading={list.loading}
        rowKey={(r) => r.costing_id}
        // The worksheet is a route, so a row click is a navigation and the
        // reference can be pasted into an email.
        onRowClick={(r) => navigate(`${COSTING_BASE}/${r.costing_id}`)}
        empty={{
          title: q || status ? tr("No costings match") : tr("No costings yet"),
          hint:
            q || status
              ? tr("Clear the filters to see the rest.")
              : tr("Build a costing for an operations file."),
          action:
            q || status ? undefined : (
              <Button onClick={() => setCreating(true)}>{tr("New costing")}</Button>
            ),
        }}
      />

      {creating && (
        <CostingForm
          onClose={() => setCreating(false)}
          onCreated={(newId) => {
            setCreating(false);
            // Straight to the worksheet: an empty costing is not a destination.
            navigate(`${COSTING_BASE}/${newId}`);
          }}
        />
      )}
    </section>
  );
}

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
