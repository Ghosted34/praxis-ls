/** HR screens. Every substantive screen is a purpose-built workstation
 *  (360 / run / queue / kanban / lifecycle / roster), re-exported here so the
 *  hub imports are stable. SOPs and Talent pool are light reference lists. */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { ActivePill } from "@/components/ui/pill";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { useList, errMsg } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { num, dateFmt } from "@/lib/format";

const eyebrow = <HubCrumb area="Human capital" />;
const shell = "mx-auto max-w-6xl animate-fade-in";

// Employees is now a profile 360 (record + HR history + suspend/activate).
export { EmployeesPage } from "./employee-360";
// Payroll is now a run workstation (compute → approve → post → disburse).
export { PayrollPage } from "./payroll";
// Vacancies is now a recruitment kanban (applicant pipeline across stages).
export { VacanciesPage } from "./vacancy";
// Contracts is now a lifecycle workstation (DRAFT → ISSUED → SIGNED → ENDED).
export { ContractsPage } from "./contracts";
// Appraisals surface performance rewards that feed payroll.
export { AppraisalsPage } from "./appraisal";
// Attendance is a geofenced Time Clock manager view.
export { AttendancePage } from "./attendance";
// Leave is an approve/reject request queue.
export { LeavePage } from "./leave";
// Trainings is a session + attendance roster workstation.
export { TrainingsPage } from "./trainings";

/* ── SOPs — versioned reference list ── */
type Sop = { sop_document_id: string; title?: string | null; category?: string | null; version_no?: number | null; is_active?: boolean };

function SopForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ title: "", category: "", version_no: "1" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await tenant("/sops", { method: "POST", body: { title: f.title, category: f.category || undefined, version_no: f.version_no === "" ? undefined : Number(f.version_no) } });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New SOP" description="Add a standard operating procedure document.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Title" required><Input value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category"><Input value={f.category} onChange={(e) => set("category", e.target.value)} /></Field>
          <Field label="Version"><Input type="number" className="num text-right" value={f.version_no} onChange={(e) => set("version_no", e.target.value)} /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.title || busy}>Add SOP</Button>
        </div>
      </form>
    </Modal>
  );
}

export function SopsPage() {
  const { rows, error, loading, reload } = useList<Sop>("/sops");
  const [creating, setCreating] = React.useState(false);
  const cols: Column<Sop>[] = [
    { key: "title", label: "Title", render: (r) => <span className="font-medium text-foreground">{r.title || "—"}</span> },
    { key: "category", label: "Category", render: (r) => <span className="text-muted-foreground">{r.category || "—"}</span> },
    { key: "version_no", label: "Version", className: "num text-right", render: (r) => num(r.version_no) },
    { key: "is_active", label: "Status", render: (r) => <ActivePill active={r.is_active !== false} /> },
  ];
  return (
    <section className={shell}>
      <PageHeader eyebrow={eyebrow} title="SOPs" description="Standard operating procedure documents with versioning." action={<Button onClick={() => setCreating(true)}>New SOP</Button>} />
      <DataList columns={cols} rows={rows} error={error} loading={loading} rowKey={(r) => r.sop_document_id} empty={{ title: "No SOPs", hint: "Add your first procedure document." }} />
      {creating && <SopForm onClose={() => setCreating(false)} onSaved={reload} />}
    </section>
  );
}

/* ── Talent pool — candidate reference list ── */
type Talent = { talent_pool_id: string; full_name?: string | null; skills?: string | null; notes?: string | null; created_at?: string | null };

function TalentForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ full_name: "", skills: "", notes: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await tenant("/talent-pool", { method: "POST", body: { full_name: f.full_name, skills: f.skills || undefined, notes: f.notes || undefined } });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Add to talent pool" description="Keep a candidate on file for future roles.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Full name" required><Input value={f.full_name} onChange={(e) => set("full_name", e.target.value)} /></Field>
        <Field label="Skills"><Input value={f.skills} onChange={(e) => set("skills", e.target.value)} placeholder="Customs, French, forklift…" /></Field>
        <Field label="Notes"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.full_name || busy}>Add</Button>
        </div>
      </form>
    </Modal>
  );
}

export function TalentPoolPage() {
  const { rows, error, loading, reload } = useList<Talent>("/talent-pool");
  const [creating, setCreating] = React.useState(false);
  const cols: Column<Talent>[] = [
    { key: "full_name", label: "Name", render: (r) => <span className="font-medium text-foreground">{r.full_name || "—"}</span> },
    { key: "skills", label: "Skills", render: (r) => <span className="text-muted-foreground">{r.skills || "—"}</span> },
    { key: "created_at", label: "Added", render: (r) => <span className="num text-muted-foreground">{dateFmt(r.created_at)}</span> },
  ];
  return (
    <section className={shell}>
      <PageHeader eyebrow={eyebrow} title="Talent pool" description="Candidates kept on file for future roles." action={<Button onClick={() => setCreating(true)}>Add candidate</Button>} />
      <DataList columns={cols} rows={rows} error={error} loading={loading} rowKey={(r) => r.talent_pool_id} empty={{ title: "Talent pool is empty", hint: "Add promising candidates to revisit later." }} />
      {creating && <TalentForm onClose={() => setCreating(false)} onSaved={reload} />}
    </section>
  );
}
