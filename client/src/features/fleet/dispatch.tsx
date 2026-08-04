/**
 * Fleet dispatch — board (replaces the CRUD table). Assign a vehicle + driver,
 * then check out (odometer) and check in (odometer) through the lifecycle
 * ASSIGNED → OUT → RETURNED. Driver time on a dossier is costed on return.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { DocButton } from "@/components/doc-button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { TransitionButtons, type Transition } from "@/components/ui/workflow";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { num, dateFmt } from "@/lib/format";
import * as api from "@/lib/fleet-api";
import { reportActionError } from "@/lib/action-error";

const shell = pageShell.wide;
const STATUS_TONE: Record<string, Tone> = { ASSIGNED: "blue", OUT: "warn", RETURNED: "ok", CANCELLED: "bad" };

type Dossier = { dossier_id: string; ref?: string | null };

/* Check-out / check-in odometer capture */
function OdometerModal({ dispatch, to, onClose, onSaved }: { dispatch: api.Dispatch; to: "OUT" | "RETURNED"; onClose: () => void; onSaved: () => void }) {
  const [odo, setOdo] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.setDispatchStatus(dispatch.fleet_dispatch_id, to, odo === "" ? undefined : Number(odo)); onSaved(); onClose(); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={to === "OUT" ? "Check out vehicle" : "Check in vehicle"} description={`${dispatch.registration || "Vehicle"} · ${dispatch.driver_name || "driver"}`}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Odometer (km)" hint={to === "RETURNED" && dispatch.odometer_out != null ? `Out at ${num(dispatch.odometer_out)}` : undefined}>
          <Input type="number" className="num text-right" value={odo} onChange={(e) => setOdo(e.target.value)} />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>{to === "OUT" ? "Check out" : "Check in"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function NewDispatchForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const vehicles = useResource(() => api.listVehicles(), []);
  const { rows: drivers } = useList<{ employee_id: string; full_name?: string }>("/employees");
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [f, setF] = React.useState({ vehicle_id: "", driver_employee_id: "", dossier_id: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.createDispatch({ vehicle_id: f.vehicle_id, driver_employee_id: f.driver_employee_id || undefined, dossier_id: f.dossier_id || undefined });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New dispatch" description="Assign a vehicle and driver — optionally to a dossier for cost attribution.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Vehicle" required>
          <Select value={f.vehicle_id} onChange={(e) => set("vehicle_id", e.target.value)}>
            <option value="">—</option>
            {(vehicles.data || []).map((v) => <option key={v.vehicle_id} value={v.vehicle_id}>{v.registration || v.vehicle_id.slice(0, 8)}{v.category ? ` · ${v.category}` : ""}</option>)}
          </Select>
        </Field>
        <Field label="Driver">
          <Select value={f.driver_employee_id} onChange={(e) => set("driver_employee_id", e.target.value)}>
            <option value="">—</option>
            {(drivers || []).map((d) => <option key={d.employee_id} value={d.employee_id}>{d.full_name || d.employee_id}</option>)}
          </Select>
        </Field>
        <Field label="Dossier" hint="Optional — driver time is costed here on return">
          <Select value={f.dossier_id} onChange={(e) => set("dossier_id", e.target.value)}>
            <option value="">—</option>
            {(dossiers || []).map((d) => <option key={d.dossier_id} value={d.dossier_id}>{d.ref || d.dossier_id.slice(0, 8)}</option>)}
          </Select>
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.vehicle_id || busy}>Assign</Button>
        </div>
      </form>
    </Modal>
  );
}

export function DispatchPage() {
  const disp = useResource(() => api.listDispatch(), []);
  const [creating, setCreating] = React.useState(false);
  const [odo, setOdo] = React.useState<{ dispatch: api.Dispatch; to: "OUT" | "RETURNED" } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function cancel(d: api.Dispatch) {
    setBusy(d.fleet_dispatch_id);
    try { await api.setDispatchStatus(d.fleet_dispatch_id, "CANCELLED"); disp.reload(); } catch (e) { reportActionError(e); } finally { setBusy(null); }
  }

  const cols: Column<api.Dispatch>[] = [
    { key: "veh", label: "Vehicle", render: (d) => <span className="num font-medium text-foreground">{d.registration || "—"}</span> },
    { key: "drv", label: "Driver", render: (d) => <span className="text-muted-foreground">{d.driver_name || "—"}</span> },
    { key: "status", label: "Status", render: (d) => <Pill tone={STATUS_TONE[d.status] || "mute"}>{d.status}</Pill> },
    { key: "out", label: "Out", render: (d) => <span className="num text-muted-foreground">{d.check_out_at ? `${dateFmt(d.check_out_at)}${d.odometer_out != null ? ` · ${num(d.odometer_out)}km` : ""}` : "—"}</span> },
    { key: "in", label: "In", render: (d) => <span className="num text-muted-foreground">{d.check_in_at ? `${dateFmt(d.check_in_at)}${d.odometer_in != null ? ` · ${num(d.odometer_in)}km` : ""}` : "—"}</span> },
    {
      key: "_a", label: "",
      render: (d) => {
        const items: Transition[] =
          d.status === "ASSIGNED"
            ? [
                { to: "CANCELLED", label: "Cancel", variant: "outline", loading: busy === d.fleet_dispatch_id },
                { to: "OUT", label: "Check out" },
              ]
            : d.status === "OUT"
              ? [{ to: "RETURNED", label: "Check in" }]
              : [];
        return (
          <div className="flex items-center justify-end gap-2">
            <DocButton docType="TRIP_SHEET" id={d.fleet_dispatch_id} title={`Trip sheet ${d.registration || d.fleet_dispatch_id.slice(0, 8)}`} label="View" />
            <TransitionButtons
              items={items}
              onTransition={(to) => (to === "CANCELLED" ? cancel(d) : setOdo({ dispatch: d, to: to as "OUT" | "RETURNED" }))}
            />
          </div>
        );
      },
    },
  ];

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Fleet" to="/fleet" />} title="Dispatch" description="Assign vehicles and drivers; check out and in with odometer readings." action={<Button onClick={() => setCreating(true)}>New dispatch</Button>} />
      <HubTabs />
      <DataList columns={cols} rows={disp.data} error={disp.error} loading={disp.loading} rowKey={(d) => d.fleet_dispatch_id} empty={{ title: "No dispatches", hint: "Assign a vehicle to get started." }} />
      {creating && <NewDispatchForm onClose={() => setCreating(false)} onSaved={disp.reload} />}
      {odo && <OdometerModal dispatch={odo.dispatch} to={odo.to} onClose={() => setOdo(null)} onSaved={disp.reload} />}
      <ScreenAi path="fleet/dispatch" />
    </section>
  );
}

export default DispatchPage;
