/**
 * Employees — profile 360 (replaces the CRUD table). Pick an employee to see
 * their record and history across HR: contracts (with renewal), payroll,
 * advances, leave, attendance, sanctions and appraisals. Suspend/activate
 * drives the `is_active` lifecycle the rest of the system checks (payroll,
 * contracts, dispatch).
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { useRecordParam, useTrailTitle } from "@/app/layout/nav-trail-context";
import { Button } from "@/components/ui/button";
import { ComposeIconButton } from "@/features/comms/mail";
import { DocButton } from "@/components/doc-button";
import { UploadSigned } from "@/features/hr/contracts";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PageHeader } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import {
  DepartmentSelect,
  type DepartmentValue,
} from "@/components/department-select";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { money, dateFmt, dateTimeFmt, enumLabel } from "@/lib/format";
import * as api from "@/lib/hr-api";

const shell = pageShell.wide;
const CONTRACT_TONE: Record<string, Tone> = {
  DRAFT: "mute",
  ISSUED: "blue",
  SIGNED: "ok",
  ENDED: "mute",
};
const LEAVE_TONE: Record<string, Tone> = {
  REQUESTED: "warn",
  APPROVED: "ok",
  REJECTED: "bad",
};

/** The full record: the spine (contracts) plus what it owes, what it was paid,
 *  how it behaved, how it performed, and what discipline is on file (10708 —
 *  payroll, advances and sanctions joined the original four tabs). */
const TABS = [
  "Contracts",
  "Payroll",
  "Advances",
  "Leave",
  "Attendance",
  "Sanctions",
  "Appraisals",
] as const;
type Tab = (typeof TABS)[number];

