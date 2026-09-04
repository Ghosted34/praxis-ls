/**
 * Commercial — Pricing Variance Index (MOD-27), §2.1: a DERIVED projection
 * over the dossier reconciliation. Nothing is computed or typed here any
 * more — the old "Compute variance" modal accepted a hand-typed actual cost
 * (BUG-4) and stored it as fact; it is gone. Rows come from reconciliations
 * and are CLICKABLE: the detail answers the three questions (quote right /
 * execute to plan / make money) and, for Finance, drills into the offending
 * line. Sales sees margin % + flag + quote and NEVER a cost figure — the
 * finance endpoint is route-gated server-side (MOD-56) and this screen simply
 * degrades to the Sales view when it is refused.
 */

import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { tenant, ApiError } from "@/lib/api-client";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Modal } from "@/components/ui/modal";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { errMsg, useList, type Row } from "@/lib/use-resource";
import { cell, dateFmt, money } from "@/lib/format";
import { Pill, StatusPill, type Tone } from "@/components/ui/pill";
import { Chips } from "@/components/ui/chips";

/** Sales view of one projection row — never carries a cost figure. */
type SalesRow = {
  reconciliation_id: string;
  dossier_id: string;
  quotation_id?: string | null;
  reconciliation_status?: string;
  quoted_ht?: number | null;
  variance_percent?: number | null;
  flag?: "GREEN" | "YELLOW" | "RED" | null;
  computed_at?: string;
};

/** Finance view — adds the cost aggregates and the per-line drill. */
type FinanceRow = SalesRow & {
  budget_ht?: number;
  actual_ht?: number;
  quote_vs_budget?: number | null;
  budget_vs_actual?: number;
  quote_vs_actual?: number | null;
  lines?: {
    line_id: string;
    item_code?: string | null;
    item_label?: string | null;
    budget_ht: number;
    actual_ht: number;
    match_status?: string;
  }[];
};

const PV_AI: AiAction[] = [
  {
    label: "Flag at-risk files",
    kind: "assist",
    describe: "Summarise operations files whose pricing variance is amber/red and why.",
  },
];

const PV_FILTERS = [
  { value: "", label: "All" },
  { value: "GREEN", label: "Green" },
  { value: "YELLOW", label: "Yellow" },
  { value: "RED", label: "Red" },
];

const flagTone = (flag: string | null | undefined): Tone =>
  flag === "GREEN" ? "ok" : flag === "YELLOW" ? "warn" : flag === "RED" ? "bad" : "mute";

