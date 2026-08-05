/**
 * Commercial — margin simulations.
 *
 * Split out of `features/commercial/pages.tsx` in Phase 4 (audit F7). A
 * simulation is deliberately NOT a quotation: it is the workings, kept so a
 * price can be defended later without re-deriving it.
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, dateFmt, money } from "@/lib/format";
import { Stat } from "@/components/ui/stat";

const MARGIN_AI: AiAction[] = [
  { label: "Suggest pricing", kind: "assist", describe: "Suggest unit prices to hit a target margin on the service lines." },
];

type MLine = { label: string; qty: string; unit_cost: string; unit_price: string; is_debours: boolean };

function MarginSimForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [currency, setCurrency] = React.useState("XAF");
  const [lines, setLines] = React.useState<MLine[]>([{ label: "", qty: "1", unit_cost: "0", unit_price: "0", is_debours: false }]);
  const [totals, setTotals] = React.useState<Row | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCurrency("XAF");
    setLines([{ label: "", qty: "1", unit_cost: "0", unit_price: "0", is_debours: false }]);
    setTotals(null);
    setError(null);
  }, [open]);

  const setLine = (i: number, patch: Partial<MLine>) => setLines((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const payloadLines = () => lines.filter((l) => l.label.trim() || Number(l.unit_price) || Number(l.unit_cost)).map((l) => ({ label: l.label.trim() || "Line", qty: Number(l.qty) || 1, unit_cost: Number(l.unit_cost) || 0, unit_price: Number(l.unit_price) || 0, is_debours: l.is_debours }));

  async function preview() {
    setPreviewing(true);
    setError(null);
    try {
      const t = await tenant<Row>("/margin-simulations/preview", { method: "POST", body: { lines: payloadLines() } });
      setTotals(t);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPreviewing(false);
    }
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/margin-simulations", { method: "POST", body: { currency: currency.trim().toUpperCase() || "XAF", lines: payloadLines() } });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Margin simulation" description="Rapid quote maths — margin on services only, débours pass-through. No GL(KB §6.7)." size="xl">
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Lines</p>
            <Button size="sm" variant="ghost" onClick={() => setLines((l) => [...l, { label: "", qty: "1", unit_cost: "0", unit_price: "0", is_debours: false }])}>
              + Line
            </Button>
          </div>
          <div className="grid grid-cols-[1fr_3rem_6rem_6rem_auto_auto] gap-2 text-xs font-medium text-muted-foreground">
            <span>Item</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit cost</span>
            <span className="text-right">Unit price</span>
            <span>déb.</span>
            <span />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_3rem_6rem_6rem_auto_auto] items-center gap-2">
              <Input value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} placeholder="Service" />
              <Input type="number" min="0" className="num text-right" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
              <Input type="number" min="0" className="num text-right" value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} />
              <Input type="number" min="0" className="num text-right" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} />
              <input type="checkbox" checked={l.is_debours} onChange={(e) => setLine(i, { is_debours: e.target.checked })} aria-label="débours" />
              <Button size="sm" variant="ghost" onClick={() => setLines((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs))}>
                ✕
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={preview} loading={previewing}>
            Preview
          </Button>
          <div className="w-24">
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} placeholder="XAF" />
          </div>
        </div>

        {totals && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total cost" value={money(totals.total_cost, currency)} />
            <Stat label="Total price" value={money(totals.total_price, currency)} />
            <Stat label="Margin" value={money(totals.margin_amount, currency)} tone="accent" />
            <Stat label="Margin %" value={totals.margin_percent != null ? `${cell(totals.margin_percent)}%` : "—"} tone="accent" />
          </div>
        )}

        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save simulation
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function MarginSimulationsPage() {
  const reload = useRefresh();
  const { rows, error } = useList("/margin-simulations");
  const [formOpen, setFormOpen] = React.useState(false);

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Commercial" to="/commercial" />}
        title="Margin simulation"
        description="What-if quote maths — margin on services only, no accounting entries."
        action={<Button onClick={() => setFormOpen(true)}>New simulation</Button>}
      />
      <HubTabs />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState title="No simulations yet" hint="Run a margin simulation to price a service package before quoting." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <div key={String(r.margin_simulation_id)} className="lux-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{dateFmt(r.created_at)}</span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary-ink">{r.margin_percent != null ? `${cell(r.margin_percent)}%` : "—"}</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-foreground">{money(r.total_price, r.currency)}</p>
              <p className="text-xs text-muted-foreground">cost {money(r.total_cost, r.currency)}</p>
            </div>
          ))}
        </div>
      )}

      <AiActions actions={MARGIN_AI} />
      <MarginSimForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={reload} />
    </section>
  );
}

/* ═══════════════════════════ EXTRA-CHARGE / DEMURRAGE SIMULATION ═══════════════════════════ */
