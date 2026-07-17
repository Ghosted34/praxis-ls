/**
 * Control Tower home — live data (MOD-00A). Replaces the earlier static Lovable
 * iframe mock: real KPI tiles + live-shipments board fed by
 *   GET /dashboard/kpis          → flat counts (each guarded server-side)
 *   GET /dashboard/control-tower → operation-file counts, approvals, shipments
 * Styled with the app's lux-card + --primary tokens so it re-tints per tenant.
 */
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { Row, errMsg, cell, when, Badge, MetricTile } from "@/features/sales/ui";

const DASH_AI: AiAction[] = [
  { label: "Brief me", kind: "read", describe: "Summarise today's Control Tower — what needs attention across dossiers, approvals and compliance." },
  { label: "Explain a number", kind: "assist", describe: "Explain a KPI movement (e.g. why unposted journals rose)." },
];

const num = (v: unknown) => (v === null || v === undefined ? "—" : Number(v).toLocaleString());

function useDashboard(nonce: number) {
  const [kpis, setKpis] = React.useState<Row | null>(null);
  const [ct, setCt] = React.useState<Row | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    Promise.all([tenant<Row>("/dashboard/kpis"), tenant<Row>("/dashboard/control-tower")])
      .then(([k, c]) => {
        if (!live) return;
        setKpis(k || {});
        setCt(c || {});
      })
      .catch((e) => live && setError(errMsg(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [nonce]);
  return { kpis, ct, error, loading };
}

export function DashboardPage() {
  const [nonce, setNonce] = React.useState(0);
  const { kpis, ct, error, loading } = useDashboard(nonce);

  const ops = (ct?.operation_files as Row | undefined) || {};
  const shipments = (ct?.live_shipments as Row[] | undefined) || [];

  return (
    <section className="mx-auto max-w-[1400px] animate-fade-in">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Control Tower</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your operation at a glance — live dossiers, approvals and finance signals.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setNonce((n) => n + 1)} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      {error ? (
        <ErrorState message={error} />
      ) : loading && kpis === null ? (
        <LoadingRow label="Loading Control Tower…" />
      ) : (
        <div className="space-y-6">
          {/* Hero — the actionable signals */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricTile label="Active operation files" value={num(ops.active)} accent />
            <MetricTile label="Approvals awaiting" value={num(ct?.approvals_awaiting)} accent />
            <MetricTile label="Open compliance flags" value={num(kpis?.open_compliance_flags)} />
            <MetricTile label="Unposted journals" value={num(kpis?.unposted_journal_entries)} />
          </div>

          {/* Live shipments */}
          <div className="lux-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg tracking-tight">Live shipments</h2>
              <span className="text-xs text-muted-foreground">Open &amp; in-progress dossiers</span>
            </div>
            {shipments.length === 0 ? (
              <EmptyState title="No live shipments" hint="Open dossiers appear here with their route and ETA." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="px-2 py-2 text-left font-medium">Dossier</th>
                      <th className="px-2 py-2 text-left font-medium">Status</th>
                      <th className="px-2 py-2 text-left font-medium">Route</th>
                      <th className="px-2 py-2 text-left font-medium">Vessel / flight</th>
                      <th className="px-2 py-2 text-left font-medium">ETA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shipments.map((s, i) => (
                      <tr key={String(s.ref ?? i)} className="border-b last:border-0">
                        <td className="px-2 py-2 font-medium">{cell(s.ref)}</td>
                        <td className="px-2 py-2">
                          <Badge label={String(s.status || "—")} />
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">
                          {cell(s.origin)} <span className="text-foreground">→</span> {cell(s.destination)}
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">{cell(s.vessel_flight)}</td>
                        <td className="px-2 py-2 text-muted-foreground">{when(s.eta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Operation-file breakdown + registry counts */}
          <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
            <div className="lux-card p-4">
              <h2 className="mb-3 font-display text-lg tracking-tight">Operation files</h2>
              <div className="grid grid-cols-3 gap-3">
                <MetricTile label="Active" value={num(ops.active)} accent />
                <MetricTile label="Open" value={num(ops.open)} />
                <MetricTile label="In progress" value={num(ops.in_progress)} />
              </div>
            </div>
            <div className="lux-card p-4">
              <h2 className="mb-3 font-display text-lg tracking-tight">Finance &amp; registries</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <MetricTile label="Open dossiers" value={num(kpis?.open_dossiers)} />
                <MetricTile label="Proformas" value={num(kpis?.proformas)} />
                <MetricTile label="Final invoices" value={num(kpis?.final_invoices)} />
                <MetricTile label="Receipts" value={num(kpis?.receipts)} />
                <MetricTile label="Clients" value={num(kpis?.clients)} />
                <MetricTile label="Suppliers" value={num(kpis?.suppliers)} />
              </div>
            </div>
          </div>

          <AiActions actions={DASH_AI} />
        </div>
      )}
    </section>
  );
}