const signed = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${money(n)}`;

/**
 * Detail for one projection. Tries the finance endpoint first; a 403 means
 * the viewer is Sales — show the flag-side view without cost, which is the
 * boundary working, not an error.
 */
function VarianceDetail({
  row,
  dossierName,
  onClose,
}: {
  row: SalesRow;
  dossierName: string;
  onClose: () => void;
}) {
  const [finance, setFinance] = React.useState<FinanceRow | null>(null);
  const [financeDenied, setFinanceDenied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setFinance(null);
    setFinanceDenied(false);
    setError(null);
    tenant<FinanceRow>(`/pricing-variance/${row.reconciliation_id}/finance`)
      .then((d) => {
        if (!cancelled) setFinance(d);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 403) setFinanceDenied(true);
        else setError(errMsg(e));
      });
    return () => {
      cancelled = true;
    };
  }, [row.reconciliation_id]);

  const lineColumns: Column<NonNullable<FinanceRow["lines"]>[number]>[] = [
    {
      key: "item",
      label: "Item",
      render: (l) => (
        <span className="font-medium text-foreground">
          {cell(l.item_code ?? "—")}
          <span className="ml-2 text-xs text-muted-foreground">
            {cell(l.item_label ?? "")}
          </span>
        </span>
      ),
    },
    {
      key: "budget_ht",
      label: "Budget (HT)",
      className: "num text-right",
      render: (l) => money(l.budget_ht),
    },
    {
      key: "actual_ht",
      label: "Actual (HT)",
      className: "num text-right",
      render: (l) => money(l.actual_ht),
    },
    {
      key: "variance",
      label: "Variance",
      className: "num text-right",
      render: (l) => signed((Number(l.budget_ht) || 0) - (Number(l.actual_ht) || 0)),
    },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={dossierName}
      description="Derived from the file's reconciliation — quoted at header level, budget and actual from its lines."
      size="wide"
    >
      <div className="space-y-4">
        <KpiRow>
          <KpiTile
            label="Quoted (HT, services)"
            value={row.quoted_ht != null ? money(row.quoted_ht) : "—"}
          />
          <KpiTile
            label="Margin"
            value={
              row.variance_percent != null ? `${row.variance_percent}%` : "—"
            }
            hint={
              row.quoted_ht == null
                ? "No accepted quotation on this file"
                : row.flag
                  ? `Flag: ${row.flag}`
                  : undefined
            }
          />
          <KpiTile
            label="Status"
            value={cell(row.reconciliation_status ?? "—")}
          />
        </KpiRow>

        {error && <ErrorState message={error} />}

        {financeDenied ? (
          <p className="text-sm text-muted-foreground">
            {tr(
              "Cost figures are finance-only. You are seeing the Sales view: margin and flag without cost.",
            )}
          </p>
        ) : finance ? (
          <>
            <KpiRow>
              <KpiTile
                label="Did we quote it right?"
                value={signed(finance.quote_vs_budget)}
                hint="Quoted − budget"
              />
              <KpiTile
                label="Did we execute to plan?"
                value={signed(finance.budget_vs_actual)}
                hint="Budget − actual"
              />
              <KpiTile
                label="Did we make money?"
                value={signed(finance.quote_vs_actual)}
                hint="Quoted − actual"
              />
            </KpiRow>
            <DataList
              columns={lineColumns}
              rows={finance.lines || []}
              error={null}
              loading={false}
              rowKey={(l) => l.line_id}
              empty={{
                title: tr("No lines"),
                hint: "The reconciliation has no service-cost lines yet.",
              }}
            />
          </>
        ) : null}
      </div>
    </Modal>
  );
}

export function PricingVariancePage() {
  const { rows, error, loading } = useList<SalesRow>("/pricing-variance");
  const { rows: dossiers } = useList<Row>("/operations");
  const [filter, setFilter] = React.useState("");
  const [selected, setSelected] = React.useState<SalesRow | null>(null);

  const dossierRef = React.useMemo(
    () =>
      new Map(
        (dossiers || []).map((d) => [
          String(d.dossier_id),
          cell(d.reference ?? d.title ?? d.dossier_id),
        ]),
      ),
    [dossiers],
  );
  const nameOf = (r: SalesRow) =>
    dossierRef.get(String(r.dossier_id)) ??
    `File ${String(r.dossier_id).slice(0, 8)}`;

  const filtered = React.useMemo(
    () => (rows || []).filter((r) => !filter || String(r.flag) === filter),
    [rows, filter],
  );

  const columns: Column<SalesRow>[] = [
    {
      key: "dossier",
      label: "File",
      render: (r) => (
        <span className="font-medium text-foreground">{nameOf(r)}</span>
      ),
    },
    {
      key: "quoted_ht",
      label: "Quoted (HT)",
      className: "num text-right",
      render: (r) => (r.quoted_ht != null ? money(r.quoted_ht) : "—"),
    },
    {
      key: "variance_percent",
      label: "Margin %",
      className: "num text-right",
      render: (r) =>
        r.variance_percent != null ? `${cell(r.variance_percent)}%` : "—",
    },
    {
      key: "flag",
      label: "Flag",
      render: (r) =>
        r.flag ? <Pill tone={flagTone(r.flag)}>{r.flag}</Pill> : "—",
    },
    {
      key: "status",
      label: "Reconciliation",
      render: (r) => <StatusPill status={String(r.reconciliation_status || "—")} />,
    },
    {
      key: "computed_at",
      label: "As of",
      render: (r) => dateFmt(r.computed_at),
    },
  ];

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Commercial" to="/commercial" />}
        title="Pricing variance"
        description="Derived from each file's reconciliation — quote vs actual as a red/yellow/green flag. Raw cost stays finance-only."
      />
      <HubTabs />

      <div className="mb-4">
        <Chips
          label="Filter variances by flag"
          value={filter}
          options={PV_FILTERS}
          onChange={setFilter}
        />
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : rows !== null && rows.length === 0 ? (
        <EmptyState
          title="No reconciliations yet"
          hint="The index derives from operations file reconciliations — draft one in Costing → Reconciliation and its flag appears here."
        />
      ) : (
        <DataList
          columns={columns}
          rows={filtered}
          error={null}
          loading={loading || rows === null}
          rowKey={(r) => r.reconciliation_id}
          onRowClick={(r) => setSelected(r)}
          empty={{
            title: "No rows match",
            hint: "Try another flag.",
          }}
        />
      )}

      <AiActions actions={PV_AI} />
      {selected && (
        <VarianceDetail
          row={selected}
          dossierName={nameOf(selected)}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
