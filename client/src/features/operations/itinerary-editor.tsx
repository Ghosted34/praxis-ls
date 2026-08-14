import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { useResource, errMsg } from "@/lib/use-resource";
import * as api from "@/lib/operations-api";

const TYPES: api.ItineraryLeg["leg_type"][] = ["PICKUP", "MAIN_CARRIAGE", "CUSTOMS", "INLAND_TRANSIT", "WAREHOUSE", "FINAL_DELIVERY", "OTHER"];
const MODES: api.ItineraryLeg["mode"][] = ["AIR", "SEA", "LAND", "OTHER"];
const label = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/(^| )\S/g, (m: string) => m.toUpperCase());

export function ItineraryEditor({ dossierId }: { dossierId: string }) {
  const data = useResource(() => api.getItinerary(dossierId), [dossierId]);
  const [legs, setLegs] = React.useState<api.ItineraryLeg[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (data.data) setLegs(data.data); }, [data.data]);
  const add = () => setLegs((x) => [...x, { leg_type: "FINAL_DELIVERY", mode: "LAND", status: "PLANNED", is_optional: true }]);
  const update = (i: number, patch: Partial<api.ItineraryLeg>) => setLegs((x) => x.map((l, j) => j === i ? { ...l, ...patch } : l));
  async function save() { setBusy(true); setError(null); try { await api.replaceItinerary(dossierId, legs.map((l, i) => ({ ...l, seq: i + 1 }))); await data.reload(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); } }
  if (data.loading) return <div className="micro">Loading itinerary…</div>;
  return <div className="space-y-3">
    <div className="flex items-center justify-between"><div><h3 className="font-semibold">Itinerary</h3><p className="micro">Optional legs are created from the service type and can be tailored per file.</p></div><Button size="sm" variant="outline" onClick={add}>Add leg</Button></div>
    {legs.length === 0 && <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No structured itinerary yet. Add a leg for this file.</div>}
    {legs.map((l, i) => <div key={l.itinerary_leg_id || i} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[1fr_1fr_1.2fr_1.2fr_auto]">
      <Select aria-label="Leg type" value={l.leg_type} onChange={(e) => update(i, { leg_type: e.target.value as api.ItineraryLeg["leg_type"] })}>{TYPES.map((v) => <option key={v} value={v}>{label(v)}</option>)}</Select>
      <Select aria-label="Leg mode" value={l.mode} onChange={(e) => update(i, { mode: e.target.value as api.ItineraryLeg["mode"] })}>{MODES.map((v) => <option key={v} value={v}>{label(v)}</option>)}</Select>
      <Input aria-label="Origin" placeholder="Origin / pickup address" value={l.origin || ""} onChange={(e) => update(i, { origin: e.target.value })} />
      <Input aria-label="Destination" placeholder="Destination / delivery address" value={l.destination || ""} onChange={(e) => update(i, { destination: e.target.value })} />
      <Button size="sm" variant="ghost" onClick={() => setLegs((x) => x.filter((_, j) => j !== i))}>Remove</Button>
      <label className="flex items-center gap-2 text-xs text-muted-foreground md:col-span-5"><input type="checkbox" checked={!!l.is_optional} onChange={(e) => update(i, { is_optional: e.target.checked })} /> Optional leg</label>
    </div>)}
    {error && <ErrorState message={error} />}
    <Button size="sm" onClick={save} loading={busy}>Save itinerary</Button>
  </div>;
}
