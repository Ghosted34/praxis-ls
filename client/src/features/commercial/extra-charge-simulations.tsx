/**
 * Commercial — extra-charge (demurrage/detention) simulations.
 *
 * Split out of `features/commercial/pages.tsx` in Phase 4 (audit F7). Tiered by
 * day band, which is why it has its own editor rather than reusing the margin
 * one.
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
import { Stat } from "@/components/ui/stat";

const EXTRA_AI: AiAction[] = [
  { label: "Explain the charge", kind: "assist", describe: "Explain a demurrage estimate — which days fall in which tier and why." },
];

type Tier = { from_day: string; to_day: string; rate: string };

function ExtraSimForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [shippingLine, setShippingLine] = React.useState("");
  const [variant, setVariant] = React.useState("");
  const [freeDays, setFreeDays] = React.useState("0");
  const [occupiedDays, setOccupiedDays] = React.useState("0");
  const [currency, setCurrency] = React.useState("XAF");
  const [tiers, setTiers] = React.useState<Tier[]>([{ from_day: "1", to_day: "", rate: "0" }]);
  const [computed, setComputed] = React.useState<Row | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setShippingLine("");
    setVariant("");
    setFreeDays("0");
    setOccupiedDays("0");
    setCurrency("XAF");
    setTiers([{ from_day: "1", to_day: "", rate: "0" }]);
    setComputed(null);
    setError(null);
  }, [open]);

  const setTier = (i: number, patch: Partial<Tier>) => setTiers((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  function body(): Record<string, unknown> {
    return {
      shipping_line: shippingLine.trim() || undefined,
      container_variant: variant.trim() || undefined,
      free_days: Number(freeDays) || 0,
      occupied_days: Number(occupiedDays) || 0,
      currency: currency.trim().toUpperCase() || "XAF",
      tiers: tiers
        .filter((t) => t.from_day && t.rate)
        .map((t) => ({ from_day: Number(t.from_day), to_day: t.to_day === "" ? null : Number(t.to_day), rate: Number(t.rate) })),
    };
  }

  async function preview() {
    setPreviewing(true);
    setError(null);
    try {
      const c = await tenant<Row>("/extra-charge-simulations/preview", { method: "POST", body: body() });
      setComputed(c);
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
      await tenant("/extra-charge-simulations", { method: "POST", body: body() });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const breakdown = (computed?.breakdown as Row[] | undefined) || [];

  return (
    <Modal open={open} onClose={onClose} title="Demurrage / extra-charge simulation" description="Per-day charge beyond the free period, from a tiered tariff. No GL." size="xl">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Shipping line">
            <Input value={shippingLine} onChange={(e) => setShippingLine(e.target.value)} placeholder="Maersk" />
          </Field>
          <Field label="Container variant">
            <Input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="40HC" />
          </Field>
          <Field label="Free days">
            <Input type="number" min="0" className="num text-right" value={freeDays} onChange={(e) => setFreeDays(e.target.value)} />
          </Field>
          <Field label="Occupied days">
            <Input type="number" min="0" className="num text-right" value={occupiedDays} onChange={(e) => setOccupiedDays(e.target.value)} />
          </Field>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Tariff tiers <span className="text-xs text-muted-foreground">(day ranges after the free period; blank “to” = open-ended)</span></p>
            <Button size="sm" variant="ghost" onClick={() => setTiers((t) => [...t, { from_day: "", to_day: "", rate: "0" }])}>
              + Tier
            </Button>
          </div>
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground">
            <span>From day</span>
            <span>To day</span>
            <span>Rate / day</span>
            <span />
          </div>
          {tiers.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
              <Input type="number" min="1" className="num text-right" value={t.from_day} onChange={(e) => setTier(i, { from_day: e.target.value })} />
              <Input type="number" min="1" className="num text-right" value={t.to_day} onChange={(e) => setTier(i, { to_day: e.target.value })} placeholder="∞" />
              <Input type="number" min="0" className="num text-right" value={t.rate} onChange={(e) => setTier(i, { rate: e.target.value })} />
              <Button size="sm" variant="ghost" onClick={() => setTiers((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs))}>
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

        {computed && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Chargeable days" value={String(computed.chargeable_days ?? "—")} />
              <Stat label="Free days" value={String(computed.free_days ?? "—")} />
              <Stat label="Total" value={money(computed.total_amount, currency)} tone="accent" />
            </div>
            {breakdown.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border text-sm">
                {breakdown.map((b) => (
                  <div key={String(b.day)} className="flex justify-between border-b px-3 py-1 last:border-0">
                    <span className="text-muted-foreground">Day {cell(b.day)}</span>
                    <span>{money(b.rate, currency)}</span>
                  </div>
                ))}
              </div>
            )}
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

export function ExtraChargeSimulationsPage() {
  const reload = useRefresh();
  const { rows, error } = useList("/extra-charge-simulations");
  const [formOpen, setFormOpen] = React.useState(false);

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Commercial" to="/commercial" />}
        title="Extra-charge simulation"
        description="Demurrage / detention estimates from a tiered tariff — no accounting entries."
        action={<Button onClick={() => setFormOpen(true)}>New simulation</Button>}
      />
      <HubTabs />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState title="No simulations yet" hint="Estimate a demurrage charge before it lands on a dossier." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <div key={String(r.extra_charge_simulation_id)} className="lux-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{cell(r.shipping_line) === "—" ? "Demurrage" : cell(r.shipping_line)}</span>
                <span className="text-xs text-muted-foreground">{dateFmt(r.created_at)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{cell(r.container_variant)} · {r.free_days != null ? `${cell(r.free_days)} free days` : "—"}</p>
              <p className="mt-2 text-sm font-semibold text-primary">{money(r.total_amount, r.currency)}</p>
            </div>
          ))}
        </div>
      )}

      <AiActions actions={EXTRA_AI} />
      <ExtraSimForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={reload} />
    </section>
  );
}

/* ═══════════════════════════════ PRICING VARIANCE ═══════════════════════════════ */
