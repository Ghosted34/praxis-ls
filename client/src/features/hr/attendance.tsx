/**
 * Attendance — manager view. Employees clock in/out from the floating clock in
 * the bottom-right (see components/clock-punch). This screen is for oversight:
 * the day's clock-ins with lateness + on-site status, who's absent, and the
 * worksite geofences. Uses the locked kit.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, errMsg } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import * as api from "@/lib/hr-api";
import { reportActionError } from "@/lib/action-error";

const shell = pageShell.wide;
const today = () => new Date().toISOString().slice(0, 10);

function SitePill({ within }: { within?: boolean | null }) {
  if (within == null) return <Pill tone="mute">No fix</Pill>;
  return within ? <Pill tone="ok">On-site</Pill> : <Pill tone="bad">Off-site</Pill>;
}
const metres = (v: unknown) => (v == null ? null : `${Math.round(Number(v))} m`);

/* ── Day's clock-ins with lateness ── */
function AttendanceLog({ date }: { date: string }) {
  const log = useResource(() => api.listAttendance({ date }), [date]);
  const cols: Column<api.AttendanceRow>[] = [
    { key: "emp", label: "Employee", render: (r) => <span className="font-medium text-foreground">{r.employee_name || "—"}</span> },
    {
      key: "in", label: "Clock in",
      render: (r) => (
        <span className="flex items-center gap-2">
          <span className="num">{dateFmt(r.clock_in_at)}</span>
          {r.is_late && <Pill tone="bad">Late{r.minutes_late ? ` ${r.minutes_late}m` : ""}</Pill>}
        </span>
      ),
    },
    { key: "out", label: "Clock out", render: (r) => (r.clock_out_at ? <span className="num">{dateFmt(r.clock_out_at)}</span> : <Pill tone="warn">open</Pill>) },
    { key: "site", label: "On-site", render: (r) => <SitePill within={r.within_geofence} /> },
    { key: "where", label: "Where", render: (r) => <span className="text-muted-foreground">{r.geo_label || "—"}{metres(r.distance_m) ? ` · ${metres(r.distance_m)}` : ""}</span> },
  ];
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Clock-ins</h2>
      <DataList columns={cols} rows={log.data} error={log.error} loading={log.loading} rowKey={(r) => r.attendance_id} empty={{ title: "No clock-ins", hint: "Nobody has clocked in on this day." }} />
    </div>
  );
}

/* ── Absences for the day ── */
function AbsencePanel({ date }: { date: string }) {
  const a = useResource(() => api.absence(date), [date]);
  const rows = a.data?.absent || [];
  return (
    <div>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        Absent <Pill tone={rows.length ? "bad" : "ok"}>{a.data?.count ?? 0}</Pill>
      </h2>
      {a.loading ? (
        <div className="py-3 text-center micro">Loading…</div>
      ) : a.error ? (
        <ErrorState message={a.error} />
      ) : rows.length === 0 ? (
        <div className="lux-card p-4 text-sm text-muted-foreground">Everyone active clocked in.</div>
      ) : (
        <ul className="lux-card divide-y divide-border">
          {rows.map((e) => (
            <li key={e.employee_id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-foreground">{e.full_name}</span>
              <span className="micro">{e.department || "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Worksite geofences (admin config) ── */
function SiteForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ name: "", latitude: "", longitude: "", radius_m: "150" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function useHere() {
    try { const fix = await api.getFix(); setF((s) => ({ ...s, latitude: String(fix.latitude), longitude: String(fix.longitude) })); }
    catch (e) { setError(errMsg(e)); }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.createSite({ name: f.name.trim(), latitude: Number(f.latitude), longitude: Number(f.longitude), radius_m: Number(f.radius_m) || 150 });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  const canSave = f.name.trim() && f.latitude !== "" && f.longitude !== "" && !busy;
  return (
    <Modal open onClose={onClose} title="New worksite" description="A geofence centre — clock-ins within the radius are on-site.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Name" required><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Douala yard" /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Latitude" required><Input className="num" value={f.latitude} onChange={(e) => set("latitude", e.target.value)} placeholder="4.0511" /></Field>
          <Field label="Longitude" required><Input className="num" value={f.longitude} onChange={(e) => set("longitude", e.target.value)} placeholder="9.7679" /></Field>
          <Field label="Radius (m)"><Input className="num" type="number" value={f.radius_m} onChange={(e) => set("radius_m", e.target.value)} /></Field>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={useHere}>Use my current location</Button>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!canSave}>Add worksite</Button>
        </div>
      </form>
    </Modal>
  );
}

function Worksites() {
  const sites = useResource(() => api.listSites(), []);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  async function toggle(s: api.WorkSite) {
    setBusy(s.work_site_id);
    try { await api.updateSite(s.work_site_id, { is_active: !s.is_active }); sites.reload(); } catch (e) { reportActionError(e); } finally { setBusy(null); }
  }
  const cols: Column<api.WorkSite>[] = [
    { key: "name", label: "Worksite", render: (s) => <span className="font-medium text-foreground">{s.name}</span> },
    { key: "coords", label: "Centre", render: (s) => <span className="num text-muted-foreground">{Number(s.latitude).toFixed(4)}, {Number(s.longitude).toFixed(4)}</span> },
    { key: "radius", label: "Radius", render: (s) => <span className="num">{s.radius_m} m</span> },
    { key: "active", label: "Active", render: (s) => <Pill tone={s.is_active ? "ok" : "mute"}>{s.is_active ? "Active" : "Off"}</Pill> },
    { key: "_a", label: "", render: (s) => <div className="flex justify-end"><Button size="sm" variant="outline" loading={busy === s.work_site_id} onClick={() => toggle(s)}>{s.is_active ? "Disable" : "Enable"}</Button></div> },
  ];
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Worksites (geofences)</h2>
        <Button size="sm" onClick={() => setOpen(true)}>New worksite</Button>
      </div>
      <DataList columns={cols} rows={sites.data} error={sites.error} loading={sites.loading} rowKey={(s) => s.work_site_id} empty={{ title: "No worksites", hint: "Add one so clock-ins can be checked against it." }} />
      {open && <SiteForm onClose={() => setOpen(false)} onSaved={sites.reload} />}
    </div>
  );
}

export function AttendancePage() {
  const [date, setDate] = React.useState(today);
  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Human capital" to="/hr" />} title="Attendance" description="Team clock-ins, lateness and absences. Employees clock in/out from the clock in the bottom-right." />
      <HubTabs />      <div className="mb-4 flex items-center gap-3">
        <span className="micro">Day</span>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
        <AttendanceLog date={date} />
        <AbsencePanel date={date} />
      </div>
      <div className="mt-8">
        <Worksites />
      </div>
      <ScreenAi path="hr/attendance" />
    </section>
  );
}

export default AttendancePage;
