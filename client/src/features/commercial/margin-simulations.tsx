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
import { Pill, StatusPill, type Tone } from "@/components/ui/pill";
import { DictionaryFinder } from "@/components/dictionary-finder";
import { listCurrencies } from "@/lib/masterdata-api";
import type { Dossier } from "@/lib/operations-api";

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

function MarginSimForm({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [currency, setCurrency] = React.useState("XAF");
  // Currencies come from the live currency module (GET /currencies), not a
  // free-text box — the column is char(3) REFERENCES currency(code), so a
  // typo used to surface as a raw FK violation (SS4).
  const currencies = useResource(() => listCurrencies(), []);
  const currencyOptions = (currencies.data || [])
    .filter((c) => c.is_active !== false)
    .map((c) => ({
      value: c.code,
      label: c.name ? `${c.code} — ${c.name}` : c.code,
    }));

  // Header context: the file, and the costing to price from.
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [dossierId, setDossierId] = React.useState("");
  const [costingId, setCostingId] = React.useState("");
  const [linking, setLinking] = React.useState(false);
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

  React.useEffect(() => {
    if (!open) return;
    setCurrency("XAF");
    setDossierId("");
    setCostingId("");
    setLines([{ ...BLANK }]);
    setTotals(null);
    setError(null);
  }, [open]);

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
        lines: {
          dictionary_item_id: string | null;
          label: string;
          qty: number;
          unit_cost: number;
          is_disbursement: boolean;
          vat_applicable: boolean;
        }[];
      }>(`/margin-simulations/from-costing/${id}`);
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
      const created = await tenant<{ margin_simulation_id: string }>(
        "/margin-simulations",
        {
          method: "POST",
          body: {
            dossier_id: dossierId || undefined,
            costing_id: costingId || undefined,
            currency: currency.trim().toUpperCase() || "XAF",
            lines: payloadLines(),
          },
        },
      );
      if (andSubmit) {
        await tenant(
          `/margin-simulations/${created.margin_simulation_id}/submit`,
          { method: "POST" },
        );
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const globalPct =
    totals && totals.margin_percent != null
      ? Number(totals.margin_percent)
      : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Margin simulation"
      description="Rapid quote maths — margin on services only, débours pass-through. No GL (KB §6.7)."
      size="wide"
    >
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

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={preview} loading={previewing}>
            {tr("Preview")}
          </Button>
          {globalPct != null && (
            <Pill tone={globalPct >= 20 ? "ok" : globalPct >= 10 ? "warn" : "bad"}>
              {globalPct < 10 ? `CRITICAL · ${globalPct}%` : `GLOBAL MARGIN ${globalPct}%`}
            </Pill>
          )}
        </div>

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
            {tr("Save draft")}
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
}: {
  id: string;
  dossierRef: Map<string, string>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const sim = useResource<Row | null>(
    () => tenant<Row>(`/margin-simulations/${id}`),
    [id],
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rejectReason, setRejectReason] = React.useState("");
  const [rejecting, setRejecting] = React.useState(false);
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
        onClose={() => setFormOpen(false)}
        onSaved={reload}
      />
      {selectedId && (
        <SimDetail
          id={selectedId}
          dossierRef={dossierRef}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
        />
      )}
    </section>
  );
}
