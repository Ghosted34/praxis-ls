/**
 * Equipment — allocation board (replaces the CRUD table). Handling equipment
 * (forklifts, reach-stackers) grouped by status; check out to an operator, return,
 * send to maintenance or retire, following the status lifecycle.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader } from "@/components/data-list";
import { TransitionButtons, type Transition } from "@/components/ui/workflow";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import * as api from "@/lib/wms-api";
import { reportActionError } from "@/lib/action-error";

const shell = "mx-auto max-w-6xl animate-fade-in";
const COLUMNS = ["AVAILABLE", "IN_USE", "MAINTENANCE", "OUT_OF_SERVICE"];
const COL_LABEL: Record<string, string> = { AVAILABLE: "Available", IN_USE: "In use", MAINTENANCE: "Maintenance", OUT_OF_SERVICE: "Out of service" };
const COL_TONE: Record<string, Tone> = { AVAILABLE: "ok", IN_USE: "blue", MAINTENANCE: "warn", OUT_OF_SERVICE: "bad" };

type Usr = { user_id: string; full_name?: string };

function CheckoutModal({ item, users, onClose, onSaved }: { item: api.Equipment; users: Usr[]; onClose: () => void; onSaved: () => void }) {
  const [user, setUser] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.setEquipmentStatus(item.wms_equipment_id, "IN_USE", user || undefined); onSaved(); onClose(); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Check out" description={`Assign ${item.label} to an operator.`}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Operator">
          <Select value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">—</option>
            {users.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name || u.user_id.slice(0, 8)}</option>)}
          </Select>
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>Check out</Button>
        </div>
      </form>
    </Modal>
  );
}

function NewEquipmentForm({ locations, onClose, onSaved }: { locations: api.WarehouseLocation[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ label: "", location_id: "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.createEquipment({ label: f.label, location_id: f.location_id || undefined }); onSaved(); onClose(); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New equipment" description="Register handling equipment.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Label" required><Input value={f.label} onChange={(e) => setF((s) => ({ ...s, label: e.target.value }))} placeholder="Forklift 3T" /></Field>
        <Field label="Location">
          <Select value={f.location_id} onChange={(e) => setF((s) => ({ ...s, location_id: e.target.value }))}>
            <option value="">—</option>
            {locations.map((l) => <option key={l.location_id} value={l.location_id}>{api.locationLabel(l)}</option>)}
          </Select>
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.label || busy}>Add</Button>
        </div>
      </form>
    </Modal>
  );
}

export function EquipmentPage() {
  const equipment = useResource(() => api.listEquipment(), []);
  const locs = useResource(() => api.listLocations(), []);
  const { rows: users } = useList<Usr>("/users");
  const [checkout, setCheckout] = React.useState<api.Equipment | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const userMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    (users || []).forEach((u) => { m[u.user_id] = u.full_name || u.user_id.slice(0, 8); });
    return m;
  }, [users]);
  const slot = (e: api.Equipment) => [e.zone, e.aisle, e.rack, e.bin].filter(Boolean).join(" · ");

  async function move(e: api.Equipment, status: string) {
    setBusy(e.wms_equipment_id);
    try { await api.setEquipmentStatus(e.wms_equipment_id, status); equipment.reload(); } catch (e) { reportActionError(e); } finally { setBusy(null); }
  }

  const byStatus = React.useMemo(() => {
    const m: Record<string, api.Equipment[]> = {};
    COLUMNS.forEach((c) => { m[c] = []; });
    (equipment.data || []).forEach((e) => { (m[e.status] || (m[e.status] = [])).push(e); });
    return m;
  }, [equipment.data]);

  function actions(e: api.Equipment) {
    const b = busy === e.wms_equipment_id;
    const byStatus: Record<string, Transition[]> = {
      AVAILABLE: [{ to: "CHECKOUT", label: "Check out" }, { to: "MAINTENANCE", label: "Maint.", variant: "outline" }],
      IN_USE: [{ to: "AVAILABLE", label: "Return", loading: b }, { to: "MAINTENANCE", label: "Maint.", variant: "outline" }],
      MAINTENANCE: [{ to: "AVAILABLE", label: "Available", loading: b }, { to: "OUT_OF_SERVICE", label: "Retire", variant: "outline" }],
    };
    const items = byStatus[e.status] || [{ to: "AVAILABLE", label: "Restore", variant: "outline", loading: b }];
    return <TransitionButtons items={items} onTransition={(to) => (to === "CHECKOUT" ? setCheckout(e) : move(e, to))} className="justify-start" />;
  }

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Warehouse" to="/wms" />} title="Equipment" description="Handling equipment allocation — check out, return, maintain." action={<Button onClick={() => setCreating(true)}>New equipment</Button>} />
      <HubTabs />
      {equipment.error ? <ErrorState message={equipment.error} /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col}>
              <div className="mb-2 flex items-center justify-between px-1">
                <Pill tone={COL_TONE[col]}>{COL_LABEL[col]}</Pill>
                <span className="micro">{byStatus[col]?.length || 0}</span>
              </div>
              <div className="space-y-2 rounded-lg border bg-muted/30 p-2 min-h-24">
                {equipment.loading ? <div className="px-2 py-3 micro">Loading…</div> : (byStatus[col] || []).map((e) => (
                  <div key={e.wms_equipment_id} className="rounded-md border bg-card p-3">
                    <div className="text-sm font-medium text-foreground">{e.label}</div>
                    <div className="mt-0.5 micro">{e.status === "IN_USE" && e.assigned_to ? userMap[e.assigned_to] || "assigned" : slot(e) || "—"}</div>
                    <div className="mt-2 flex flex-wrap gap-1">{actions(e)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {checkout && <CheckoutModal item={checkout} users={users || []} onClose={() => setCheckout(null)} onSaved={equipment.reload} />}
      {creating && <NewEquipmentForm locations={locs.data || []} onClose={() => setCreating(false)} onSaved={equipment.reload} />}
      <ScreenAi path="wms/equipment" />
    </section>
  );
}

export default EquipmentPage;
