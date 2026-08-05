/**
 * Commercial — pricing variance: quoted versus actual, per dossier.
 *
 * Split out of `features/commercial/pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, dateFmt, money } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { Chips } from "@/components/ui/chips";
import { SearchSelect } from "@/components/ui/search-select";

const PV_AI: AiAction[] = [
  { label: "Flag at-risk dossiers", kind: "assist", describe: "Summarise dossiers whose pricing variance is amber/red and why." },
];

const PV_FILTERS = [
  { value: "", label: "All" },
  { value: "GREEN", label: "Green" },
  { value: "YELLOW", label: "Yellow" },
  { value: "RED", label: "Red" },
];

function ComputeVarianceModal({ open, dossiers, quotations, onClose, onDone }: { open: boolean; dossiers: Row[] | null; quotations: Row[] | null; onClose: () => void; onDone: () => void }) {
  const [dossierId, setDossierId] = React.useState("");
  const [quotationId, setQuotationId] = React.useState("");
  const [quotedPrice, setQuotedPrice] = React.useState("");
  const [actualCost, setActualCost] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDossierId("");
    setQuotationId("");
    setQuotedPrice("");
    setActualCost("");
    setError(null);
  }, [open]);

  async function submit() {
    if (!dossierId) {
      setError("Choose a dossier.");
      return;
    }
    if (!quotationId && !quotedPrice) {
      setError("Provide a quotation or a quoted price.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await tenant("/pricing-variance/compute", {
        method: "POST",
        body: {
          dossier_id: dossierId,
          quotation_id: quotationId || undefined,
          quoted_price: quotedPrice === "" ? undefined : Number(quotedPrice),
          actual_cost: actualCost === "" ? undefined : Number(actualCost),
        },
      });
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const dossierLabel = (() => {
    const d = (dossiers || []).find((x) => String(x.dossier_id) === dossierId);
    return d ? cell(d.reference ?? d.title ?? d.dossier_id) : null;
  })();
  const quotationLabel = (() => {
    const q = (quotations || []).find((x) => String(x.quotation_id) === quotationId);
    return q ? (q.doc_number ? `№ ${cell(q.doc_number)}` : `Draft · ${money(q.total_ht, q.currency)}`) : null;
  })();

  return (
    <Modal open={open} onClose={onClose} title="Compute pricing variance" description="Quote vs actual cost → a R/Y/G flag. Actual cost stays finance-only.">
      <div className="space-y-4">
        <Field label="Dossier" required>
          <SearchSelect
            path="/operations"
            value={dossierLabel}
            placeholder="Search dossiers…"
            getLabel={(d) => cell(d.reference ?? d.title ?? d.dossier_id)}
            getKey={(d) => String(d.dossier_id)}
            onSelect={(d) => setDossierId(String(d.dossier_id))}
          />
        </Field>
        <Field label="Quotation" hint="Supplies the quoted price (or enter one below)">
          <SearchSelect
            path="/quotations"
            value={quotationLabel}
            placeholder="Search quotations…"
            getLabel={(q) => (q.doc_number ? `№ ${cell(q.doc_number)}` : `Draft · ${money(q.total_ht, q.currency)}`)}
            getKey={(q) => String(q.quotation_id)}
            onSelect={(q) => setQuotationId(String(q.quotation_id))}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Quoted price" hint="Override">
            <Input type="number" min="0" className="num text-right" value={quotedPrice} onChange={(e) => setQuotedPrice(e.target.value)} />
          </Field>
          <Field label="Actual cost" hint="Finance-only; blank = from cost entries">
            <Input type="number" min="0" className="num text-right" value={actualCost} onChange={(e) => setActualCost(e.target.value)} />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Compute
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function PricingVariancePage() {
  const reload = useRefresh();
  const { rows, error } = useList("/pricing-variance");
  const { rows: dossiers } = useList("/operations");
  const { rows: quotations } = useList("/quotations");
  const [filter, setFilter] = React.useState("");
  const [computeOpen, setComputeOpen] = React.useState(false);

  const filtered = React.useMemo(() => (rows || []).filter((r) => !filter || String(r.flag) === filter), [rows, filter]);
  const dossierRef = React.useMemo(() => new Map((dossiers || []).map((d) => [String(d.dossier_id), cell(d.reference ?? d.title ?? d.dossier_id)])), [dossiers]);

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Commercial" to="/commercial" />}
        title="Pricing variance"
        description="Quote vs actual cost as a red/yellow/green flag. Raw cost stays finance-only."
        action={<Button onClick={() => setComputeOpen(true)}>Compute variance</Button>}
      />
      <HubTabs />

      <div className="mb-4">
        <Chips label="Filter variances by flag" value={filter} options={PV_FILTERS} onChange={setFilter} />
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : filtered.length === 0 ? (
        <EmptyState title={rows.length ? "No rows match" : "No variance computed yet"} hint={rows.length ? "Try another flag." : "Compute variance for a dossier to see its R/Y/G flag."} />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <div key={String(r.pricing_variance_id)} className="lux-card flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{dossierRef.get(String(r.dossier_id)) ?? `Dossier ${String(r.dossier_id).slice(0, 8)}`}</p>
                  <StatusPill status={String(r.flag || "—")} />
                </div>
                <p className="truncate text-xs text-muted-foreground">Computed {dateFmt(r.computed_at)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-foreground">{r.variance_percent != null ? `${cell(r.variance_percent)}%` : "—"}</p>
                <p className="text-xs text-muted-foreground">quote {money(r.quoted_price)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <AiActions actions={PV_AI} />
      <ComputeVarianceModal open={computeOpen} dossiers={dossiers} quotations={quotations} onClose={() => setComputeOpen(false)} onDone={reload} />
    </section>
  );
}
