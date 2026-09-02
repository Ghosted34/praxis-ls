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
import { useUrlTab, useFieldHighlight } from "@/lib/use-url-tab";
import { useRecordParam, useTrailTitle } from "@/app/layout/nav-trail-context";
import { Button } from "@/components/ui/button";
import { ComposeIconButton as MailIconButton } from "@/features/comms/inbox/composer/compose-icon-button";
import { DocButton } from "@/components/doc-button";
import { UploadSigned } from "@/features/hr/contracts";
import { AttendanceHistory } from "./attendance-history";
import { groupContracts } from "@/features/hr/contracts-grouping";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { useConfirm } from "@/components/ui/use-confirm";
import { Pill, type Tone } from "@/components/ui/pill";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PageHeader } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import {
  DepartmentSelect,
  type DepartmentValue,
} from "@/components/department-select";
import { Checkbox } from "@/components/ui/checkbox";
import { DateField } from "@/components/ui/date-field";
import { CountrySelect } from "@/components/country-select";
import { Callout } from "@/components/ui/callout";
import { FileDrop } from "@/components/ui/file-drop";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { money, dateFmt, enumLabel } from "@/lib/format";
import * as api from "@/lib/hr-api";
import { EmployeeWizard } from "./employee-wizard";
import {
  CIVILITIES,
  GENDERS,
  MARITAL_STATUSES,
  PAYMENT_METHODS,
  ID_DOCUMENT_TYPES,
  EMPLOYMENT_TYPES,
  ALLOWANCE_KINDS,
  WIZARD_DOC_SLOTS,
  draftFrom,
  draftToPayload,
  fileToDataUrl,
  fileTooLarge,
  type EmployeeDraft,
} from "./employee-form-model";
import { useNavigate } from "react-router-dom";

const shell = pageShell.wide;
/** The lifecycle (12763). PENDING is `warn` rather than `mute` on purpose: a
 *  record nobody has put into service is a queue item, not a neutral state. */
const STATUS_TONE: Record<string, Tone> = {
  PENDING: "warn",
  ACTIVE: "ok",
  SUSPENDED: "mute",
  TERMINATED: "bad",
};
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
/** Profile leads, because a record that cannot produce a contract is the first
 *  thing anybody opening this dossier needs to know. Documents and Pay follow —
 *  the staff file (12764) and the standing lines a contract states (12765) —
 *  then the history tabs that were already here. */
