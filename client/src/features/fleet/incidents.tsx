/**
 * Incidents — report → review → closed workflow (replaces the CRUD table).
 * Log a fleet incident against a vehicle/driver, then move it OPEN →
 * UNDER_REVIEW → CLOSED. (Insurance claims hang off a reviewed incident.)
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { TransitionButtons } from "@/components/ui/workflow";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { dateTimeFmt, enumLabel } from "@/lib/format";
import * as api from "@/lib/fleet-api";
import { reportActionError } from "@/lib/action-error";

const shell = "mx-auto max-w-6xl animate-fade-in";
const STATUS_TONE: Record<string, Tone> = { OPEN: "blue", UNDER_REVIEW: "warn", CLOSED: "ok" };
const SEV_TONE: Record<string, Tone> = { MINOR: "blue", MAJOR: "warn", TOTAL: "bad" };
const TRANSITIONS: Record<string, string[]> = { OPEN: ["UNDER_REVIEW", "CLOSED"], UNDER_REVIEW: ["CLOSED"], CLOSED: [] };
const STATUS_LABEL: Record<string, string> = { UNDER_REVIEW: "Start review", CLOSED: "Close" };

function NewIncidentForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const vehicles = useResource(() => api.listVehicles(), []);
  const { rows: drivers } = useList<{ employee_id: string; full_name?: string }>("/employees");
  const [f, setF] = React.useState({ vehicle_id: "", driver_employee_id: "", occurred_at: "", severity: "MINOR", description: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.createIncident({
        vehicle_id: f.vehicle_id || undefined,
        driver_employee_id: f.driver_employee_id || undefined,
        occurred_at: f.occurred_at || undefined,
        severity: f.severity,
        description: f.description || undefined,
      });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Report incident" description="Log a fleet incident. It opens for review.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vehicle">
            <Select value={f.vehicle_id} onChange={(e) => set("vehicle_id", e.target.value)}>
              <option value="">—</option>
              {(vehicles.data || []).map((v) => <option key={v.vehicle_id} value={v.vehicle_id}>{v.registration || v.vehicle_id.slice(0, 8)}</option>)}
            </Select>
          </Field>
          <Field label="Driver">
            <Select value={f.driver_employee_id} onChange={(e) => set("driver_employee_id", e.target.value)}>
              <option value="">—</option>
              {(drivers || []).map((d) => <option key={d.employee_id} value={d.employee_id}>{d.full_name || d.employee_id}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Occurred at"><Input type="datetime-local" value={f.occurred_at} onChange={(e) => set("occurred_at", e.target.value)} /></Field>
          <Field label="Severity" required>
            <Select value={f.severity} onChange={(e) => set("severity", e.target.value)}>
              <option value="MINOR">Minor</option>
              <option value="MAJOR">Major</option>
              <option value="TOTAL">Total</option>
            </Select>
          </Field>
        </div>
        <Field label="Description"><Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What happened" /></Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>Report</Button>
        </div>
      </form>
    </Modal>
  );
}

export function IncidentsPage() {
  const inc = useResource(() => api.listIncidents(), []);
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function toStatus(i: api.Incident, status: string) {
    setBusy(i.fleet_incident_id + status);
    try { await api.setIncidentStatus(i.fleet_incident_id, status); inc.reload(); } catch (e) { reportActionError(e); } finally { setBusy(null); }
  }

  const cols: Column<api.Incident>[] = [
    { key: "when", label: "Occurred", render: (i) => <span className="num text-muted-foreground">{i.occurred_at ? dateTimeFmt(i.occurred_at) : "—"}</span> },
    { key: "veh", label: "Vehicle", render: (i) => <span className="num font-medium text-foreground">{i.registration || "—"}</span> },
    { key: "drv", label: "Driver", render: (i) => <span className="text-muted-foreground">{i.driver_name || "—"}</span> },
    { key: "sev", label: "Severity", render: (i) => <Pill tone={SEV_TONE[i.severity || ""] || "mute"}>{enumLabel(i.severity)}</Pill> },
    { key: "status", label: "Status", render: (i) => <Pill tone={STATUS_TONE[i.status || ""] || "mute"}>{enumLabel(i.status)}</Pill> },
    {
      key: "_a", label: "",
      render: (i) => (
        <TransitionButtons
          items={(TRANSITIONS[i.status || ""] || []).map((s) => ({ to: s, label: STATUS_LABEL[s] || s, variant: s === "CLOSED" ? "outline" : "default", loading: busy === i.fleet_incident_id + s }))}
          onTransition={(s) => toStatus(i, s)}
        />
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Fleet" to="/fleet" />} title="Incidents" description="Report fleet incidents and work them through review to closure." action={<Button onClick={() => setCreating(true)}>Report incident</Button>} />
      <HubTabs />
      <DataList columns={cols} rows={inc.data} error={inc.error} loading={inc.loading} rowKey={(i) => i.fleet_incident_id} empty={{ title: "No incidents", hint: "A clean record — report one if something happens." }} />
      {creating && <NewIncidentForm onClose={() => setCreating(false)} onSaved={inc.reload} />}
      <ScreenAi path="fleet/incidents" />
    </section>
  );
}

export default IncidentsPage;
