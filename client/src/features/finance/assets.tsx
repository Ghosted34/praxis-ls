/**
 * Asset register — the list plus its detail/depreciate/dispose entry points.
 *
 * Split out of `features/finance/pages.tsx` in Phase 3 (audit F7). The write
 * forms live in `./asset-forms`.
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { ApiError } from "@/lib/api-client";
import { dateFmt, money as moneyFmt, enumLabel, smartCell } from "@/lib/format";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { RowActions } from "@/components/ui/row-actions";
import * as fin from "@/lib/finance-api";
import type { Asset } from "@/lib/finance-api";
import {
  AssetCreateForm,
  AssetDepreciateForm,
  AssetDisposeForm,
  AssetDetailModal,
} from "./asset-forms";

/* NOTE: the `ReceivablesPage` and `ChartOfAccountsPage` ResourceList stubs that
   used to live here were deleted (2026-07-20) — they had no importers. FinanceHub
   takes both from the dedicated `./receivables` and `./chart-of-accounts` modules. */

const assetStatusTone = (s?: string | null) => {
  const u = String(s ?? "").toUpperCase();
  if (u === "ACTIVE") return "ok" as const;
  if (u === "DISPOSED") return "mute" as const;
  return "blue" as const;
};

export function AssetsPage() {
  const [rows, setRows] = React.useState<Asset[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [deprTarget, setDeprTarget] = React.useState<Asset | null>(null);
  const [disposeTarget, setDisposeTarget] = React.useState<Asset | null>(null);
  const reload = () => setNonce((n) => n + 1);

  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    fin
      .listAssets()
      .then((d) => live && setRows(Array.isArray(d) ? d : []))
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 403)
          setError("You don't have permission to view this.");
        else setError(e instanceof ApiError ? e.message : "Failed to load.");
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  const list = rows ?? [];
  const active = list.filter(
    (a) => String(a.status).toUpperCase() === "ACTIVE",
  );
  const totalCost = list.reduce(
    (s, a) => s + Number(a.acquisition_cost || 0),
    0,
  );

  const columns: Column<Asset>[] = [
    {
      key: "label",
      label: "Asset",
      render: (r) => (
        <span className="font-medium text-foreground">
          {smartCell(r.label)}
        </span>
      ),
    },
    {
      key: "tag",
      label: "Tag",
      render: (r) => <span className="num">{smartCell(r.tag ?? "—")}</span>,
    },
    {
      key: "acquisition_cost",
      label: "Cost",
      className: "num text-right",
      render: (r) => moneyFmt(r.acquisition_cost as number | string | null),
    },
    {
      key: "method",
      label: "Method",
      render: (r) => enumLabel(String(r.method ?? "LINEAR")),
    },
    {
      key: "acquired_on",
      label: "Acquired",
      render: (r) => dateFmt(r.acquired_on ?? null),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => (
        <Pill tone={assetStatusTone(r.status)}>
          {enumLabel(String(r.status))}
        </Pill>
      ),
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        // <RowActions> rather than the hand-rolled click shield these five
        // screens carried: it is the same six lines, and it is also where the
        // row-action button height is bounded so the row honours the density
        // preference (Phase 5).
        <RowActions>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDetailId(String(r.asset_id))}
          >
            Schedule
          </Button>
          {String(r.status).toUpperCase() === "ACTIVE" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDeprTarget(r)}
              >
                Depreciate
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDisposeTarget(r)}
              >
                Dispose
              </Button>
            </>
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Finance" to="/finance" />}
        title={tr("Assets")}
        description="Fixed-asset register — acquisition builds the monthly depreciation schedule; post a period's dotation to the ledger or dispose an asset and recognise the gain/loss."
        action={<Button onClick={() => setCreateOpen(true)}>New asset</Button>}
      />
      <KpiRow>
        <KpiTile label={tr("Assets")} value={String(list.length)} />
        <KpiTile label={tr("Active")} value={String(active.length)} />
        <KpiTile label="Acquisition cost" value={moneyFmt(totalCost)} />
      </KpiRow>
      <DataList
        columns={columns}
        rows={list}
        loading={rows === null}
        error={error}
        rowKey={(r) => String(r.asset_id)}
        onRowClick={(r) => setDetailId(String(r.asset_id))}
        empty={{
          title: "No assets yet",
          hint: "Register one to start its depreciation schedule.",
        }}
      />

      <AssetCreateForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
      />
      <AssetDetailModal
        assetId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={reload}
      />
      <AssetDepreciateForm
        asset={deprTarget}
        onClose={() => setDeprTarget(null)}
        onDone={reload}
      />
      <AssetDisposeForm
        asset={disposeTarget}
        onClose={() => setDisposeTarget(null)}
        onDone={reload}
      />
    </section>
  );
}
