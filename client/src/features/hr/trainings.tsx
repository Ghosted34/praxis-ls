/**
 * Trainings — session + roster (replaces the CRUD table). Schedule a session and
 * move it SCHEDULED → DONE | CANCELLED; open a session to manage its attendance
 * roster (add employees, mark who attended).
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { dateFmt, enumLabel } from "@/lib/format";
import * as api from "@/lib/hr-api";
import { reportActionError } from "@/lib/action-error";

const shell = "mx-auto max-w-6xl animate-fade-in";
const STATUS_TONE: Record<string, Tone> = { SCHEDULED: "blue", DONE: "ok", CANCELLED: "bad" };
const TRANSITIONS: Record<string, string[]> = { SCHEDULED: ["DONE", "CANCELLED"], DONE: [], CANCELLED: [] };
const STATUS_LABEL: Record<string, string> = { DONE: "Mark done", CANCELLED: "Cancel" };

function RosterModal({ training, onClose }: { training: api.Training; onClose: () => void }) {
  const roster = useResource(() => api.listTrainingAttendees(training.training_id), [training.training_id]);
  const { rows: employees } = useList<{ employee_id: string; full_name?: string }>("/employees");
  const [add, setAdd] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const empMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    (employees || []).forEach((e) => { m[e.employee_id] = e.full_name || e.employee_id.slice(0, 8); });
    return m;
  }, [employees]);
  const present = new Set((roster.data || []).map((r) => r.employee_id));
  const addable = (employees || []).filter((e) => !present.has(e.employee_id));

  async function addAttendee(e: React.FormEvent) {
    e.preventDefault(); if (!add) return; setBusy("add"); setError(null);
    try { await api.addTrainingAttendee(training.training_id, add); setAdd(""); roster.reload(); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(null); }
  }
  async function toggle(a: api.TrainingAttendee) {
    setBusy(a.training_attendance_id); setError(null);
    try { await api.setTrainingAttendee(training.training_id, a.training_attendance_id, !a.attended); roster.reload(); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(null); }
  }

  const rows = roster.data || [];

  return (
    <Modal open onClose={onClose} size="lg" title={training.title || "Training"} description={`${training.scheduled_on ? dateFmt(training.scheduled_on) : "Unscheduled"}${training.facilitator ? ` · ${training.facilitator}` : ""}`}>
      <div className="space-y-4">
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground"><tr><th className="px-3 py-2 text-left font-medium">Employee</th><th className="px-3 py-2 text-right font-medium">Attendance</th></tr></thead>
            <tbody className="divide-y divide-border">
              {roster.loading ? <tr><td colSpan={2} className="px-3 py-4 text-center micro">Loading…</td></tr>
                : rows.length === 0 ? <tr><td colSpan={2} className="px-3 py-4 text-center micro">No attendees yet.</td></tr>
                : rows.map((a) => (
                  <tr key={a.training_attendance_id}>
                    <td className="px-3 py-1.5">{a.employee_id ? empMap[a.employee_id] || a.employee_id.slice(0, 8) : "—"}</td>
                    <td className="px-3 py-1.5 text-right">
                      <Button size="sm" variant={a.attended ? "default" : "outline"} loading={busy === a.training_attendance_id} onClick={() => toggle(a)}>{a.attended ? "Attended" : "Mark attended"}</Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {error && <ErrorState message={error} />}
        <form onSubmit={addAttendee} className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Add attendee">
            <Select value={add} onChange={(e) => setAdd(e.target.value)}>
              <option value="">Choose employee…</option>
              {addable.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.full_name || e.employee_id}</option>)}
            </Select>
          </Field>
          <Button type="submit" loading={busy === "add"} disabled={!add}>Add</Button>
        </form>
      </div>
    </Modal>
  );
}

function NewTrainingForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ title: "", scheduled_on: "", facilitator: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.createTraining({ title: f.title, scheduled_on: f.scheduled_on || undefined, facilitator: f.facilitator || undefined }); onSaved(); onClose(); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New training" description="Schedule a training session.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Title" required><Input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Forklift safety" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Scheduled on"><Input type="date" value={f.scheduled_on} onChange={(e) => set("scheduled_on", e.target.value)} /></Field>
          <Field label="Facilitator"><Input value={f.facilitator} onChange={(e) => set("facilitator", e.target.value)} /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.title || busy}>Schedule</Button>
        </div>
      </form>
    </Modal>
  );
}

export function TrainingsPage() {
  const trainings = useResource(() => api.listTrainings(), []);
  const [creating, setCreating] = React.useState(false);
  const [roster, setRoster] = React.useState<api.Training | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function toStatus(t: api.Training, status: string) {
    setBusy(t.training_id + status);
    try { await api.setTrainingStatus(t.training_id, status); trainings.reload(); } catch (e) { reportActionError(e); } finally { setBusy(null); }
  }

  const cols: Column<api.Training>[] = [
    { key: "title", label: "Title", render: (t) => <span className="font-medium text-foreground">{t.title || "—"}</span> },
    { key: "when", label: "Scheduled", render: (t) => <span className="num text-muted-foreground">{dateFmt(t.scheduled_on)}</span> },
    { key: "fac", label: "Facilitator", render: (t) => <span className="text-muted-foreground">{t.facilitator || "—"}</span> },
    { key: "status", label: "Status", render: (t) => <Pill tone={STATUS_TONE[t.status] || "mute"}>{enumLabel(t.status)}</Pill> },
    {
      key: "_a", label: "",
      render: (t) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setRoster(t)}>Roster</Button>
          {(TRANSITIONS[t.status] || []).map((s) => (
            <Button key={s} size="sm" variant={s === "CANCELLED" ? "outline" : "default"} loading={busy === t.training_id + s} onClick={() => toStatus(t, s)}>{STATUS_LABEL[s] || s}</Button>
          ))}
        </div>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Human capital" to="/hr" />} title="Trainings" description="Schedule sessions and track who attended." action={<Button onClick={() => setCreating(true)}>New training</Button>} />
      <HubTabs />      <DataList columns={cols} rows={trainings.data} error={trainings.error} loading={trainings.loading} rowKey={(t) => t.training_id} empty={{ title: "No trainings", hint: "Schedule a session to get started." }} />
      {creating && <NewTrainingForm onClose={() => setCreating(false)} onSaved={trainings.reload} />}
      {roster && <RosterModal training={roster} onClose={() => setRoster(null)} />}
      <ScreenAi path="hr/trainings" />
    </section>
  );
}

export default TrainingsPage;
