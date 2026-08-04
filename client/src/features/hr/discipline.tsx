/**
 * HR Discipline (MOD-71) — manager screens to raise and track disciplinary
 * queries and sanctions per employee. Employees see/respond to their own via
 * My HR (/my-hr). Two hub tabs: Queries and Sanctions.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useList, errMsg } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { num, money, dateFmt } from "@/lib/format";

const shell = pageShell.wide;
type EmployeeLite = { employee_id: string; full_name?: string | null };

const sevTone = (s: string): Tone => (s === "SERIOUS" ? "bad" : s === "WARNING" ? "warn" : "blue");
const qStatusTone = (s: string): Tone => (s === "OPEN" ? "warn" : s === "RESPONDED" ? "blue" : "mute");
const sanctTone = (t: string): Tone => (t === "FINE" ? "orange" : t === "WARNING" ? "warn" : "bad");

/* ─────────────────────────── Queries ─────────────────────────── */
type Query = {
  hr_query_id: string;
  employee_name?: string | null;
  subject: string;
  severity: string;
  status: string;
  response?: string | null;
  created_at?: string | null;
};

function NewQuery({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: employees } = useList<EmployeeLite>("/employees");
  const [f, setF] = React.useState({ employee_id: "", subject: "", body: "", severity: "WARNING" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await tenant("/hr/queries", { method: "POST", body: { employee_id: f.employee_id, subject: f.subject, body: f.body, severity: f.severity } });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  const valid = f.employee_id && f.subject.trim() && f.body.trim();
  return (
    <Modal
      open
      onClose={onClose}
      title="New query"
      description="Issue a disciplinary query to an employee."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={busy || !valid}>Issue query</Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Employee" required>
          <Select value={f.employee_id} onChange={(e) => set("employee_id", e.target.value)}>
            <option value="">—</option>
            {(employees || []).map((d) => <option key={d.employee_id} value={d.employee_id}>{d.full_name || d.employee_id}</option>)}
          </Select>
        </Field>
        <Field label="Subject" required><Input value={f.subject} onChange={(e) => set("subject", e.target.value)} placeholder="Late arrivals" /></Field>
        <Field label="Details" required>
          <textarea value={f.body} onChange={(e) => set("body", e.target.value)} rows={4}
            className="w-full rounded-[10px] border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:border-[color-mix(in_srgb,var(--primary)_50%,transparent)]" />
        </Field>
        <Field label="Severity" required>
          <Select value={f.severity} onChange={(e) => set("severity", e.target.value)}>
            <option value="INFO">Info</option>
            <option value="WARNING">Warning</option>
            <option value="SERIOUS">Serious</option>
          </Select>
        </Field>
        {error && <ErrorState message={error} />}
      </form>
    </Modal>
  );
}

export function QueriesPage() {
  const { rows, error, loading, reload } = useList<Query>("/hr/queries");
  const [creating, setCreating] = React.useState(false);
  const all = rows || [];
  const open = all.filter((q) => q.status === "OPEN").length;
  const columns: Column<Query>[] = [
    { key: "employee_name", label: "Employee", render: (r) => <span className="font-medium">{r.employee_name || "—"}</span> },
    { key: "subject", label: "Subject" },
    { key: "severity", label: "Severity", render: (r) => <Pill tone={sevTone(r.severity)}>{r.severity}</Pill> },
    { key: "status", label: "Status", render: (r) => <Pill tone={qStatusTone(r.status)}>{r.status}</Pill> },
    { key: "created_at", label: "Raised", render: (r) => <span className="num">{dateFmt(r.created_at)}</span> },
  ];
  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Human capital" to="/hr" />} title="Queries" description="Disciplinary queries raised to employees, and their responses." action={<Button onClick={() => setCreating(true)}>New query</Button>} />
      <HubTabs />      <KpiRow>
        <KpiTile label="Total" value={num(all.length)} />
        <KpiTile label="Open" value={num(open)} tone="warn" />
        <KpiTile label="Responded" value={num(all.filter((q) => q.status === "RESPONDED").length)} tone="info" />
      </KpiRow>
      <DataList columns={columns} rows={loading ? null : all} error={error} loading={loading} rowKey={(r) => r.hr_query_id} empty={{ title: "No queries", hint: "Raise a query to start a disciplinary record." }} />
      {creating && <NewQuery onClose={() => setCreating(false)} onSaved={reload} />}
    </section>
  );
}

/* ─────────────────────────── Sanctions ─────────────────────────── */
type Sanction = {
  hr_sanction_id: string;
  employee_name?: string | null;
  type: string;
  reason: string;
  amount_xaf?: number | null;
  status: string;
  effective_date?: string | null;
};

function NewSanction({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: employees } = useList<EmployeeLite>("/employees");
  const [f, setF] = React.useState({ employee_id: "", type: "WARNING", reason: "", amount_xaf: "", effective_date: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await tenant("/hr/sanctions", {
        method: "POST",
        body: {
          employee_id: f.employee_id, type: f.type, reason: f.reason,
          amount_xaf: f.amount_xaf === "" ? undefined : Number(f.amount_xaf),
          effective_date: f.effective_date || undefined,
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  const valid = f.employee_id && f.reason.trim();
  return (
    <Modal
      open
      onClose={onClose}
      title="New sanction"
      description="Record a disciplinary sanction against an employee."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={busy || !valid}>Record sanction</Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Employee" required>
          <Select value={f.employee_id} onChange={(e) => set("employee_id", e.target.value)}>
            <option value="">—</option>
            {(employees || []).map((d) => <option key={d.employee_id} value={d.employee_id}>{d.full_name || d.employee_id}</option>)}
          </Select>
        </Field>
        <Field label="Type" required>
          <Select value={f.type} onChange={(e) => set("type", e.target.value)}>
            <option value="WARNING">Warning</option>
            <option value="SUSPENSION">Suspension</option>
            <option value="DEMOTION">Demotion</option>
            <option value="FINE">Fine</option>
            <option value="DISMISSAL">Dismissal</option>
          </Select>
        </Field>
        <Field label="Reason" required>
          <textarea value={f.reason} onChange={(e) => set("reason", e.target.value)} rows={3}
            className="w-full rounded-[10px] border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:border-[color-mix(in_srgb,var(--primary)_50%,transparent)]" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (XAF)" hint="For fines"><Input type="number" min="0" className="num text-right" value={f.amount_xaf} onChange={(e) => set("amount_xaf", e.target.value)} placeholder="0" /></Field>
          <Field label="Effective date"><Input type="date" value={f.effective_date} onChange={(e) => set("effective_date", e.target.value)} /></Field>
        </div>
        {error && <ErrorState message={error} />}
      </form>
    </Modal>
  );
}

export function SanctionsPage() {
  const { rows, error, loading, reload } = useList<Sanction>("/hr/sanctions");
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const all = rows || [];
  async function lift(id: string) {
    setBusy(id);
    try { await tenant(`/hr/sanctions/${id}/lift`, { method: "POST" }); reload(); }
    catch { /* surfaced on reload */ } finally { setBusy(null); }
  }
  const columns: Column<Sanction>[] = [
    { key: "employee_name", label: "Employee", render: (r) => <span className="font-medium">{r.employee_name || "—"}</span> },
    { key: "type", label: "Type", render: (r) => <Pill tone={sanctTone(r.type)}>{r.type}</Pill> },
    { key: "reason", label: "Reason", render: (r) => <span className="text-muted-foreground">{r.reason}</span> },
    { key: "amount_xaf", label: "Amount", render: (r) => <span className="num">{r.amount_xaf ? money(r.amount_xaf) : "—"}</span> },
    { key: "status", label: "Status", render: (r) => <Pill tone={r.status === "ACTIVE" ? "bad" : "ok"}>{r.status}</Pill> },
    { key: "effective_date", label: "From", render: (r) => <span className="num">{dateFmt(r.effective_date)}</span> },
    { key: "_a", label: "", render: (r) => (r.status === "ACTIVE" ? <Button size="sm" variant="outline" loading={busy === r.hr_sanction_id} onClick={() => lift(r.hr_sanction_id)}>Lift</Button> : null) },
  ];
  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Human capital" to="/hr" />} title="Sanctions" description="Disciplinary sanctions on record — warnings, suspensions, fines and more." action={<Button onClick={() => setCreating(true)}>New sanction</Button>} />
      <HubTabs />      <KpiRow>
        <KpiTile label="Total" value={num(all.length)} />
        <KpiTile label="Active" value={num(all.filter((s) => s.status === "ACTIVE").length)} tone="bad" />
      </KpiRow>
      <DataList columns={columns} rows={loading ? null : all} error={error} loading={loading} rowKey={(r) => r.hr_sanction_id} empty={{ title: "No sanctions", hint: "Record a sanction when disciplinary action is taken." }} />
      {creating && <NewSanction onClose={() => setCreating(false)} onSaved={reload} />}
    </section>
  );
}