function MiniTable({
  head,
  children,
  empty,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  empty: boolean;
}) {
  if (empty)
    return (
      <div className="px-3 py-6 text-center micro">
        {tr("Nothing here yet.")}
      </div>
    );
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
const Th = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
  <th className={`px-3 py-2 font-medium ${r ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const Td = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
  <td className={`px-3 py-1.5 ${r ? "text-right num" : ""}`}>{children}</td>
);

function NewEmployeeForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (e: api.Employee) => void;
}) {
  const { rows: entities } = useList<{
    entity_id: string;
    legal_name?: string;
  }>("/entities");
  const [f, setF] = React.useState({
    full_name: "",
    entity_id: "",
    job_title: "",
    email: "",
    employment_type: "CDI",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  // Department is a scope (0490) — this is what finally links an employee to a
  // place in the organigramme instead of a typed string.
  const [dept, setDept] = React.useState<DepartmentValue>({
    scope_id: null,
    department: null,
  });
  // Line manager (0493) — what `is_line_manager` ("approves for own team") needs.
  const [reportsTo, setReportsTo] = React.useState("");
  const { rows: staff } = useList<api.Employee>("/employees");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createEmployee({
        full_name: f.full_name,
        entity_id: f.entity_id || undefined,
        scope_id: dept.scope_id || undefined,
        department: dept.department || undefined,
        reports_to: reportsTo || undefined,
        job_title: f.job_title || undefined,
        email: f.email || undefined,
        employment_type: f.employment_type,
      });
      onSaved(created);
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="New employee"
      description="Add a staff record — the spine payroll, HR and fleet build on."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label={tr("Full name")} required>
          <Input
            value={f.full_name}
            onChange={(e) => set("full_name", e.target.value)}
          />
        </Field>
        <Field label={tr("Entity")}>
          <Select
            value={f.entity_id}
            onChange={(e) => set("entity_id", e.target.value)}
          >
            <option value="">—</option>
            {(entities || []).map((en) => (
              <option key={en.entity_id} value={en.entity_id}>
                {en.legal_name || en.entity_id.slice(0, 8)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Department")} hint="From your organigramme.">
            <DepartmentSelect value={dept} onChange={setDept} />
          </Field>
          <Field label={tr("Job title")}>
            <Input
              value={f.job_title}
              onChange={(e) => set("job_title", e.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Reports to"
          hint="Their line manager. Leave blank for the top of the tree."
        >
          <Select
            value={reportsTo}
            onChange={(e) => setReportsTo(e.target.value)}
          >
            <option value="">{tr("— nobody —")}</option>
            {(staff || []).map((p) => (
              <option key={p.employee_id} value={p.employee_id}>
                {p.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("Email")} hint="Used to send payslips & contracts">
          <Input
            type="email"
            value={f.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="name@company.cm"
          />
        </Field>
        <Field label={tr("Employment type")}>
          <Select
            value={f.employment_type}
            onChange={(e) => set("employment_type", e.target.value)}
          >
            {["CDI", "CDD", "STAGE", "INTERIM", "CONSULTANT", "TEMPORARY"].map(
              (t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ),
            )}
          </Select>
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!f.full_name || busy}>
            Add employee
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditEmployeeForm({
  employee,
  onClose,
  onSaved,
}: {
  employee: api.Employee;
  onClose: () => void;
  onSaved: (e: api.Employee) => void;
}) {
  const { rows: entities } = useList<{
    entity_id: string;
    legal_name?: string;
  }>("/entities");
  const [f, setF] = React.useState({
    full_name: employee.full_name || "",
    entity_id: employee.entity_id || "",
    job_title: employee.job_title || "",
    email: employee.email || "",
    employment_type: employee.employment_type || "CDI",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  // Seeded from whatever the record already has: an employee migrated by 0490
  // has scope_id, one that couldn't be matched still has only the text, and the
  // picker handles both (see DepartmentSelect).
  const [dept, setDept] = React.useState<DepartmentValue>({
    scope_id: employee.scope_id || null,
    department: employee.department || null,
  });
  // Line manager (0493). Excludes this employee from its own list; deeper loops
  // (A→B→A) are refused by the API with REPORTING_CYCLE, naming the person.
  const [reportsTo, setReportsTo] = React.useState(employee.reports_to || "");
  const { rows: staff } = useList<api.Employee>("/employees");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateEmployee(employee.employee_id, {
        full_name: f.full_name,
        entity_id: f.entity_id || undefined,
        scope_id: dept.scope_id || undefined,
        department: dept.department || undefined,
        reports_to: reportsTo || undefined,
        job_title: f.job_title || undefined,
        email: f.email || undefined,
        employment_type: f.employment_type || undefined,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit employee"
      description="Update role, department and employment details."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label={tr("Full name")} required>
          <Input
            value={f.full_name}
            onChange={(e) => set("full_name", e.target.value)}
          />
        </Field>
        <Field label={tr("Entity")}>
          <Select
            value={f.entity_id}
            onChange={(e) => set("entity_id", e.target.value)}
          >
            <option value="">—</option>
            {(entities || []).map((en) => (
              <option key={en.entity_id} value={en.entity_id}>
                {en.legal_name || en.entity_id.slice(0, 8)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Department")} hint="From your organigramme.">
            <DepartmentSelect value={dept} onChange={setDept} />
          </Field>
          <Field label={tr("Job title")}>
            <Input
              value={f.job_title}
              onChange={(e) => set("job_title", e.target.value)}
              placeholder={tr("Accountant")}
            />
          </Field>
        </div>
        <Field
          label="Reports to"
          hint="Their line manager. Leave blank for the top of the tree."
        >
          <Select
            value={reportsTo}
            onChange={(e) => setReportsTo(e.target.value)}
          >
            <option value="">{tr("— nobody —")}</option>
            {(staff || [])
              .filter((p) => p.employee_id !== employee.employee_id)
              .map((p) => (
                <option key={p.employee_id} value={p.employee_id}>
                  {p.full_name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={tr("Email")} hint="Used to send payslips & contracts">
          <Input
            type="email"
            value={f.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="name@company.cm"
          />
        </Field>
        <Field label={tr("Employment type")}>
          <Select
            value={f.employment_type}
            onChange={(e) => set("employment_type", e.target.value)}
          >
            {["CDI", "CDD", "STAGE", "INTERIM", "CONSULTANT", "TEMPORARY"].map(
              (t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ),
            )}
          </Select>
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!f.full_name || busy}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EmployeeDetail({
  employee: initial,
  onChanged,
}: {
  employee: api.Employee;
  onChanged: () => void;
}) {
  const [employee, setEmployee] = React.useState(initial);
  React.useEffect(() => setEmployee(initial), [initial]);
  const [tab, setTab] = React.useState<Tab>("Contracts");
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const eid = employee.employee_id;
  const active = employee.is_active !== false;

  const contracts = useResource(
    () => api.listContracts({ employee_id: eid }),
    [eid],
  );
  const payroll = useResource(() => api.employeePayslips(eid), [eid]);
  const advances = useResource(
    () => api.listAdvances({ employee_id: eid }),
    [eid],
  );
  const leave = useResource(() => api.listLeave({ employee_id: eid }), [eid]);
  const attendance = useResource(
    () => api.listAttendance({ employee_id: eid }),
    [eid],
  );
  const sanctions = useResource(
    () => api.listSanctions({ employee_id: eid }),
    [eid],
  );
  const appraisals = useResource(
    () => api.listAppraisals({ employee_id: eid }),
    [eid],
  );
  // What one contract row is being renewed, so the button can say so.
  const [renewing, setRenewing] = React.useState<string | null>(null);

  async function toggleActive() {
    setBusy(true);
    setError(null);
    try {
      setEmployee(await api.setEmployeeActive(eid, !active));
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  /** Renewal (10708): a NEW draft contract that supersedes the old one —
   *  terms carried, dates defaulting to the day after the term ends. */
  async function renewContract(c: api.Contract) {
    setRenewing(c.hr_contract_id);
    setError(null);
    try {
      await api.renewContract(c.hr_contract_id);
      contracts.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRenewing(null);
    }
  }

  const cRows = contracts.data || [],
    pRows = payroll.data || [],
    adRows = advances.data || [],
    lRows = leave.data || [],
    aRows = attendance.data || [],
    sRows = sanctions.data || [],
    apRows = appraisals.data || [];
  const counts: Record<Tab, number> = {
    Contracts: cRows.length,
    Payroll: pRows.length,
    Advances: adRows.length,
    Leave: lRows.length,
    Attendance: aRows.length,
    Sanctions: sRows.length,
    Appraisals: apRows.length,
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-foreground">
                {employee.full_name || employee.employee_id.slice(0, 8)}
              </h3>
              <Pill tone={active ? "ok" : "mute"}>
                {active ? "Active" : "Suspended"}
              </Pill>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {[employee.job_title, employee.department, employee.entity_name]
                .filter(Boolean)
                .join(" · ") || "—"}
            </p>
            <p className="mt-0.5 micro">
              {[
                employee.employment_type && enumLabel(employee.employment_type),
                employee.cnps_number && `CNPS ${employee.cnps_number}`,
                employee.base_salary != null &&
                  `Base ${money(employee.base_salary)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ComposeIconButton
              to={employee.email || undefined}
              className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant={active ? "outline" : "default"}
              loading={busy}
              onClick={toggleActive}
            >
              {active ? "Suspend" : "Activate"}
            </Button>
          </div>
        </div>
        {error && (
          <div className="mt-3">
            <ErrorState message={error} />
          </div>
        )}
      </div>
      {editing && (
        <EditEmployeeForm
          employee={employee}
          onClose={() => setEditing(false)}
          onSaved={(e) => {
            setEmployee(e);
            onChanged();
          }}
        />
      )}

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t}
            <span className="ml-1.5 micro">{counts[t]}</span>
          </button>
        ))}
      </div>

      {tab === "Contracts" && (
        <MiniTable
          empty={cRows.length === 0}
          head={
            <>
              <Th>{tr("Kind")}</Th>
              <Th>{tr("Status")}</Th>
              <Th>Effective</Th>
              <Th>{tr("Ends")}</Th>
              <Th></Th>
            </>
          }
        >
          {cRows.map((c) => (
            <tr key={c.hr_contract_id}>
              <Td>{enumLabel(c.kind)}</Td>
              <Td>
                <Pill tone={CONTRACT_TONE[c.status] || "mute"}>
                  {enumLabel(c.status)}
                </Pill>
              </Td>
              <Td>{dateFmt(c.effective_on)}</Td>
              <Td>{dateFmt(c.end_on)}</Td>
              <Td>
                <div className="flex items-center justify-end gap-2">
                  {c.pdf_vault_id && <Pill tone="ok">{tr("Signed")}</Pill>}
                  <DocButton
                    docType="EMPLOYMENT_CONTRACT"
                    id={c.hr_contract_id}
                    title={`Contract ${enumLabel(c.kind)}`}
                    label={tr("View")}
                  />
                  <UploadSigned contract={c} onDone={contracts.reload} />
                  {/* Renewal (10708): a new DRAFT that supersedes this one,
                      terms carried, dates continuing where the term ends. A
                      draft has no agreed term to renew. */}
                  {c.status !== "DRAFT" && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={renewing === c.hr_contract_id}
                      disabled={!!renewing}
                      onClick={() => renewContract(c)}
                    >
                      Renew
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </MiniTable>
      )}
      {tab === "Payroll" && (
        <MiniTable
          empty={pRows.length === 0}
          head={
            <>
              <Th>{tr("Period")}</Th>
              <Th>{tr("Status")}</Th>
              <Th r>Gross</Th>
              <Th r>Net pay</Th>
              <Th></Th>
            </>
          }
        >
          {pRows.map((p) => (
            <tr key={p.payroll_run_item_id}>
              <Td>{p.period_code}</Td>
              <Td>
                <Pill tone="mute">{enumLabel(p.status)}</Pill>
              </Td>
              <Td r>{money(p.gross)}</Td>
              <Td r>{money(p.net_pay)}</Td>
              <Td>
                <div className="flex justify-end">
                  <DocButton
                    docType="PAYSLIP"
                    id={p.payroll_run_item_id}
                    title={`Payslip ${p.period_code}`}
                    label={tr("View")}
                  />
                </div>
              </Td>
            </tr>
          ))}
        </MiniTable>
      )}
      {tab === "Advances" && (
        <MiniTable
          empty={adRows.length === 0}
          head={
            <>
              <Th>{tr("Advanced")}</Th>
              <Th r>Recovered</Th>
              <Th r>Outstanding</Th>
              <Th>{tr("Plan")}</Th>
              <Th>{tr("Status")}</Th>
            </>
          }
        >
          {adRows.map((a) => (
            <tr key={a.salary_advance_id}>
              <Td>{money(a.amount)}</Td>
              <Td r>{money(a.recovered)}</Td>
              <Td r>
                <span
                  className={Number(a.outstanding) > 0 ? "font-semibold" : ""}
                >
                  {money(a.outstanding)}
                </span>
              </Td>
              <Td>
                <span className="micro">
                  {a.instalments} × {money(a.instalment_amount)} from{" "}
                  {a.first_period_code}
                </span>
              </Td>
              <Td>
                <Pill
                  tone={
                    a.status === "ACTIVE"
                      ? "ok"
                      : a.status === "SETTLED"
                        ? "mute"
                        : a.status === "WRITTEN_OFF"
                          ? "bad"
                          : "warn"
                  }
                >
                  {enumLabel(a.status)}
                </Pill>
              </Td>
            </tr>
          ))}
        </MiniTable>
      )}
      {tab === "Leave" && (
        <MiniTable
          empty={lRows.length === 0}
          head={
            <>
              <Th>{tr("Kind")}</Th>
              <Th>{tr("From")}</Th>
              <Th>{tr("To")}</Th>
              <Th>{tr("Status")}</Th>
            </>
          }
        >
          {lRows.map((l) => (
            <tr key={l.leave_request_id}>
              <Td>{enumLabel(l.kind)}</Td>
              <Td>{dateFmt(l.starts_on)}</Td>
              <Td>{dateFmt(l.ends_on)}</Td>
              <Td>
                <Pill tone={LEAVE_TONE[l.status] || "mute"}>
                  {enumLabel(l.status)}
                </Pill>
              </Td>
            </tr>
          ))}
        </MiniTable>
      )}
      {tab === "Attendance" && (
        <MiniTable
          empty={aRows.length === 0}
          head={
            <>
              <Th>{tr("Clock in")}</Th>
              <Th>{tr("Clock out")}</Th>
              <Th r>Lateness</Th>
            </>
          }
        >
          {aRows.map((a) => (
            <tr key={a.attendance_id}>
              <Td>{a.clock_in_at ? dateTimeFmt(a.clock_in_at) : "—"}</Td>
              <Td>{a.clock_out_at ? dateTimeFmt(a.clock_out_at) : "—"}</Td>
              <td className="px-3 py-1.5 text-right">
                {a.is_late ? (
                  <Pill tone="warn">{a.minutes_late}m late</Pill>
                ) : (
                  <span className="micro">On time</span>
                )}
              </td>
            </tr>
          ))}
        </MiniTable>
      )}
      {tab === "Sanctions" && (
        <MiniTable
          empty={sRows.length === 0}
          head={
            <>
              <Th>{tr("Type")}</Th>
              <Th>{tr("Reason")}</Th>
              <Th r>Amount</Th>
              <Th>{tr("From")}</Th>
              <Th>{tr("Status")}</Th>
            </>
          }
        >
          {sRows.map((s) => (
            <tr key={s.hr_sanction_id}>
              <Td>{enumLabel(s.type)}</Td>
              <Td>
                <span className="block max-w-md truncate text-muted-foreground">
                  {s.reason}
                </span>
              </Td>
              <Td r>{s.amount_xaf != null ? money(s.amount_xaf) : "—"}</Td>
              <Td>{dateFmt(s.effective_date)}</Td>
              <Td>
                <Pill tone={s.status === "ACTIVE" ? "bad" : "ok"}>
                  {enumLabel(s.status)}
                </Pill>
              </Td>
            </tr>
          ))}
        </MiniTable>
      )}
      {tab === "Appraisals" && (
        <MiniTable
          empty={apRows.length === 0}
          head={
            <>
              <Th>{tr("Period")}</Th>
              <Th>Metric</Th>
              <Th r>{tr("Rating")}</Th>
              <Th r>Reward</Th>
            </>
          }
        >
          {apRows.map((a) => (
            <tr key={a.appraisal_id}>
              <Td>{a.period_code}</Td>
              <Td>{a.metric || "—"}</Td>
              <Td r>{a.rating ?? "—"}</Td>
              <Td r>
                {a.reward_amount != null ? money(a.reward_amount) : "—"}
              </Td>
            </tr>
          ))}
        </MiniTable>
      )}
    </div>
  );
}

export function EmployeesPage() {
  const employees = useResource(() => api.listEmployees(), []);
  const [q, setQ] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const rows = React.useMemo(() => employees.data || [], [employees.data]);
  /*
   * WHICH RECORD IS OPEN LIVES IN THE URL (`?focus=<id>`), not in state, so
   * that picking one from this list is a step the back and forward arrows can
   * reach — see app/layout/nav-trail-context.tsx. It also makes every row
   * here linkable, which the 360 drill-ins elsewhere in the app already
   * assume they can do.
   */
  const {
    record: selected,
    id: selId,
    open: select,
    openId: selectId,
    preselect,
  } = useRecordParam(rows, (e) => e.employee_id);
  const filtered = q
    ? rows.filter((e) =>
        (e.full_name || "").toLowerCase().includes(q.toLowerCase()),
      )
    : rows;
  // The list opens on its first row. `preselect` writes the same param with
  // `replace`: the user did not navigate here, so it must not become a step
  // the back arrow can land on.
  React.useEffect(() => {
    if (!selId && rows.length) preselect(rows[0]);
  }, [rows, selId, preselect]);
  // Names this step for the arrow tooltips and the hold-menu.
  useTrailTitle(selected ? selected.full_name : null);

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Human capital" to="/hr" />}
        title={tr("Employees")}
        description="The staff master — pick a person for their full HR record and history."
        action={<Button onClick={() => setCreating(true)}>New employee</Button>}
      />
      <HubTabs />{" "}
      {employees.error ? (
        <ErrorState message={employees.error} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            <Input
              placeholder="Search name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border p-1">
              {employees.loading ? (
                <div className="px-3 py-4 micro">{tr("Loading…")}</div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-4 micro">No employees.</div>
              ) : (
                filtered.map((e) => (
                  <button
                    key={e.employee_id}
                    onClick={() => select(e)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${e.employee_id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}
                  >
                    <span className="truncate font-medium">
                      {e.full_name || e.employee_id.slice(0, 8)}
                    </span>
                    <Pill tone={e.is_active !== false ? "ok" : "mute"}>
                      {e.is_active !== false ? "Active" : "Susp."}
                    </Pill>
                  </button>
                ))
              )}
            </div>
          </div>
          {selected ? (
            <EmployeeDetail employee={selected} onChanged={employees.reload} />
          ) : (
            <EmptyState
              title="No employee selected"
              hint="Choose a person from the list."
            />
          )}
        </div>
      )}
      {creating && (
        <NewEmployeeForm
          onClose={() => setCreating(false)}
          onSaved={(e) => {
            employees.reload();
            selectId(e.employee_id);
          }}
        />
      )}
      <ScreenAi path="hr/employees" />
    </section>
  );
}

export default EmployeesPage;
