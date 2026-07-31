/** HR screens. Every substantive screen is a purpose-built workstation
 *  (360 / run / queue / kanban / lifecycle / roster), re-exported here so the
 *  hub imports are stable. SOPs and Talent pool are light reference lists. */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { ActivePill, Pill, type Tone } from "@/components/ui/pill";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { num, dateFmt } from "@/lib/format";

type EmployeeLite = { employee_id: string; full_name?: string | null };
const READINESS: { value: string; label: string; tone: Tone }[] = [
  { value: "ready_now", label: "Ready now", tone: "ok" },
  { value: "1_2_years", label: "1–2 years", tone: "warn" },
  { value: "3_plus_years", label: "3+ years", tone: "mute" },
];
const readinessMeta = (v?: string | null) => READINESS.find((r) => r.value === v);

const eyebrow = <HubCrumb area="Human capital" to="/hr" />;
const shell = "mx-auto max-w-6xl animate-fade-in";

// Employees is now a profile 360 (record + HR history + suspend/activate).
export { EmployeesPage } from "./employee-360";
// HR discipline (MOD-71) — manager screens for queries + sanctions.
export { QueriesPage, SanctionsPage } from "./discipline";
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

/* Procedures — the versioned SOP document register (with category filter). */
function ProceduresView() {
  const { rows, error, loading, reload } = useList<Sop>("/sops");
  const [creating, setCreating] = React.useState(false);
  const [cat, setCat] = React.useState("ALL");
  const list = rows || [];
  const activeCount = list.filter((r) => r.is_active !== false).length;
  const categories = Array.from(new Set(list.map((r) => r.category || "Uncategorised"))).sort();
  const filtered = cat === "ALL" ? list : list.filter((r) => (r.category || "Uncategorised") === cat);
  const cols: Column<Sop>[] = [
    { key: "title", label: "Title", render: (r) => <span className="font-medium text-foreground">{r.title || "—"}</span> },
    { key: "category", label: "Category", render: (r) => <span className="text-muted-foreground">{r.category || "—"}</span> },
    { key: "version_no", label: "Version", className: "num text-right", render: (r) => num(r.version_no) },
    { key: "is_active", label: "Status", render: (r) => <ActivePill active={r.is_active !== false} /> },
  ];
  return (
    <>
      <KpiRow>
        <KpiTile label="Procedures" value={num(list.length)} />
        <KpiTile label="Active" value={num(activeCount)} hint={`${list.length - activeCount} archived`} />
        <KpiTile label="Categories" value={num(categories.length)} />
      </KpiRow>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {categories.length > 1 ? (
          <div className="chips">
            {["ALL", ...categories].map((c) => (
              <button key={c} onClick={() => setCat(c)} className={`chip ${cat === c ? "on" : ""}`}>
                {c === "ALL" ? "All" : c}
                <span className="ct num">{c === "ALL" ? list.length : list.filter((r) => (r.category || "Uncategorised") === c).length}</span>
              </button>
            ))}
          </div>
        ) : <span />}
        <Button onClick={() => setCreating(true)}>New SOP</Button>
      </div>
      <DataList columns={cols} rows={loading ? null : filtered} error={error} loading={loading} rowKey={(r) => r.sop_document_id} empty={{ title: "No SOPs", hint: "Add your first procedure document." }} />
      {creating && <SopForm onClose={() => setCreating(false)} onSaved={reload} />}
    </>
  );
}

/* ── Onboarding checklists — per-new-hire steps, ticked off then completed ── */
type OnbItem = { onboarding_item_id: string; label: string; is_done: boolean; done_at?: string | null };
type Checklist = { onboarding_checklist_id: string; employee_id?: string | null; employee_name?: string | null; status: string; total_items: number; done_items: number; created_at?: string | null };
type ChecklistDetail = Checklist & { items: OnbItem[] };

function NewChecklistForm({ employees, onClose, onSaved }: { employees: EmployeeLite[]; onClose: () => void; onSaved: () => void }) {
  const [employeeId, setEmployeeId] = React.useState("");
  const [itemsText, setItemsText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const items = itemsText.split("\n").map((s) => s.trim()).filter(Boolean);
      await tenant("/onboarding", { method: "POST", body: { employee_id: employeeId || undefined, items } });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New onboarding checklist" description="Start a checklist for a new hire.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Employee">
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">—</option>
            {employees.map((emp) => <option key={emp.employee_id} value={emp.employee_id}>{emp.full_name || emp.employee_id}</option>)}
          </Select>
        </Field>
        <Field label="Items (one per line)" hint="Optional — you can add more later.">
          <textarea value={itemsText} onChange={(e) => setItemsText(e.target.value)} rows={5} className="flex w-full rounded-[10px] border border-input bg-background px-3 py-2 text-[13px]" placeholder={"Sign contract\nIT account setup\nSafety briefing"} />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>Create</Button>
        </div>
      </form>
    </Modal>
  );
}

function OnboardingDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const detail = useResource(() => tenant<ChecklistDetail>(`/onboarding/${id}`), [id]);
  const [newItem, setNewItem] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const c = detail.data;
  const done = (c?.items || []).filter((i) => i.is_done).length;

  async function toggle(item: OnbItem) {
    setBusy(item.onboarding_item_id);
    try { await tenant(`/onboarding/items/${item.onboarding_item_id}`, { method: "PATCH", body: { is_done: !item.is_done } }); detail.reload(); onChanged(); } finally { setBusy(null); }
  }
  async function add(e: React.FormEvent) {
    e.preventDefault(); if (!newItem.trim()) return; setBusy("add");
    try { await tenant(`/onboarding/${id}/items`, { method: "POST", body: { label: newItem.trim() } }); setNewItem(""); detail.reload(); onChanged(); } finally { setBusy(null); }
  }
  async function complete() {
    setBusy("complete");
    try { await tenant(`/onboarding/${id}/complete`, { method: "POST" }); detail.reload(); onChanged(); } finally { setBusy(null); }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={c?.employee_name ? `Onboarding · ${c.employee_name}` : "Onboarding checklist"} description={c ? `${done}/${(c.items || []).length} done` : undefined}>
      {detail.error ? <ErrorState message={detail.error} /> : !c ? <div className="py-6 text-center micro">Loading…</div> : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            {(c.items || []).length === 0 ? <div className="micro">No items yet — add the first step below.</div> : c.items.map((item) => (
              <label key={item.onboarding_item_id} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
                <input type="checkbox" checked={item.is_done} disabled={busy === item.onboarding_item_id || c.status === "COMPLETED"} onChange={() => toggle(item)} />
                <span className={item.is_done ? "text-muted-foreground line-through" : "text-foreground"}>{item.label}</span>
              </label>
            ))}
          </div>
          {c.status !== "COMPLETED" && (
            <form onSubmit={add} className="flex gap-2">
              <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add a step…" />
              <Button type="submit" loading={busy === "add"} disabled={!newItem.trim()}>Add</Button>
            </form>
          )}
          <div className="flex items-center justify-between border-t pt-3">
            <Pill tone={c.status === "COMPLETED" ? "ok" : "warn"}>{c.status === "COMPLETED" ? "Completed" : "In progress"}</Pill>
            {c.status !== "COMPLETED" && <Button variant="outline" loading={busy === "complete"} onClick={complete}>Mark complete</Button>}
          </div>
        </div>
      )}
    </Modal>
  );
}