const TABS = [
  "Profile",
  "Documents",
  "Pay",
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

/**
 * Edit an employee — the wizard's fields, laid out as sections rather than steps.
 *
 * ── WHY NOT THE WIZARD AGAIN ───────────────────────────────────────────────
 *
 * A wizard is for work you are doing once, in order, when you do not yet know
 * what is being asked. Editing is the opposite: somebody has come to change one
 * thing, they know which thing, and making them click Continue twice to reach a
 * phone number is a tax on the most common action on this screen. Same fields,
 * same model (`employee-form-model`), different shape — which is exactly why
 * the field list lives in that model and not in either form.
 */
/* ── Contract readiness ─────────────────────────────────────────────────────
 *
 * The panel this dossier opens with, and the reason most of this work exists.
 * A work contract is generated FROM this record, so a blank place-of-birth is
 * not a cosmetic gap — it is a hole in a legal document, discovered at the
 * moment somebody is trying to print one.
 *
 * The gaps come from the server (`GET /employees/:id/readiness`), which reads
 * the same list `employees.rules` will apply when the contract is generated. A
 * record this panel calls ready is one the generator accepts.
 */
function ReadinessPanel({
  readiness,
  onFix,
}: {
  readiness: api.EmployeeReadiness | null;
  onFix: () => void;
}) {
  if (!readiness) return null;
  const { ready, percent, missing } = readiness;
  const required = missing.filter((m) => m.severity === "required");
  const nice = missing.filter((m) => m.severity === "recommended");
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">
            {ready ? tr("Ready for a contract") : tr("Not contract-ready yet")}
          </h4>
          <p className="mt-0.5 micro">
            {ready
              ? tr("Every fact a work contract states is on this record.")
              : tr(
                  "A contract generated now would have gaps where these facts belong.",
                )}
          </p>
        </div>
        {!ready && (
          <Button size="sm" variant="outline" onClick={onFix}>
            Fill them in
          </Button>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={tr("Contract readiness")}
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${ready ? "bg-[rgb(var(--ok))]" : "bg-primary"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1.5 micro">
        {readiness.complete}/{readiness.total} {tr("required facts recorded")}
      </p>
      {required.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {required.map((m) => (
            <Pill key={`${m.kind}:${m.key}`} tone="warn">
              {tr(m.label)}
            </Pill>
          ))}
        </div>
      )}
      {nice.length > 0 && (
        <p className="mt-2 micro">
          {tr("Also worth having:")} {nice.map((m) => tr(m.label)).join(", ")}.
        </p>
      )}
    </div>
  );
}

/** A read-only fact. `—` for a blank, so the shape of the record is visible
 *  and a gap is something you can see rather than something you infer. */
function Fact({
  label,
  value,
}: {
  label: string;
  value?: React.ReactNode | null;
}) {
  const empty =
    value === null || value === undefined || value === "" || value === false;
  return (
    <div>
      <dt className="micro">{tr(label)}</dt>
      <dd
        className={`text-sm ${empty ? "text-muted-foreground" : "text-foreground"}`}
      >
        {empty ? "—" : value}
      </dd>
    </div>
  );
}

/** Everything the record holds about the person, grouped the way the contract
 *  reads it. This is the tab the Edit dialog writes to. */
function ProfilePanel({ e }: { e: api.Employee }) {
  const group = (title: string, children: React.ReactNode) => (
    <div className="rounded-xl border bg-card p-4">
      <h4 className="mb-3 text-sm font-semibold text-foreground">{tr(title)}</h4>
      <dl className="grid gap-3 sm:grid-cols-3">{children}</dl>
    </div>
  );
  return (
    <div className="space-y-4">
      {group(
        "Identity",
        <>
          <Fact label="Matricule" value={e.staff_no} />
          <Fact label="Civility" value={e.civility && enumLabel(e.civility)} />
          <Fact label="Gender" value={e.gender && enumLabel(e.gender)} />
          <Fact label="Maiden name" value={e.maiden_name} />
          <Fact label="Date of birth" value={dateFmt(e.date_of_birth)} />
          <Fact label="Place of birth" value={e.place_of_birth} />
          <Fact label="Father's name" value={e.father_name} />
          <Fact label="Mother's name" value={e.mother_name} />
          <Fact label="Nationality" value={e.nationality} />
          <Fact
            label="Marital status"
            value={e.marital_status && enumLabel(e.marital_status)}
          />
          <Fact label="Dependent children" value={e.dependent_children} />
        </>,
      )}
      {group(
        "Identity document",
        <>
          <Fact
            label="Type"
            value={e.id_document_type && enumLabel(e.id_document_type)}
          />
          <Fact label="Number" value={e.id_document_number} />
          <Fact label="Issued on" value={dateFmt(e.id_document_issued_on)} />
          <Fact label="Issued at" value={e.id_document_issued_at} />
          <Fact label="Expires on" value={dateFmt(e.id_document_expires_on)} />
        </>,
      )}
      {group(
        "Contact",
        <>
          <Fact label="Residence" value={e.residence_address} />
          <Fact label="City" value={e.residence_city} />
          <Fact label="Mobile" value={e.phone_mobile} />
          <Fact label="WhatsApp" value={e.phone_whatsapp} />
          <Fact label="Desk" value={e.phone_desk} />
          <Fact label="Work email" value={e.email} />
          <Fact label="Personal email" value={e.personal_email} />
          <Fact label="Emergency contact" value={e.emergency_contact_name} />
          <Fact
            label="Relationship"
            value={e.emergency_contact_relationship}
          />
          <Fact label="Emergency phone" value={e.emergency_contact_phone} />
        </>,
      )}
      {group(
        "The engagement",
        <>
          <Fact label="Employer" value={e.entity_name} />
          <Fact label="Department" value={e.department} />
          <Fact label="Job title" value={e.job_title} />
          <Fact
            label="Contract type"
            value={e.employment_type && enumLabel(e.employment_type)}
          />
          <Fact
            label="Line manager"
            value={
              e.manager_name
                ? `${e.manager_name}${e.manager_job_title ? ` — ${e.manager_job_title}` : ""}`
                : null
            }
          />
          <Fact label="Start date" value={dateFmt(e.hired_on)} />
          <Fact label="Probation" value={e.probation_months && `${e.probation_months} months`} />
          <Fact label="Place of work" value={e.place_of_work} />
          <Fact label="Working hours" value={e.working_hours} />
          <Fact label="CNPS number" value={e.cnps_number} />
          <Fact
            label="Paid by"
            value={e.payment_method && enumLabel(e.payment_method)}
          />
          <Fact label="Drives" value={e.is_driver ? tr("Yes") : null} />
        </>,
      )}
    </div>
  );
}

/* ── The staff file (12764) ─────────────────────────────────────────────────
 *
 * A scan is a verification gate, not a creation gate, so this panel records a
 * document whether or not a file came with it — the empty slots are shown as
 * slots, because a missing ID card that is nowhere on the screen is a missing
 * ID card nobody chases.
 */
function DocumentsPanel({
  employeeId,
  docs,
  onChanged,
}: {
  employeeId: string;
  docs: api.EmployeeDocument[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [number, setNumber] = React.useState("");
  const [issued, setIssued] = React.useState("");
  const [expires, setExpires] = React.useState("");
  const [confirm, confirmDialog] = useConfirm();
  const types = useResource(() => api.employeeDocumentTypes(), []);

  const held = new Set(docs.map((d) => d.document_type_code).filter(Boolean));
  const gaps = WIZARD_DOC_SLOTS.filter((s) => !held.has(s.code));

  function reset() {
    setAdding(null);
    setFile(null);
    setNumber("");
    setIssued("");
    setExpires("");
    setError(null);
  }

  async function save(code: string) {
    setBusy(true);
    setError(null);
    try {
      await api.addEmployeeDocument(employeeId, {
        document_type_code: code,
        document_number: number.trim() || null,
        issued_on: issued || null,
        expires_on: expires || null,
        file_data_url: file ? await fileToDataUrl(file) : null,
        file_name: file ? file.name : null,
      });
      reset();
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(d: api.EmployeeDocument) {
    // Soft-delete on the server — a staff file is evidence. The wording says so,
    // rather than promising a destruction that does not happen.
    const ok = await confirm({
      title: tr("Remove this document from the file?"),
      body: tr(
        "It stops showing here. The record and any scan are retained for audit.",
      ),
      confirmLabel: tr("Remove document"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.removeEmployeeDocument(employeeId, d.document_id);
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  const expiring = (d: api.EmployeeDocument) => {
    if (!d.expires_on) return null;
    const days = Math.round(
      (new Date(d.expires_on).getTime() - Date.now()) / 86_400_000,
    );
    if (days < 0) return <Pill tone="bad">{tr("Expired")}</Pill>;
    if (days <= 60) return <Pill tone="warn">{days} {tr("days left")}</Pill>;
    return null;
  };

  return (
    <div className="space-y-4">
      {error && <ErrorState message={error} />}
      <MiniTable
        empty={docs.length === 0}
        head={
          <>
            <Th>{tr("Document")}</Th>
            <Th>{tr("Number")}</Th>
            <Th>{tr("Issued")}</Th>
            <Th>{tr("Expires")}</Th>
            <Th></Th>
          </>
        }
      >
        {docs.map((d) => (
          <tr key={d.document_id}>
            <Td>
              <span className="flex items-center gap-2">
                {d.document_type_name || d.title || tr("Document")}
                {d.has_file ? (
                  <Pill tone="ok">{tr("Scanned")}</Pill>
                ) : (
                  <Pill tone="mute">{tr("Paper only")}</Pill>
                )}
              </span>
            </Td>
            <Td>{d.document_number || "—"}</Td>
            <Td>{dateFmt(d.issued_on)}</Td>
            <Td>
              <span className="flex items-center gap-2">
                {dateFmt(d.expires_on)}
                {expiring(d)}
              </span>
            </Td>
            <Td r>
              <Button size="sm" variant="ghost" onClick={() => remove(d)}>
                Remove
              </Button>
            </Td>
          </tr>
        ))}
      </MiniTable>

      {gaps.length > 0 && (
        <Callout tone="warn" title={tr("Not on file yet")}>
          {gaps.map((g) => tr(g.label)).join(", ")}.
        </Callout>
      )}

      <div className="rounded-xl border bg-card p-4">
        <h4 className="mb-3 text-sm font-semibold text-foreground">
          {tr("Add a document")}
        </h4>
        <div className="flex flex-wrap gap-2">
          {(types.data || []).map((t) => (
            <Button
              key={t.document_type_id}
              size="sm"
              variant={adding === t.code ? "default" : "outline"}
              onClick={() => (adding === t.code ? reset() : setAdding(t.code))}
            >
              {t.name}
            </Button>
          ))}
        </div>
        {adding && (
          <div className="mt-4 space-y-3">
            <FileDrop
              file={file}
              onPick={setFile}
              accept="image/png,image/jpeg,image/webp,application/pdf"
              hint={tr(
                "PNG, JPG, WebP or PDF, up to 6 MB — or leave it and record the paper reference.",
              )}
              error={fileTooLarge(file)}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={tr("Number")}>
                <Input
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                />
              </Field>
              <Field label={tr("Issued on")}>
                <DateField value={issued} onChange={setIssued} />
              </Field>
              <Field label={tr("Expires on")}>
                <DateField value={expires} onChange={setExpires} />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={reset} disabled={busy}>
                Cancel
              </Button>
              <Button
                loading={busy}
                disabled={busy || Boolean(fileTooLarge(file))}
                onClick={() => save(adding)}
              >
                Add to file
              </Button>
            </div>
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}

/* ── Standing pay lines (12765) ─────────────────────────────────────────────
 *
 * Article 3 of a contract is a table that has to add up: base, plus each
 * standing allowance, equals the gross the document prints. This is where that
 * table is kept, and the total is computed by the server (`/employees/:id/pay`)
 * so the payslip, the offer letter and the renewal all quote one figure.
 */
function PayPanel({
  employeeId,
  pay,
  onChanged,
}: {
  employeeId: string;
  pay: api.EmployeePay | null;
  onChanged: () => void;
}) {
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [label, setLabel] = React.useState("");
  const [kind, setKind] = React.useState("ALLOWANCE");
  const [amount, setAmount] = React.useState("");
  const [inGross, setInGross] = React.useState(true);
  const [taxable, setTaxable] = React.useState(true);
  const [cnps, setCnps] = React.useState(true);
  const [confirm, confirmDialog] = useConfirm();

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api.addEmployeeAllowance(employeeId, {
        label: label.trim(),
        kind,
        amount: Number(amount),
        periodicity: "MONTHLY",
        is_taxable: taxable,
        in_cnps_base: cnps,
        in_gross: inGross,
        currency: null,
        effective_on: null,
        ends_on: null,
        notes: null,
      });
      setAdding(false);
      setLabel("");
      setAmount("");
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: api.EmployeeAllowance) {
    const ok = await confirm({
      title: tr("Remove this allowance?"),
      body: tr(
        "It stops counting toward the gross from now on. Past payslips are unaffected.",
      ),
      confirmLabel: tr("Remove allowance"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.removeEmployeeAllowance(employeeId, a.employee_allowance_id);
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  const lines = pay?.lines || [];
  return (
    <div className="space-y-4">
      {error && <ErrorState message={error} />}
      <MiniTable
        empty={lines.length === 0 && !pay}
        head={
          <>
            <Th>{tr("Line")}</Th>
            <Th>{tr("Kind")}</Th>
            <Th r>{tr("Monthly")}</Th>
            <Th></Th>
          </>
        }
      >
        <tr>
          <Td>
            <span className="font-medium text-foreground">
              {tr("Base salary")}
            </span>
          </Td>
          <Td>—</Td>
          <Td r>{money(pay?.base_salary ?? null)}</Td>
          <Td></Td>
        </tr>
        {lines.map((a) => (
          <tr key={a.employee_allowance_id}>
            <Td>
              <span className="flex items-center gap-2">
                {a.label}
                {!a.in_gross && <Pill tone="mute">{tr("In kind")}</Pill>}
                {!a.is_taxable && <Pill tone="mute">{tr("Untaxed")}</Pill>}
              </span>
            </Td>
            <Td>{enumLabel(a.kind || "")}</Td>
            <Td r>{money(a.amount)}</Td>
            <Td r>
              <Button size="sm" variant="ghost" onClick={() => remove(a)}>
                Remove
              </Button>
            </Td>
          </tr>
        ))}
        <tr className="bg-muted/50">
          <Td>
            <span className="font-semibold text-foreground">
              {tr("Total monthly gross")}
            </span>
          </Td>
          <Td></Td>
          <Td r>
            <span className="font-semibold">{money(pay?.monthly_gross ?? null)}</span>
          </Td>
          <Td></Td>
        </tr>
      </MiniTable>

      {adding ? (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={tr("Label")}>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={tr("Prime de responsabilité")}
              />
            </Field>
            <Field label={tr("Kind")}>
              <Select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  // Same rule as the wizard: a benefit in kind is taxed but not
                  // paid in cash, so it must not inflate the printed gross.
                  setInGross(e.target.value !== "BENEFIT_IN_KIND");
                }}
              >
                {ALLOWANCE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {tr(k.label)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tr("Monthly amount")}>
              <Input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <Checkbox
              checked={taxable}
              onCheckedChange={setTaxable}
              label={tr("Taxable")}
            />
            <Checkbox
              checked={cnps}
              onCheckedChange={setCnps}
              label={tr("In CNPS base")}
            />
            <Checkbox
              checked={inGross}
              onCheckedChange={setInGross}
              label={tr("Paid in cash")}
              hint={tr("Clear this for a benefit in kind.")}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setAdding(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={!label.trim() || !amount || busy}
              onClick={add}
            >
              Add allowance
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)}>
          Add an allowance
        </Button>
      )}
      {confirmDialog}
    </div>
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
  const { rows: staff } = useList<api.Employee>("/employees");
  const [f, setF] = React.useState<EmployeeDraft>(() => draftFrom(employee));
  const set = React.useCallback(
    <K extends keyof EmployeeDraft>(k: K, v: EmployeeDraft[K]) =>
      setF((s) => ({ ...s, [k]: v })),
    [],
  );
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
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const showsMaiden = api.employeeUsesMaidenName(f.gender, f.marital_status);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api.updateEmployee(
          employee.employee_id,
          draftToPayload(f, dept, reportsTo),
        ),
      );
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const Section = ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <fieldset className="space-y-4 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium text-foreground">
        {tr(title)}
      </legend>
      {children}
    </fieldset>
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      title={tr("Edit employee")}
      description={tr(
        "Everything a contract, a payslip and a dispatch are written from.",
      )}
    >
      <form className="space-y-5" onSubmit={submit}>
        <Section title="Identity">
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label={tr("Civility")}>
              <Select
                value={f.civility}
                onChange={(e) => set("civility", e.target.value)}
              >
                <option value="">—</option>
                {CIVILITIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {tr(c.label)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tr("Full name")} required className="sm:col-span-3">
              <Input
                value={f.full_name}
                onChange={(e) => set("full_name", e.target.value)}
              />
            </Field>
            <Field label={tr("Gender")}>
              <Select
                value={f.gender}
                onChange={(e) => set("gender", e.target.value)}
              >
                <option value="">—</option>
                {GENDERS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {tr(g.label)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tr("Marital status")}>
              <Select
                value={f.marital_status}
                onChange={(e) => set("marital_status", e.target.value)}
              >
                <option value="">—</option>
                {MARITAL_STATUSES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {tr(m.label)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tr("Dependent children")}>
              <Input
                type="number"
                min={0}
                value={f.dependent_children}
                onChange={(e) => set("dependent_children", e.target.value)}
              />
            </Field>
            {showsMaiden && (
              <Field
                label={tr("Maiden name")}
                hint={tr("« Née … Epse … » on the contract.")}
              >
                <Input
                  value={f.maiden_name}
                  onChange={(e) => set("maiden_name", e.target.value)}
                />
              </Field>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr("Date of birth")}>
              <DateField
                value={f.date_of_birth}
                onChange={(v) => set("date_of_birth", v)}
              />
            </Field>
            <Field label={tr("Place of birth")}>
              <Input
                value={f.place_of_birth}
                onChange={(e) => set("place_of_birth", e.target.value)}
              />
            </Field>
            <Field label={tr("Father's name")}>
              <Input
                value={f.father_name}
                onChange={(e) => set("father_name", e.target.value)}
              />
            </Field>
            <Field label={tr("Mother's name")}>
              <Input
                value={f.mother_name}
                onChange={(e) => set("mother_name", e.target.value)}
              />
            </Field>
            <Field label={tr("Nationality")} className="sm:col-span-2">
              <CountrySelect
                value={f.nationality}
                onChange={(code) => set("nationality", code)}
              />
            </Field>
          </div>
        </Section>

        <Section title="Identity document">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr("Type")}>
              <Select
                value={f.id_document_type}
                onChange={(e) => set("id_document_type", e.target.value)}
              >
                {ID_DOCUMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {tr(t.label)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tr("Number")}>
              <Input
                value={f.id_document_number}
                onChange={(e) => set("id_document_number", e.target.value)}
              />
            </Field>
            <Field label={tr("Issued on")}>
              <DateField
                value={f.id_document_issued_on}
                onChange={(v) => set("id_document_issued_on", v)}
              />
            </Field>
            <Field label={tr("Issued at")}>
              <Input
                value={f.id_document_issued_at}
                onChange={(e) => set("id_document_issued_at", e.target.value)}
              />
            </Field>
            <Field label={tr("Expires on")}>
              <DateField
                value={f.id_document_expires_on}
                onChange={(v) => set("id_document_expires_on", v)}
              />
            </Field>
          </div>
        </Section>

        <Section title="Contact">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr("Residence")} className="sm:col-span-2">
              <Input
                value={f.residence_address}
                onChange={(e) => set("residence_address", e.target.value)}
              />
            </Field>
            <Field label={tr("City")}>
              <Input
                value={f.residence_city}
                onChange={(e) => set("residence_city", e.target.value)}
              />
            </Field>
            <Field label={tr("Mobile")}>
              <Input
                value={f.phone_mobile}
                onChange={(e) => set("phone_mobile", e.target.value)}
              />
            </Field>
            <Field label={tr("WhatsApp")}>
              <Input
                value={f.phone_whatsapp}
                onChange={(e) => set("phone_whatsapp", e.target.value)}
              />
            </Field>
            <Field label={tr("Desk phone")}>
              <Input
                value={f.phone_desk}
                onChange={(e) => set("phone_desk", e.target.value)}
              />
            </Field>
            <Field label={tr("Personal email")}>
              <Input
                type="email"
                value={f.personal_email}
                onChange={(e) => set("personal_email", e.target.value)}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={tr("Emergency contact")}>
              <Input
                value={f.emergency_contact_name}
                onChange={(e) => set("emergency_contact_name", e.target.value)}
              />
            </Field>
            <Field label={tr("Relationship")}>
              <Input
                value={f.emergency_contact_relationship}
                onChange={(e) =>
                  set("emergency_contact_relationship", e.target.value)
                }
              />
            </Field>
            <Field label={tr("Emergency phone")}>
              <Input
                value={f.emergency_contact_phone}
                onChange={(e) => set("emergency_contact_phone", e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title="The engagement">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr("Employer entity")}>
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
            <Field label={tr("Department")} hint="From your organigramme.">
              <DepartmentSelect value={dept} onChange={setDept} />
            </Field>
            <Field label={tr("Job title")}>
              <Input
                value={f.job_title}
                onChange={(e) => set("job_title", e.target.value)}
              />
            </Field>
            <Field label={tr("Contract type")}>
              <Select
                value={f.employment_type}
                onChange={(e) => set("employment_type", e.target.value)}
              >
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={tr("Reports to")}
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
            <Field label={tr("Work email")} hint="Used to send payslips & contracts">
              <Input
                type="email"
                value={f.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </Field>
            <Field label={tr("Start date")}>
              <DateField
                value={f.hired_on}
                onChange={(v) => set("hired_on", v)}
              />
            </Field>
            <Field label={tr("Probation (months)")}>
              <Input
                type="number"
                min={0}
                max={24}
                value={f.probation_months}
                onChange={(e) => set("probation_months", e.target.value)}
              />
            </Field>
            <Field label={tr("Place of work")}>
              <Input
                value={f.place_of_work}
                onChange={(e) => set("place_of_work", e.target.value)}
              />
            </Field>
            <Field label={tr("Working hours")}>
              <Input
                value={f.working_hours}
                onChange={(e) => set("working_hours", e.target.value)}
              />
            </Field>
            <Field label={tr("CNPS number")}>
              <Input
                value={f.cnps_number}
                onChange={(e) => set("cnps_number", e.target.value)}
              />
            </Field>
          </div>
          <Checkbox
            checked={f.is_driver}
            onCheckedChange={(v) => set("is_driver", v)}
            label={tr("This person drives")}
            hint={tr("Puts them in the fleet dispatch pool.")}
          />
        </Section>

        <Section title="Remuneration">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={tr("Base salary (monthly)")}>
              <Input
                type="number"
                min={0}
                value={f.base_salary}
                onChange={(e) => set("base_salary", e.target.value)}
              />
            </Field>
            <Field label={tr("Currency")}>
              <Input
                value={f.salary_currency}
                maxLength={3}
                onChange={(e) =>
                  set("salary_currency", e.target.value.toUpperCase())
                }
              />
            </Field>
            <Field label={tr("Paid by")}>
              <Select
                value={f.payment_method}
                onChange={(e) => set("payment_method", e.target.value)}
              >
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm.value} value={pm.value}>
                    {tr(pm.label)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {/* Standing allowances are edited on the Pay tab, not here: they are
              rows with their own lifecycle, and a modal that saves the whole
              record would have to decide what "cancel" means for a line
              somebody deleted three sections ago. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr("Bank")}>
              <Input
                value={f.bank_name}
                onChange={(e) => set("bank_name", e.target.value)}
              />
            </Field>
            <Field label={tr("Branch")}>
              <Input
                value={f.bank_branch}
                onChange={(e) => set("bank_branch", e.target.value)}
              />
            </Field>
            <Field label={tr("Account number")}>
              <Input
                value={f.bank_account_number}
                onChange={(e) => set("bank_account_number", e.target.value)}
              />
            </Field>
            <Field label={tr("IBAN")}>
              <Input
                value={f.bank_iban}
                onChange={(e) => set("bank_iban", e.target.value)}
              />
            </Field>
            <Field label={tr("SWIFT / BIC")}>
              <Input
                value={f.bank_swift}
                onChange={(e) => set("bank_swift", e.target.value)}
              />
            </Field>
          </div>
        </Section>

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
  // `?tab=` / `?field=`, so a signature gap or an alert can link to the tab it
  // means rather than to the top of the dossier. Same hook as entity-360.
  // Profile is the fallback: an existing `?tab=Contracts` link still lands on
  // contracts, but arriving at the dossier cold shows the record first.
  const [tab, setTab] = useUrlTab<Tab>(TABS, "Profile");
  useFieldHighlight([tab]);
  // Latched off the ACTIVE tab rather than off the click, so a link that lands
  // on `?tab=Documents` loads that panel too — a deep link that opens an empty
  // tab is worse than no deep link.
  React.useEffect(() => {
    setOpened((o) => (o[tab] ? o : { ...o, [tab]: true }));
  }, [tab]);
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const eid = employee.employee_id;
  const active = employee.is_active !== false;

  const navigate = useNavigate();
  /*
   * ── WHAT LOADS EAGERLY, AND WHAT WAITS ─────────────────────────────────
   *
   * Readiness and the account are read the moment somebody is selected: both
   * are in the header, and both answer questions ("can this produce a
   * contract?", "can this person sign in?") that are the reason for opening the
   * dossier at all.
   *
   * The staff file and the pay decomposition wait for their tab. Picking a name
   * out of the roster already costs seven requests; making it eleven — over a
   * mobile connection, for two panels most visits never open — is a real cost
   * paid for nothing. `opened` latches, so switching back to a tab does not
   * re-fetch and the count survives moving away from it.
   */
  const readiness = useResource(() => api.employeeReadiness(eid), [eid]);
  const account = useResource(() => api.employeeAccount(eid), [eid]);
  const [opened, setOpened] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => setOpened({}), [eid]);
  const documents = useResource(
    () => (opened.Documents ? api.employeeDocuments(eid) : Promise.resolve(null)),
    [eid, opened.Documents],
  );
  const pay = useResource(
    () => (opened.Pay ? api.employeePay(eid) : Promise.resolve(null)),
    [eid, opened.Pay],
  );

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
  // Kept for the tab's count badge only: the Attendance tab itself now mounts
  // the shared history widget, which fetches its own window. This is "is there
  // anything in here", not the tab's data.
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
  /** Which engagements have their superseded terms showing. Same rule as the
   *  Contracts list: a renewal is a new contract row against the same person,
   *  so successive terms collapse into the current one rather than stacking up
   *  as what looks like the same contract listed twice. */
  const [openTerms, setOpenTerms] = React.useState<Set<string>>(
    () => new Set(),
  );
  const toggleTerms = (key: string) =>
    setOpenTerms((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

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

  const cGroups = groupContracts(contracts.data);
  const cRows = contracts.data || [],
    pRows = payroll.data || [],
    adRows = advances.data || [],
    lRows = leave.data || [],
    aRows = attendance.data || [],
    sRows = sanctions.data || [],
    apRows = appraisals.data || [];
  /*
   * `null` means "not known yet", and renders as no badge at all. A `0` on a tab
   * that has simply not been fetched is a claim — "this person has no documents
   * on file" — and it is the exact claim this screen must never make wrongly.
   */
  const counts: Record<Tab, number | null> = {
    // Profile has no count — it is the record itself, not a collection.
    Profile: null,
    Documents: documents.data ? documents.data.length : null,
    Pay: pay.data ? pay.data.lines.length : null,
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
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-foreground">
                {employee.full_name || employee.employee_id.slice(0, 8)}
              </h3>
              {employee.staff_no && (
                <span className="num rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground">
                  {employee.staff_no}
                </span>
              )}
              <Pill tone={STATUS_TONE[employee.status || ""] || (active ? "ok" : "mute")}>
                {enumLabel(employee.status || (active ? "ACTIVE" : "SUSPENDED"))}
              </Pill>
              {/* Whether this person can sign in, on the record itself. Before
                  this the answer lived only on the Users screen, so "has anyone
                  provisioned them?" was a trip to a different area. */}
              {account.data &&
                (account.data.provisioned ? (
                  <Pill tone="ok">{tr("Has a login")}</Pill>
                ) : (
                  <Pill tone="warn">{tr("No login")}</Pill>
                ))}
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
            <MailIconButton
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
            {/* ── THE DEEP LINK ───────────────────────────────────────────
                Straight to Users with this person's details filled in, or to
                the login they already have. Only the employee id travels in
                the URL; the target screen reads the record itself, so the form
                cannot be pre-filled with whatever a hand-edited link says.  */}
            {account.data &&
              (account.data.provisioned ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate("/security/users")}
                >
                  Open their account
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() =>
                    navigate(`/security/users?provision=${eid}`)
                  }
                >
                  Provision account
                </Button>
              ))}
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
            readiness.reload();
            account.reload();
            onChanged();
          }}
        />
      )}

      {/* Above the tabs, not inside one: whether this record can produce a
          contract is context for everything below it, not another section to
          go looking for. Hidden once it is ready — a green bar that never
          changes is a bar people stop reading. */}
      {readiness.data && !readiness.data.ready && (
        <ReadinessPanel
          readiness={readiness.data}
          onFix={() => setEditing(true)}
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
            {counts[t] !== null && (
              <span className="ml-1.5 micro">{counts[t]}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "Profile" && (
        <div className="space-y-4">
          {readiness.data && readiness.data.ready && (
            <ReadinessPanel
              readiness={readiness.data}
              onFix={() => setEditing(true)}
            />
          )}
          <ProfilePanel e={employee} />
        </div>
      )}
      {tab === "Documents" && (
        <DocumentsPanel
          employeeId={eid}
          docs={documents.data || []}
          onChanged={() => {
            documents.reload();
            // A new ID card can close the last gap, so the meter has to move
            // with it rather than on the next full page load.
            readiness.reload();
          }}
        />
      )}
      {tab === "Pay" && (
        <PayPanel
          employeeId={eid}
          pay={pay.data || null}
          onChanged={() => pay.reload()}
        />
      )}
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
          {cGroups.flatMap((g) => {
            const isOpen = openTerms.has(g.key);
            const row = (c: api.Contract, earlier: boolean) => (
              <tr
                key={c.hr_contract_id}
                className={earlier ? "opacity-80" : undefined}
              >
                <Td>
                  {earlier ? (
                    <span className="flex items-center gap-2 pl-4 text-muted-foreground">
                      <span aria-hidden>↳</span>
                      <span>{tr("Earlier term")}</span>
                      {c.doc_number && (
                        <span className="num text-xs">{c.doc_number}</span>
                      )}
                    </span>
                  ) : (
                    <span className="flex flex-col items-start gap-0.5">
                      <span>{enumLabel(c.kind)}</span>
                      {g.history.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleTerms(g.key)}
                          aria-expanded={isOpen}
                          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                          {isOpen ? tr("Hide") : tr("Show")} {g.history.length}{" "}
                          {g.history.length === 1
                            ? tr("earlier term")
                            : tr("earlier terms")}
                        </button>
                      )}
                    </span>
                  )}
                </Td>
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
            );
            return [
              row(g.head, false),
              ...(isOpen ? g.history.map((h) => row(h, true)) : []),
            ];
          })}
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
      {/*
        * The raw punch list this replaces could only ever say "here are the
        * clock-ins". A day of approved leave and a day somebody simply did not
        * come looked identical in it — both absent from the list — and there
        * was no window, no KPI and no download. This is the SAME widget My HR
        * and the HR history tab mount, pinned to this person: leave, holidays
        * and days off are rows, and the numbers are the ones payroll reads.
        */}
      {tab === "Attendance" && <AttendanceHistory scope="hr" employeeId={eid} />}
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
  const navigate = useNavigate();

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
  /*
   * "Who is hired and still has no way to sign in" is the question that used to
   * need a bespoke endpoint (legacy `pending_users.php`). It is a filter on the
   * roster now, because as a filter it composes: this entity, this department,
   * awaiting a login — rather than one hard-coded list somebody has to maintain.
   */
  const [lens, setLens] = React.useState<"ALL" | "NO_LOGIN" | "PENDING">("ALL");
  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((e) => {
      if (lens === "NO_LOGIN" && e.account_user_id) return false;
      if (lens === "PENDING" && e.status !== "PENDING") return false;
      if (!needle) return true;
      // The matricule is what people quote on the phone, so it searches too.
      return `${e.full_name || ""} ${e.staff_no || ""} ${e.job_title || ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, q, lens]);
  const awaitingLogin = rows.filter((e) => !e.account_user_id).length;
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
              placeholder="Search name or matricule…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["ALL", `All (${rows.length})`],
                  ["NO_LOGIN", `Awaiting a login (${awaitingLogin})`],
                  ["PENDING", "Not started"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={lens === key}
                  onClick={() => setLens(key)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    lens === key
                      ? "border-primary bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-primary-ink"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {tr(label)}
                </button>
              ))}
            </div>
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
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {e.full_name || e.employee_id.slice(0, 8)}
                      </span>
                      <span className="block truncate micro">
                        {[e.staff_no, e.job_title].filter(Boolean).join(" · ") ||
                          "—"}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {!e.account_user_id && (
                        <span
                          aria-label={tr("No login yet")}
                          title={tr("No login yet")}
                          className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--warn))]"
                        />
                      )}
                      <Pill
                        tone={
                          STATUS_TONE[e.status || ""] ||
                          (e.is_active !== false ? "ok" : "mute")
                        }
                      >
                        {e.status
                          ? enumLabel(e.status).slice(0, 5)
                          : e.is_active !== false
                            ? "Active"
                            : "Susp."}
                      </Pill>
                    </span>
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
        <EmployeeWizard
          onClose={() => setCreating(false)}
          onSaved={(e, provision) => {
            employees.reload();
            selectId(e.employee_id);
            // "Save and provision" hands straight over to Users with this
            // person's details filled in. The navigation belongs here, not in
            // the wizard: it leaves the HR area, and the screen that owns the
            // route is the one that should decide to leave it.
            if (provision) navigate(`/security/users?provision=${e.employee_id}`);
          }}
        />
      )}
      <ScreenAi path="hr/employees" />
    </section>
  );
}

export default EmployeesPage;
