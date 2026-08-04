/**
 * Vacancies — recruitment kanban (replaces the CRUD table). Pick a vacancy to
 * work its applicant pipeline across stages (Applied → Shortlisted → Interviewed
 * → Hired), with Reject / Talent-pool outcomes. The vacancy head has its own
 * DRAFT → OPEN → CLOSED lifecycle.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PageHeader } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { DepartmentSelect, type DepartmentValue } from "@/components/department-select";
import { useResource, errMsg } from "@/lib/use-resource";
import { enumLabel } from "@/lib/format";
import * as api from "@/lib/hr-api";
import { LoadingRow } from "@/components/ui/states";

const shell = pageShell.wide;
const VAC_TONE: Record<string, Tone> = { DRAFT: "mute", OPEN: "ok", CLOSED: "mute" };
const VAC_TRANSITIONS: Record<string, string[]> = { DRAFT: ["OPEN"], OPEN: ["CLOSED"], CLOSED: [] };
const VAC_LABEL: Record<string, string> = { OPEN: "Open", CLOSED: "Close" };

const ORDER = ["APPLIED", "SHORTLISTED", "INTERVIEWED", "HIRED"];
const COLUMNS = [...ORDER, "REJECTED", "TALENT_POOL"];
const COL_LABEL: Record<string, string> = { APPLIED: "Applied", SHORTLISTED: "Shortlisted", INTERVIEWED: "Interviewed", HIRED: "Hired", REJECTED: "Rejected", TALENT_POOL: "Talent pool" };

function AddApplicantForm({ vacancyId, onClose, onSaved }: { vacancyId: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ full_name: "", email: "", phone: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.addApplicant(vacancyId, { full_name: f.full_name, email: f.email || undefined, phone: f.phone || undefined }); onSaved(); onClose(); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Add applicant" description="Add a candidate to this vacancy's pipeline.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Full name" required><Input value={f.full_name} onChange={(e) => set("full_name", e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.full_name || busy}>Add</Button>
        </div>
      </form>
    </Modal>
  );
}

function NewVacancyForm({ onClose, onSaved }: { onClose: () => void; onSaved: (v: api.Vacancy) => void }) {
  const [f, setF] = React.useState({ title: "", description: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  // Department is a scope (0490). It carries onto the employee record at hire,
  // so picking a real node here is what puts the new starter in the right part
  // of the organigramme instead of copying a typed string.
  const [dept, setDept] = React.useState<DepartmentValue>({ scope_id: null, department: null });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const v = await api.createVacancy({
        title: f.title,
        scope_id: dept.scope_id || undefined,
        department: dept.department || undefined,
        description: f.description || undefined,
      });
      onSaved(v); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New vacancy" description="Open a role and start collecting applicants.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Title" required><Input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Driver — heavy goods" /></Field>
        <Field label="Department" hint="From your organigramme — Security › Scopes."><DepartmentSelect value={dept} onChange={setDept} /></Field>
        <Field label="Description"><Input value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.title || busy}>Create</Button>
        </div>
      </form>
    </Modal>
  );
}

function Pipeline({ vacancy: initial, onChanged }: { vacancy: api.Vacancy; onChanged: () => void }) {
  const [vacancy, setVacancy] = React.useState(initial);
  React.useEffect(() => setVacancy(initial), [initial]);
  const applicants = useResource(() => api.listApplicants(vacancy.vacancy_id), [vacancy.vacancy_id]);
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function vacStatus(status: string) {
    setBusy("vac:" + status); setError(null);
    try { setVacancy(await api.setVacancyStatus(vacancy.vacancy_id, status)); onChanged(); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  }
  async function move(a: api.Applicant, status: string) {
    setBusy(a.applicant_id); setError(null);
    try { await api.setApplicantStatus(vacancy.vacancy_id, a.applicant_id, status); applicants.reload(); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  }

  const byStatus = React.useMemo(() => {
    const m: Record<string, api.Applicant[]> = {};
    COLUMNS.forEach((c) => { m[c] = []; });
    (applicants.data || []).forEach((a) => { (m[a.status] || (m[a.status] = [])).push(a); });
    return m;
  }, [applicants.data]);

  function cardActions(a: api.Applicant) {
    const i = ORDER.indexOf(a.status);
    if (i === -1) return <Button size="sm" variant="outline" loading={busy === a.applicant_id} onClick={() => move(a, "APPLIED")}>Reopen</Button>;
    const next = ORDER[i + 1];
    return (
      <div className="flex flex-wrap gap-1">
        {next && <Button size="sm" loading={busy === a.applicant_id} onClick={() => move(a, next)}>→ {COL_LABEL[next]}</Button>}
        <Button size="sm" variant="outline" disabled={busy === a.applicant_id} onClick={() => move(a, "REJECTED")}>Reject</Button>
        <Button size="sm" variant="ghost" disabled={busy === a.applicant_id} onClick={() => move(a, "TALENT_POOL")}>Pool</Button>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-foreground">{vacancy.title || "Vacancy"}</h3>
            <Pill tone={VAC_TONE[vacancy.status] || "mute"}>{enumLabel(vacancy.status)}</Pill>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{vacancy.department || "—"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(VAC_TRANSITIONS[vacancy.status] || []).map((s) => (
            <Button key={s} size="sm" variant={s === "CLOSED" ? "outline" : "default"} loading={busy === "vac:" + s} onClick={() => vacStatus(s)}>{VAC_LABEL[s] || s}</Button>
          ))}
          <Button size="sm" onClick={() => setAdding(true)}>Add applicant</Button>
        </div>
      </div>

      {error && <ErrorState message={error} />}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((col) => (
          <div key={col} className="w-56 shrink-0">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-sm font-medium text-foreground">{COL_LABEL[col]}</span>
              <span className="micro">{byStatus[col]?.length || 0}</span>
            </div>
            <div className="max-h-[62vh] space-y-2 overflow-y-auto rounded-lg border bg-muted/30 p-2 min-h-24">
              {applicants.loading ? <LoadingRow /> : (byStatus[col] || []).map((a) => (
                <div key={a.applicant_id} className="rounded-md border bg-card p-3">
                  <div className="text-sm font-medium text-foreground">{a.full_name}</div>
                  {(a.email || a.phone) && <div className="mt-0.5 micro truncate">{a.email || a.phone}</div>}
                  <div className="mt-2">{cardActions(a)}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {adding && <AddApplicantForm vacancyId={vacancy.vacancy_id} onClose={() => setAdding(false)} onSaved={applicants.reload} />}
    </div>
  );
}

export function VacanciesPage() {
  const vacancies = useResource(() => api.listVacancies(), []);
  const [selId, setSelId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const rows = React.useMemo(() => vacancies.data || [], [vacancies.data]);
  const selected = rows.find((v) => v.vacancy_id === selId) || null;
  React.useEffect(() => { if (!selId && rows.length) setSelId(rows[0].vacancy_id); }, [rows, selId]);

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Human capital" to="/hr" />} title="Vacancies" description="Recruitment pipeline — move applicants through the hiring stages." action={<Button onClick={() => setCreating(true)}>New vacancy</Button>} />
      <HubTabs />      {vacancies.error ? <ErrorState message={vacancies.error} /> : (
        <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
          <div className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border p-1">
            {vacancies.loading ? <LoadingRow /> : rows.length === 0 ? <div className="px-3 py-4 micro">No vacancies.</div> : rows.map((v) => (
              <button key={v.vacancy_id} onClick={() => setSelId(v.vacancy_id)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${v.vacancy_id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}>
                <span className="truncate font-medium">{v.title || v.vacancy_id.slice(0, 8)}</span>
                <Pill tone={VAC_TONE[v.status] || "mute"}>{enumLabel(v.status)}</Pill>
              </button>
            ))}
          </div>
          {selected ? <Pipeline vacancy={selected} onChanged={vacancies.reload} /> : <EmptyState title="No vacancy selected" hint="Choose a role from the list." />}
        </div>
      )}
      {creating && <NewVacancyForm onClose={() => setCreating(false)} onSaved={(v) => { vacancies.reload(); setSelId(v.vacancy_id); }} />}
      <ScreenAi path="hr/vacancies" />
    </section>
  );
}

export default VacanciesPage;