function OnboardingView() {
  const board = useResource(() => tenant<Checklist[]>("/onboarding"), []);
  const { rows: employees } = useList<EmployeeLite>("/employees");
  const [creating, setCreating] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const list = board.data || [];
  const openCount = list.filter((c) => c.status !== "COMPLETED").length;
  return (
    <>
      <KpiRow>
        <KpiTile label="Checklists" value={num(list.length)} />
        <KpiTile label="In progress" value={num(openCount)} />
        <KpiTile label="Completed" value={num(list.length - openCount)} />
      </KpiRow>
      <div className="mb-3 flex justify-end"><Button onClick={() => setCreating(true)}>New checklist</Button></div>
      {board.error ? <ErrorState message={board.error} /> : list.length === 0 ? (
        <EmptyState title="No onboarding checklists" hint="Start a checklist for a new hire." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => {
            const pct = c.total_items ? Math.round((c.done_items / c.total_items) * 100) : 0;
            return (
              <button key={c.onboarding_checklist_id} onClick={() => setOpenId(c.onboarding_checklist_id)} className="lux-card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-m)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-foreground">{c.employee_name || "Unassigned"}</div>
                  <Pill tone={c.status === "COMPLETED" ? "ok" : "warn"}>{c.status === "COMPLETED" ? "Completed" : "In progress"}</Pill>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="h-1.5 flex-1 rounded-full bg-[rgb(var(--ink)/0.08)]"><span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></span>
                  <span className="num text-xs text-muted-foreground">{c.done_items}/{c.total_items}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {creating && <NewChecklistForm employees={employees || []} onClose={() => setCreating(false)} onSaved={board.reload} />}
      {openId && <OnboardingDetail id={openId} onClose={() => setOpenId(null)} onChanged={board.reload} />}
    </>
  );
}

export function SopsPage() {
  const [view, setView] = React.useState<"procedures" | "onboarding">("procedures");
  return (
    <section className={shell}>
      <PageHeader eyebrow={eyebrow} title="SOPs & onboarding" description="Standard operating procedures, plus per-new-hire onboarding checklists." />
      <HubTabs />      <div className="chips mb-4">
        <button className={`chip ${view === "procedures" ? "on" : ""}`} onClick={() => setView("procedures")}>Procedures</button>
        <button className={`chip ${view === "onboarding" ? "on" : ""}`} onClick={() => setView("onboarding")}>Onboarding</button>
      </div>
      {view === "procedures" ? <ProceduresView /> : <OnboardingView />}
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

/* ── Succession plans — role → incumbent/successor with a readiness horizon ── */
type Succession = {
  succession_plan_id: string;
  role_title?: string | null;
  incumbent_id?: string | null;
  successor_id?: string | null;
  incumbent_name?: string | null;
  successor_name?: string | null;
  readiness?: string | null;
  notes?: string | null;
};

function SuccessionForm({ employees, onClose, onSaved }: { employees: EmployeeLite[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ role_title: "", incumbent_id: "", successor_id: "", readiness: "1_2_years", notes: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await tenant("/succession", { method: "POST", body: {
        role_title: f.role_title,
        incumbent_id: f.incumbent_id || undefined,
        successor_id: f.successor_id || undefined,
        readiness: f.readiness || undefined,
        notes: f.notes || undefined,
      } });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  const empOptions = (
    <>
      <option value="">—</option>
      {employees.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.full_name || e.employee_id}</option>)}
    </>
  );
  return (
    <Modal open onClose={onClose} title="New succession plan" description="Name a role's successor and how ready they are.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Role" required><Input value={f.role_title} onChange={(e) => set("role_title", e.target.value)} placeholder="Head of Operations" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Incumbent"><Select value={f.incumbent_id} onChange={(e) => set("incumbent_id", e.target.value)}>{empOptions}</Select></Field>
          <Field label="Successor"><Select value={f.successor_id} onChange={(e) => set("successor_id", e.target.value)}>{empOptions}</Select></Field>
        </div>
        <Field label="Readiness">
          <Select value={f.readiness} onChange={(e) => set("readiness", e.target.value)}>
            {READINESS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </Field>
        <Field label="Notes"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.role_title || busy}>Add plan</Button>
        </div>
      </form>
    </Modal>
  );
}

export function TalentPoolPage() {
  const { rows, error, loading, reload } = useList<Talent>("/talent-pool");
  const plans = useResource(() => tenant<Succession[]>("/succession").then((r) => r), []);
  const { rows: employees } = useList<EmployeeLite>("/employees");
  const [creating, setCreating] = React.useState(false);
  const [planning, setPlanning] = React.useState(false);
  const list = rows || [];
  const planList = plans.data || [];
  const readyNow = planList.filter((p) => p.readiness === "ready_now").length;
  const cols: Column<Talent>[] = [
    { key: "full_name", label: "Name", render: (r) => <span className="font-medium text-foreground">{r.full_name || "—"}</span> },
    {
      key: "skills", label: "Skills",
      render: (r) =>
        (r.skills || "").trim() ? (
          <span className="flex flex-wrap gap-1">
            {r.skills!.split(/[,;]/).map((s) => s.trim()).filter(Boolean).map((s) => (
              <span key={s} className="rounded-md bg-[rgb(var(--ink)/0.06)] px-1.5 py-0.5 text-xs text-muted-foreground">{s}</span>
            ))}
          </span>
        ) : <span className="text-muted-foreground">—</span>,
    },
    { key: "created_at", label: "Added", render: (r) => <span className="num text-muted-foreground">{dateFmt(r.created_at)}</span> },
  ];
  return (
    <section className={shell}>
      <PageHeader eyebrow={eyebrow} title="Talent & succession" description="Successors for key roles, plus the candidate bench for future hiring." action={<Button onClick={() => setPlanning(true)}>New plan</Button>} />
      <HubTabs />      <KpiRow>
        <KpiTile label="Succession plans" value={num(planList.length)} />
        <KpiTile label="Ready-now successors" value={num(readyNow)} />
        <KpiTile label="Bench candidates" value={num(list.length)} />
      </KpiRow>

      <div className="sec"><h2>Succession plans</h2><span className="ln" /></div>
      {plans.error ? <ErrorState message={plans.error} /> : planList.length === 0 ? (
        <EmptyState title="No succession plans" hint="Name a successor for a key role to get started." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {planList.map((p) => {
            const rm = readinessMeta(p.readiness);
            return (
              <div key={p.succession_plan_id} className="lux-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-foreground">{p.role_title || "—"}</div>
                  {rm && <Pill tone={rm.tone}>{rm.label}</Pill>}
                </div>
                <div className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between gap-2"><span className="micro">Incumbent</span><span className="text-muted-foreground">{p.incumbent_name || "—"}</span></div>
                  <div className="flex justify-between gap-2"><span className="micro">Successor</span><span className="font-medium text-foreground">{p.successor_name || "—"}</span></div>
                </div>
                {p.notes && <p className="mt-2 text-xs text-muted-foreground">{p.notes}</p>}
              </div>
            );
          })}
        </div>
      )}

      <div className="sec"><h2>Talent pool</h2><span className="ln" /><button className="text-[color:var(--primary)]" onClick={() => setCreating(true)}>Add candidate</button></div>
      <DataList columns={cols} rows={rows} error={error} loading={loading} rowKey={(r) => r.talent_pool_id} empty={{ title: "Talent pool is empty", hint: "Add promising candidates to revisit later." }} />

      {creating && <TalentForm onClose={() => setCreating(false)} onSaved={reload} />}
      {planning && <SuccessionForm employees={employees || []} onClose={() => setPlanning(false)} onSaved={plans.reload} />}
    </section>
  );
}
