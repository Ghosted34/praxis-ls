/**
 * Cycle counts — count sheet (replaces the CRUD blob form). Pick a location,
 * count each item against its expected on-hand, see the variance live, and submit
 * — a discrepancy raises the reconciliation event. Past counts show their result.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, errMsg } from "@/lib/use-resource";
import { num, dateFmt } from "@/lib/format";
import * as api from "@/lib/wms-api";

const shell = "mx-auto max-w-6xl animate-fade-in";

function CountSheet({ locations, onClose, onSaved }: { locations: api.WarehouseLocation[]; onClose: () => void; onSaved: () => void }) {
  const inv = useResource(() => api.listInventory(), []);
  const [locationId, setLocationId] = React.useState("");
  const [counts, setCounts] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const items = React.useMemo(() => (inv.data || []).filter((i) => i.location_id === locationId), [inv.data, locationId]);
  React.useEffect(() => {
    const c: Record<string, string> = {};
    items.forEach((i) => { c[i.inventory_item_id] = String(i.qty_on_hand); });
    setCounts(c);
  }, [locationId, inv.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const varianceOf = (i: api.InventoryItem) => Number(counts[i.inventory_item_id] ?? i.qty_on_hand) - Number(i.qty_on_hand);
  const offCount = items.filter((i) => varianceOf(i) !== 0).length;

  async function submit() {
    setBusy(true); setError(null);
    try {
      const discrepancy = items.map((i) => ({ inventory_item_id: i.inventory_item_id, expected: Number(i.qty_on_hand), counted: Number(counts[i.inventory_item_id] ?? i.qty_on_hand) }));
      await api.createCycleCount({ location_id: locationId, discrepancy });
      onSaved(); onClose();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} size="xl" title="Cycle count" description="Count physical stock against the system and submit any variance.">
      <div className="space-y-4">
        <Field label="Location" required>
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Choose a location…</option>
            {locations.map((l) => <option key={l.location_id} value={l.location_id}>{api.locationLabel(l)}</option>)}
          </Select>
        </Field>

        {!locationId ? (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">Pick a location to load its stock.</div>
        ) : inv.loading ? (
          <div className="py-4 text-center micro">Loading stock…</div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">No stock recorded at this location.</div>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr><th className="px-3 py-2 text-left font-medium">Item</th><th className="px-3 py-2 text-right font-medium">Expected</th><th className="px-3 py-2 text-right font-medium">Counted</th><th className="px-3 py-2 text-right font-medium">Variance</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((i) => {
                    const v = varianceOf(i);
                    return (
                      <tr key={i.inventory_item_id}>
                        <td className="px-3 py-1.5">{i.description}{i.sku ? <span className="ml-2 num text-xs text-muted-foreground">{i.sku}</span> : null}</td>
                        <td className="px-3 py-1.5 text-right num">{num(i.qty_on_hand)}</td>
                        <td className="px-3 py-1.5 text-right">
                          <Input type="number" className="num ml-auto w-24 text-right" value={counts[i.inventory_item_id] ?? ""} onChange={(e) => setCounts((s) => ({ ...s, [i.inventory_item_id]: e.target.value }))} />
                        </td>
                        <td className={"px-3 py-1.5 text-right num " + (v === 0 ? "text-muted-foreground" : v > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-[rgb(var(--bad))]")}>{v > 0 ? `+${num(v)}` : num(v)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{offCount === 0 ? "No variance" : `${offCount} line${offCount > 1 ? "s" : ""} off`}</span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button onClick={submit} loading={busy}>Submit count</Button>
              </div>
            </div>
          </>
        )}
        {error && <ErrorState message={error} />}
      </div>
    </Modal>
  );
}

export function CycleCountsPage() {
  const counts = useResource(() => api.listCycleCounts(), []);
  const locs = useResource(() => api.listLocations(), []);
  const [open, setOpen] = React.useState(false);
  const locMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    (locs.data || []).forEach((l) => { m[l.location_id] = api.locationLabel(l); });
    return m;
  }, [locs.data]);

  const cols: Column<api.CycleCount>[] = [
    { key: "loc", label: "Location", render: (c) => <span className="font-medium text-foreground">{locMap[c.location_id || ""] || "—"}</span> },
    { key: "when", label: "Counted", render: (c) => <span className="num">{dateFmt(c.created_at)}</span> },
    { key: "lines", label: "Lines", className: "num text-right", render: (c) => num(c.discrepancy_summary?.lines ?? 0) },
    {
      key: "result", label: "Result",
      render: (c) => {
        const s = c.discrepancy_summary;
        if (!s || !s.has_discrepancy) return <Pill tone="ok">Match</Pill>;
        return <Pill tone="bad">{s.off_lines} off · net {num(s.net_variance)}</Pill>;
      },
    },
  ];

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Warehouse" />} title="Cycle counts" description="Count stock against the system by location; variances raise reconciliation." action={<Button onClick={() => setOpen(true)}>New count</Button>} />
      <HubTabs />
      <DataList columns={cols} rows={counts.data} error={counts.error} loading={counts.loading} rowKey={(c) => c.cycle_count_id} empty={{ title: "No counts yet", hint: "Run a count on a location to check stock accuracy." }} />
      {open && <CountSheet locations={locs.data || []} onClose={() => setOpen(false)} onSaved={counts.reload} />}
    </section>
  );
}

export default CycleCountsPage;
