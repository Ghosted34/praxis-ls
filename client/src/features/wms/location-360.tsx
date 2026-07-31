/**
 * Locations — location 360 (replaces the flat tree). Slots grouped by zone on the
 * left; pick one to see its rollup: stock stored there, handling equipment parked
 * there, cycle-count history, and capacity utilisation.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, errMsg } from "@/lib/use-resource";
import { num, dateFmt, enumLabel } from "@/lib/format";
import * as api from "@/lib/wms-api";

const shell = "mx-auto max-w-6xl animate-fade-in";
const STATE_TONE: Record<string, Tone> = { AVAILABLE: "ok", QA_HOLD: "warn", ALLOCATED: "blue", DISPATCHED: "mute", DAMAGED: "bad" };
const EQ_TONE: Record<string, Tone> = { AVAILABLE: "ok", IN_USE: "blue", MAINTENANCE: "warn", OUT_OF_SERVICE: "bad" };

const TABS = ["Inventory", "Equipment", "Cycle counts"] as const;
type Tab = (typeof TABS)[number];

function MiniTable({ head, children, empty }: { head: React.ReactNode; children: React.ReactNode; empty: boolean }) {
  if (empty) return <div className="px-3 py-6 text-center micro">Nothing here yet.</div>;
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground"><tr>{head}</tr></thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
const Th = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => <th className={`px-3 py-2 font-medium ${r ? "text-right" : "text-left"}`}>{children}</th>;
const Td = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => <td className={`px-3 py-1.5 ${r ? "text-right num" : ""}`}>{children}</td>;

function NewLocationForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ zone: "", aisle: "", rack: "", bin: "", yard: "", capacity_units: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.createLocation({
        zone: f.zone || undefined, aisle: f.aisle || undefined, rack: f.rack || undefined,
        bin: f.bin || undefined, yard: f.yard || undefined,
        capacity_units: f.capacity_units === "" ? undefined : Number(f.capacity_units),
      });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New location" description="Add a slotting location — a zone/aisle/rack/bin, or a yard slot.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Zone"><Input value={f.zone} onChange={(e) => set("zone", e.target.value)} placeholder="A" /></Field>
          <Field label="Aisle"><Input value={f.aisle} onChange={(e) => set("aisle", e.target.value)} placeholder="01" /></Field>
          <Field label="Rack"><Input value={f.rack} onChange={(e) => set("rack", e.target.value)} placeholder="R1" /></Field>
          <Field label="Bin"><Input value={f.bin} onChange={(e) => set("bin", e.target.value)} placeholder="B1" /></Field>
          <Field label="Yard" hint="For open-yard slots"><Input value={f.yard} onChange={(e) => set("yard", e.target.value)} placeholder="Y1" /></Field>
          <Field label="Capacity (units)"><Input type="number" className="num text-right" value={f.capacity_units} onChange={(e) => set("capacity_units", e.target.value)} /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>Add location</Button>
        </div>
      </form>
    </Modal>
  );
}

function LocationDetail({ location, inventory, equipment, counts }: {
  location: api.WarehouseLocation; inventory: api.InventoryItem[]; equipment: api.Equipment[]; counts: api.CycleCount[];
}) {
  const [tab, setTab] = React.useState<Tab>("Inventory");
  const lid = location.location_id;
  const items = inventory.filter((i) => i.location_id === lid);
  const equip = equipment.filter((e) => e.location_id === lid);
  const cc = counts.filter((c) => c.location_id === lid);
  const onHand = items.reduce((s, i) => s + Number(i.qty_on_hand || 0), 0);
  const cap = location.capacity_units != null ? Number(location.capacity_units) : null;
  const usedPct = cap && cap > 0 ? Math.round((onHand / cap) * 100) : null;
  const tabCounts: Record<Tab, number> = { Inventory: items.length, Equipment: equip.length, "Cycle counts": cc.length };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5">
        <h3 className="num text-lg font-semibold text-foreground">{api.locationLabel(location)}</h3>
        <p className="mt-1 micro">{location.zone ? `Zone ${location.zone}` : location.yard ? "Yard" : "Unzoned"}{cap != null ? ` · capacity ${num(cap)} units` : ""}</p>
      </div>

      <KpiRow>
        <KpiTile label="Items stored" value={num(items.length)} />
        <KpiTile label="On hand" value={num(Math.round(onHand))} />
        <KpiTile label="Equipment" value={num(equip.length)} />
        <KpiTile label="Capacity used" value={usedPct != null ? `${usedPct}%` : "—"} />
      </KpiRow>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t}<span className="ml-1.5 micro">{tabCounts[t]}</span>
          </button>
        ))}
      </div>

      {tab === "Inventory" && (
        <MiniTable empty={items.length === 0} head={<><Th>SKU</Th><Th>Item</Th><Th r>On hand</Th><Th>State</Th></>}>
          {items.map((i) => (
            <tr key={i.inventory_item_id}><Td>{i.sku || "—"}</Td><Td>{i.description}</Td><Td r>{num(i.qty_on_hand)} {i.uom || ""}</Td><Td><Pill tone={STATE_TONE[i.state] || "mute"}>{i.state}</Pill></Td></tr>
          ))}
        </MiniTable>
      )}
      {tab === "Equipment" && (
        <MiniTable empty={equip.length === 0} head={<><Th>Equipment</Th><Th>Status</Th></>}>
          {equip.map((e) => (
            <tr key={e.wms_equipment_id}><Td>{e.label}</Td><Td><Pill tone={EQ_TONE[e.status] || "mute"}>{enumLabel(e.status)}</Pill></Td></tr>
          ))}
        </MiniTable>
      )}
      {tab === "Cycle counts" && (
        <MiniTable empty={cc.length === 0} head={<><Th>Counted</Th><Th r>Lines</Th><Th>Result</Th></>}>
          {cc.map((c) => (
            <tr key={c.cycle_count_id}><Td>{dateFmt(c.created_at)}</Td><Td r>{num(c.discrepancy_summary?.lines ?? 0)}</Td><td className="px-3 py-1.5">{c.discrepancy_summary?.has_discrepancy ? <Pill tone="bad">{c.discrepancy_summary.off_lines} off</Pill> : <Pill tone="ok">Match</Pill>}</td></tr>
          ))}
        </MiniTable>
      )}
    </div>
  );
}

export function LocationsPage() {
  const locs = useResource(() => api.listLocations(), []);
  const inventory = useResource(() => api.listInventory(), []);
  const equipment = useResource(() => api.listEquipment(), []);
  const counts = useResource(() => api.listCycleCounts(), []);
  const [selId, setSelId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const rows = locs.data || [];
  const filtered = q ? rows.filter((l) => api.locationLabel(l).toLowerCase().includes(q.toLowerCase())) : rows;
  const selected = rows.find((l) => l.location_id === selId) || null;
  React.useEffect(() => { if (!selId && rows.length) setSelId(rows[0].location_id); }, [rows, selId]);

  const groups = React.useMemo(() => {
    const m: Record<string, api.WarehouseLocation[]> = {};
    filtered.forEach((l) => { const k = l.zone || (l.yard ? "Yard" : "Unzoned"); (m[k] || (m[k] = [])).push(l); });
    return Object.entries(m).sort(([a], [b]) => (a === "Yard" ? 1 : b === "Yard" ? -1 : a.localeCompare(b)));
  }, [filtered]);

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Warehouse" to="/wms" />} title="Locations" description="Warehouse slotting with a per-location 360 — stock, equipment, counts and capacity." action={<Button onClick={() => setCreating(true)}>New location</Button>} />
      <HubTabs />
      {locs.error ? <ErrorState message={locs.error} /> : (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          <div className="space-y-2">
            <Input placeholder="Search slot…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="max-h-[70vh] space-y-2 overflow-auto rounded-lg border p-1">
              {locs.loading ? <div className="px-3 py-4 micro">Loading…</div> : groups.length === 0 ? <div className="px-3 py-4 micro">No locations.</div> : groups.map(([zone, items]) => (
                <div key={zone}>
                  <div className="px-2 py-1 micro">Zone {zone}</div>
                  {items.map((l) => (
                    <button key={l.location_id} onClick={() => setSelId(l.location_id)}
                      className={`block w-full truncate rounded-md px-3 py-1.5 text-left text-sm transition-colors ${l.location_id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}>
                      <span className="num font-medium">{api.locationLabel(l)}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
          {selected ? (
            <LocationDetail location={selected} inventory={inventory.data || []} equipment={equipment.data || []} counts={counts.data || []} />
          ) : <EmptyState title="No location selected" hint="Choose a slot from the list." />}
        </div>
      )}
      {creating && <NewLocationForm onClose={() => setCreating(false)} onSaved={locs.reload} />}
      <ScreenAi path="wms/locations" />
    </section>
  );
}

export default LocationsPage;
