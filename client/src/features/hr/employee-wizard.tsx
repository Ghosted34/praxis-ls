/**
 * New employee — the three-step hire.
 *
 * ── WHY THIS REPLACED A SEVEN-FIELD MODAL ──────────────────────────────────
 *
 * "New employee" used to ask for a name, an entity, a department, a job title,
 * a line manager, an email and an employment type. Seven fields, of which the
 * `employee` table has fifty-seven — and, more to the point, of which a work
 * contract needs none of the ones it did not ask for.
 *
 * A real Cameroonian CDI opens by identifying the employee as:
 *
 *   « Mme FORMUM Epse FORGHAB Florence Ngwenjang, Née le 28 Février 1970 à
 *     NTAMBU MUNDUM, Fille de FORMUM Isaac et de NJENG Onika, Titulaire de la
 *     CNI N° 101510674 délivrée le 03 février 2021 à CE54. Demeurant à
 *     Ndogbong Douala, et De nationalité Camerounaise »
 *
 * — and then assigns a matricule, states a probation term, a place of work, an
 * hours pattern, and a salary DECOMPOSED into base plus allowances. None of
 * that was collectable. Contract generation reads this record, so every gap
 * here becomes a hole in a legal document later.
 *
 * ── WHY THREE STEPS AND NOT ONE LONG FORM ──────────────────────────────────
 *
 * Fifty fields on one screen is a form nobody finishes: people fill the top
 * third, hit Save, and the record is permanently half-typed because there is no
 * moment that says it is incomplete. Three steps give the work a shape people
 * recognise — who they are, what we are hiring them to do, and their papers —
 * and the bar says how far along they are, so stopping halfway feels like
 * stopping halfway instead of like finishing.
 *
 * ── NOTHING BLOCKS EXCEPT THE NAME ─────────────────────────────────────────
 *
 * Every field is present whether or not it can be filled today, and only the
 * full name is required to save. This is deliberate and it is the same call
 * `vacancy-wizard` made: a wizard that refuses to let you past step two is one
 * people escape by inventing an answer, and an invented CNI number is worse
 * than a blank one — a blank is visible, and the readiness meter counts it.
 *
 * A scan is a verification gate, not a creation gate (12764): step 3 records
 * paper-only documents happily. What refuses to run without the documents is
 * contract generation, which is where the requirement actually bites.
 *
 * ── THE METER IS THE SERVER'S DEFINITION, NOT A SECOND ONE ─────────────────
 *
 * The "contract-ready" count comes from `GET /employees/readiness-requirements`
 * — the list `employees.rules` scores a SAVED record against. Re-typing that
 * list here would give the UI its own opinion of complete, and the two would
 * disagree the first time either was edited, with the wizard reporting 100% on
 * a record the generator then rejects.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { DateField } from "@/components/ui/date-field";
import { FileDrop } from "@/components/ui/file-drop";
import { CountrySelect } from "@/components/country-select";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { Pill } from "@/components/ui/pill";
import {
  DepartmentSelect,
  type DepartmentValue,
} from "@/components/department-select";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import * as api from "@/lib/hr-api";
import {
  STEPS,
  CIVILITIES,
  GENDERS,
  MARITAL_STATUSES,
  PAYMENT_METHODS,
  ID_DOCUMENT_TYPES,
  EMPLOYMENT_TYPES,
  ALLOWANCE_KINDS,
  EMPLOYEE_STATUSES,
  WIZARD_DOC_SLOTS,
  emptyDraft,
  draftToPayload,
  draftDocsToPayload,
  draftAllowancesToPayload,
  stepForRejection,
  fileTooLarge,
  type EmployeeDraft,
  type DraftDoc,
  type DraftAllowance,
  readinessOf,
} from "./employee-form-model";

/* ── The progress bar ───────────────────────────────────────────────────────
 * A real `<progress>`-shaped control: `role="progressbar"` with the aria value
 * trio, because a bar that only exists as a coloured div tells a screen-reader
 * user nothing about how much of a long form is left.
 */
function StepProgress({
  step,
  ready,
}: {
  step: number;
  ready: { filled: number; total: number };
}) {
  const pct = Math.round(((step + 1) / STEPS.length) * 100);
  return (
    <div className="space-y-2">
      <ol className="flex items-center gap-2 text-xs">
        {STEPS.map((s, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <React.Fragment key={s.key}>
              {i > 0 && (
                <span
                  aria-hidden
                  className={`h-px flex-1 ${i <= step ? "bg-primary" : "bg-border"}`}
                />
              )}
              <span
                aria-current={current ? "step" : undefined}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 font-semibold transition-colors ${
                  current
                    ? "bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-primary-ink"
                    : done
                      ? "text-primary-ink"
                      : "text-muted-foreground"
                }`}
              >
                <span
                  aria-hidden
                  className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${
                    i <= step
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </span>
                {tr(s.label)}
              </span>
            </React.Fragment>
          );
        })}
      </ol>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={tr("Progress through the new-employee steps")}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* The second number is the one that matters after saving: how much of
          what a contract needs is actually on the record. Muted, because it
          informs rather than blocks. */}
      <p className="text-xs text-muted-foreground">
        {tr("Step")} {step + 1} {tr("of")} {STEPS.length} ·{" "}
        <span className={ready.filled === ready.total ? "text-primary-ink" : ""}>
          {ready.filled}/{ready.total} {tr("contract fields filled")}
        </span>
      </p>
    </div>
  );
}

/* ── Step 1 — who this person is ────────────────────────────────────────────*/
function IdentityStep({
  f,
  set,
}: {
  f: EmployeeDraft;
  set: <K extends keyof EmployeeDraft>(k: K, v: EmployeeDraft[K]) => void;
}) {
  // "Née FORMUM Epse FORGHAB" is a birth name beside a married one, and it
  // exists only for a woman whose name changed. Asking everybody for a maiden
  // name gets it filled with the surname they already gave.
  const showsMaiden = api.employeeUsesMaidenName(f.gender, f.marital_status);
  return (
    <div className="space-y-5">
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
        <Field
          label={tr("Full name")}
          required
          className="sm:col-span-3"
          hint={tr("As it appears on their ID document.")}
        >
          <Input
            value={f.full_name}
            onChange={(e) => set("full_name", e.target.value)}
            placeholder="FORMUM Florence Ngwenjang"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
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
        <Field
          label={tr("Dependent children")}
          hint={tr("Drives family allowance.")}
        >
          <Input
            type="number"
            min={0}
            value={f.dependent_children}
            onChange={(e) => set("dependent_children", e.target.value)}
          />
        </Field>
      </div>

      {showsMaiden && (
        <Field
          label={tr("Maiden name")}
          hint={tr(
            "The birth name, where it differs — the contract states both (« Née … Epse … »).",
          )}
        >
          <Input
            value={f.maiden_name}
            onChange={(e) => set("maiden_name", e.target.value)}
            placeholder="FORGHAB"
          />
        </Field>
      )}

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
            placeholder="NTAMBU MUNDUM"
          />
        </Field>
        <Field
          label={tr("Father's name")}
          hint={tr("Named in the contract's identification clause.")}
        >
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
      </div>

      <Field label={tr("Nationality")}>
        <CountrySelect
          value={f.nationality}
          onChange={(code) => set("nationality", code)}
        />
      </Field>

      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium text-foreground">
          {tr("Identity document")}
        </legend>
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
              placeholder="101510674"
            />
          </Field>
          <Field label={tr("Issued on")}>
            <DateField
              value={f.id_document_issued_on}
              onChange={(v) => set("id_document_issued_on", v)}
            />
          </Field>
          <Field label={tr("Issued at")} hint={tr("The issuing office.")}>
            <Input
              value={f.id_document_issued_at}
              onChange={(e) => set("id_document_issued_at", e.target.value)}
              placeholder="CE54"
            />
          </Field>
          <Field
            label={tr("Expires on")}
            hint={tr("Leave blank if it does not expire.")}
          >
            <DateField
              value={f.id_document_expires_on}
              onChange={(v) => set("id_document_expires_on", v)}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium text-foreground">
          {tr("Where they live and how to reach them")}
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Residence")} className="sm:col-span-2">
            <Input
              value={f.residence_address}
              onChange={(e) => set("residence_address", e.target.value)}
              placeholder="Ndogbong"
            />
          </Field>
          <Field label={tr("City")}>
            <Input
              value={f.residence_city}
              onChange={(e) => set("residence_city", e.target.value)}
              placeholder="Douala"
            />
          </Field>
          <Field label={tr("Mobile")}>
            <Input
              value={f.phone_mobile}
              onChange={(e) => set("phone_mobile", e.target.value)}
              placeholder="+237 6 96 12 25 11"
            />
          </Field>
          <Field
            label={tr("WhatsApp")}
            hint={tr("If it differs from the mobile.")}
          >
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
          <Field
            label={tr("Personal email")}
            hint={tr("Survives the day the work address is disabled.")}
            className="sm:col-span-2"
          >
            <Input
              type="email"
              value={f.personal_email}
              onChange={(e) => set("personal_email", e.target.value)}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium text-foreground">
          {tr("Emergency contact")}
        </legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={tr("Name")}>
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
              placeholder={tr("Spouse")}
            />
          </Field>
          <Field label={tr("Phone")}>
            <Input
              value={f.emergency_contact_phone}
              onChange={(e) => set("emergency_contact_phone", e.target.value)}
            />
          </Field>
        </div>
      </fieldset>
    </div>
  );
}

/* ── Step 2 — the engagement ────────────────────────────────────────────────*/
function EmploymentStep({
  f,
  set,
  dept,
  setDept,
  reportsTo,
  setReportsTo,
  entities,
  staff,
  allowances,
  setAllowances,
}: {
  f: EmployeeDraft;
  set: <K extends keyof EmployeeDraft>(k: K, v: EmployeeDraft[K]) => void;
  dept: DepartmentValue;
  setDept: (v: DepartmentValue) => void;
  reportsTo: string;
  setReportsTo: (v: string) => void;
  entities: { entity_id: string; legal_name?: string; code?: string }[];
  staff: api.Employee[];
  allowances: DraftAllowance[];
  setAllowances: (rows: DraftAllowance[]) => void;
}) {
  const base = Number(f.base_salary || 0);
  // Article 3 of the contract is a table that has to add up. Showing the total
  // as the allowances are typed is what stops a contract stating a gross that
  // does not match its own lines.
  const monthlyAdditions = allowances
    .filter((a) => a.in_gross && a.kind !== "DEDUCTION" && a.periodicity === "MONTHLY")
    .reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  const gross = base + monthlyAdditions;
  const fmt = (v: number) =>
    Number.isFinite(v) ? v.toLocaleString("fr-FR") : "—";

  const setRow = (i: number, patch: Partial<DraftAllowance>) =>
    setAllowances(allowances.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={tr("Employer entity")}
          hint={tr("The company named as the Employer on the contract.")}
        >
          <Select
            value={f.entity_id}
            onChange={(e) => set("entity_id", e.target.value)}
          >
            <option value="">—</option>
            {entities.map((en) => (
              <option key={en.entity_id} value={en.entity_id}>
                {en.legal_name || en.entity_id.slice(0, 8)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("Department")} hint={tr("From your organigramme.")}>
          <DepartmentSelect value={dept} onChange={setDept} />
        </Field>
        <Field label={tr("Job title")}>
          <Input
            value={f.job_title}
            onChange={(e) => set("job_title", e.target.value)}
            placeholder={tr("Responsable commercial")}
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
          hint={tr("Their line manager — who approves their leave and appraisals.")}
        >
          <Select
            value={reportsTo}
            onChange={(e) => setReportsTo(e.target.value)}
          >
            <option value="">{tr("— nobody —")}</option>
            {staff.map((p) => (
              <option key={p.employee_id} value={p.employee_id}>
                {p.full_name}
                {p.job_title ? ` — ${p.job_title}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={tr("Work email")}
          hint={tr("Payslips, contracts and the account invitation go here.")}
        >
          <Input
            type="email"
            value={f.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="name@company.cm"
          />
        </Field>
        <Field label={tr("Start date")}>
          <DateField
            value={f.hired_on}
            onChange={(v) => set("hired_on", v)}
          />
        </Field>
        <Field
          label={tr("Probation (months)")}
          hint={tr("« Une période d'essai de 4 mois … renouvelable une fois »")}
        >
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
            placeholder={tr("Head office, Douala")}
          />
        </Field>
        <Field label={tr("Working hours")}>
          <Input
            value={f.working_hours}
            onChange={(e) => set("working_hours", e.target.value)}
            placeholder={tr("Mon–Fri, 08:00–17:00")}
          />
        </Field>
        <Field label={tr("CNPS number")}>
          <Input
            value={f.cnps_number}
            onChange={(e) => set("cnps_number", e.target.value)}
          />
        </Field>
        <Field
          label={tr("Record status")}
          hint={tr("Pending keeps them off the payroll roster until they start.")}
        >
          <Select
            value={f.status}
            onChange={(e) => set("status", e.target.value)}
          >
            {EMPLOYEE_STATUSES.filter((s) => s.value !== "TERMINATED").map(
              (s) => (
                <option key={s.value} value={s.value}>
                  {tr(s.label)}
                </option>
              ),
            )}
          </Select>
        </Field>
      </div>

      <Checkbox
        checked={f.is_driver}
        onCheckedChange={(v) => set("is_driver", v)}
        label={tr("This person drives")}
        hint={tr(
          "Puts them in the fleet dispatch pool and raises the default CNPS risk class.",
        )}
      />

      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium text-foreground">
          {tr("Remuneration")}
        </legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={tr("Base salary (monthly)")}>
            <Input
              type="number"
              min={0}
              value={f.base_salary}
              onChange={(e) => set("base_salary", e.target.value)}
              placeholder="600000"
            />
          </Field>
          <Field label={tr("Currency")}>
            <Input
              value={f.salary_currency}
              onChange={(e) =>
                set("salary_currency", e.target.value.toUpperCase())
              }
              placeholder="XAF"
              maxLength={3}
            />
          </Field>
          <Field label={tr("Paid by")}>
            <Select
              value={f.payment_method}
              onChange={(e) => set("payment_method", e.target.value)}
            >
              {PAYMENT_METHODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {tr(p.label)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Standing allowances. The contract states a decomposition, not one
            number, and until 12765 the middle line of that table had nowhere
            to live. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">
              {tr("Standing allowances")}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setAllowances([
                  ...allowances,
                  {
                    label: "",
                    kind: "ALLOWANCE",
                    amount: "",
                    periodicity: "MONTHLY",
                    is_taxable: true,
                    in_cnps_base: true,
                    in_gross: true,
                  },
                ])
              }
            >
              {tr("Add a line")}
            </Button>
          </div>
          {allowances.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              {tr(
                "No allowances — the gross is the base salary. Add a line for a prime de responsabilité, a transport indemnity, and so on.",
              )}
            </p>
          ) : (
            <div className="space-y-2">
              {allowances.map((row, i) => (
                <div
                  key={i}
                  className="grid gap-2 rounded-lg border p-3 sm:grid-cols-12"
                >
                  <Field label={tr("Label")} className="sm:col-span-4">
                    <Input
                      value={row.label}
                      onChange={(e) => setRow(i, { label: e.target.value })}
                      placeholder={tr("Prime de responsabilité")}
                    />
                  </Field>
                  <Field label={tr("Kind")} className="sm:col-span-3">
                    <Select
                      value={row.kind}
                      onChange={(e) =>
                        setRow(i, {
                          kind: e.target.value,
                          // A benefit in kind is remuneration and it is taxed,
                          // but nobody is handed the money — so it leaves the
                          // cash gross the moment the kind is chosen, rather
                          // than after somebody notices the total is wrong.
                          in_gross: e.target.value !== "BENEFIT_IN_KIND",
                        })
                      }
                    >
                      {ALLOWANCE_KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {tr(k.label)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={tr("Amount")} className="sm:col-span-3">
                    <Input
                      type="number"
                      min={0}
                      value={row.amount}
                      onChange={(e) => setRow(i, { amount: e.target.value })}
                      placeholder="50000"
                    />
                  </Field>
                  <div className="flex items-end sm:col-span-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setAllowances(allowances.filter((_, j) => j !== i))
                      }
                    >
                      {tr("Remove")}
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-4 sm:col-span-12">
                    <Checkbox
                      checked={row.is_taxable}
                      onCheckedChange={(v) => setRow(i, { is_taxable: v })}
                      label={tr("Taxable")}
                    />
                    <Checkbox
                      checked={row.in_cnps_base}
                      onCheckedChange={(v) => setRow(i, { in_cnps_base: v })}
                      label={tr("In CNPS base")}
                    />
                    <Checkbox
                      checked={row.in_gross}
                      onCheckedChange={(v) => setRow(i, { in_gross: v })}
                      label={tr("Paid in cash")}
                      hint={tr("Clear this for a benefit in kind.")}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-baseline justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              {tr("Total monthly gross")}
            </span>
            <span className="num font-semibold text-foreground">
              {fmt(gross)} {f.salary_currency || ""}
            </span>
          </div>
        </div>

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
      </fieldset>
    </div>
  );
}

/* ── Step 3 — the papers, and what happens next ─────────────────────────────*/
function DocumentsStep({
  docs,
  setDocs,
  provision,
  setProvision,
  hasEmail,
  missing,
}: {
  docs: DraftDoc[];
  setDocs: (rows: DraftDoc[]) => void;
  provision: boolean;
  setProvision: (v: boolean) => void;
  hasEmail: boolean;
  missing: { label: string; group: string }[];
}) {
  const setRow = (i: number, patch: Partial<DraftDoc>) =>
    setDocs(docs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-5">
      <Callout tone="info" title={tr("Upload what you have.")}>
        {tr(
          "A document can be recorded from paper — give it a number or an archive reference and attach the scan later. Nothing here blocks saving; contract generation is what needs the file.",
        )}
      </Callout>

      <div className="space-y-3">
        {docs.map((d, i) => (
          <div key={d.code} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {tr(d.label)}
              </span>
              {d.required && <Pill tone="warn">{tr("Needed for a contract")}</Pill>}
              {d.file && <Pill tone="ok">{tr("Scan attached")}</Pill>}
            </div>
            <FileDrop
              file={d.file}
              onPick={(file) => setRow(i, { file })}
              accept="image/png,image/jpeg,image/webp,application/pdf"
              hint={tr("PNG, JPG, WebP or PDF — up to 6 MB.")}
              error={fileTooLarge(d.file)}
            />
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label={tr("Number")}>
                <Input
                  value={d.document_number}
                  onChange={(e) =>
                    setRow(i, { document_number: e.target.value })
                  }
                />
              </Field>
              <Field label={tr("Issued on")}>
                <DateField
                  value={d.issued_on}
                  onChange={(v) => setRow(i, { issued_on: v })}
                />
              </Field>
              <Field label={tr("Expires on")}>
                <DateField
                  value={d.expires_on}
                  onChange={(v) => setRow(i, { expires_on: v })}
                />
              </Field>
              <Field
                label={tr("Paper reference")}
                hint={tr("Box or file number.")}
              >
                <Input
                  value={d.physical_ref}
                  onChange={(e) => setRow(i, { physical_ref: e.target.value })}
                />
              </Field>
            </div>
          </div>
        ))}
      </div>

      {/* The deep link out. Checked by default when there is an address to
          invite — provisioning is the next thing that happens to a new hire,
          and making it a separate errand on a separate screen is how people
          end up with a staff record and no way to sign in. */}
      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium text-foreground">
          {tr("System access")}
        </legend>
        <Checkbox
          checked={provision && hasEmail}
          onCheckedChange={setProvision}
          disabled={!hasEmail}
          label={tr("Provision a login for this person after saving")}
          hint={
            hasEmail
              ? tr(
                  "Takes you straight to Users with their details filled in. They choose their own password from an emailed invitation — you never handle it.",
                )
              : tr(
                  "Add a work email on the previous step to invite them. You can also provision from their record at any time.",
                )
          }
        />
      </fieldset>

      {missing.length > 0 && (
        <Callout
          tone="warn"
          title={tr("This record cannot produce a contract yet.")}
        >
          <p className="mb-1">
            {tr("Still missing:")}{" "}
            {missing.map((m) => tr(m.label)).join(", ")}.
          </p>
          <p>
            {tr(
              "Saving is fine — the gaps show on their record and can be filled at any time.",
            )}
          </p>
        </Callout>
      )}
    </div>
  );
}

/* ── The wizard ─────────────────────────────────────────────────────────────*/
export function EmployeeWizard({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  /** The saved employee, and whether the operator asked to provision a login —
   *  the caller owns the navigation, because it leaves this screen's area. */
  onSaved: (employee: api.Employee, provision: boolean) => void;
}) {
  const [step, setStep] = React.useState(0);
  const [f, setF] = React.useState<EmployeeDraft>(emptyDraft);
  const set = React.useCallback(
    <K extends keyof EmployeeDraft>(k: K, v: EmployeeDraft[K]) =>
      setF((s) => ({ ...s, [k]: v })),
    [],
  );
  const [dept, setDept] = React.useState<DepartmentValue>({
    scope_id: null,
    department: null,
  });
  const [reportsTo, setReportsTo] = React.useState("");
  const [allowances, setAllowances] = React.useState<DraftAllowance[]>([]);
  const [docs, setDocs] = React.useState<DraftDoc[]>(() =>
    WIZARD_DOC_SLOTS.map((s) => ({
      ...s,
      file: null,
      document_number: "",
      issued_on: "",
      expires_on: "",
      physical_ref: "",
    })),
  );
  const [provision, setProvision] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const { rows: entities } = useList<{
    entity_id: string;
    legal_name?: string;
  }>("/entities");
  const { rows: staff } = useList<api.Employee>("/employees");
  // The server's definition of contract-ready, fetched once. See the header.
  const reqs = useResource(() => api.employeeReadinessRequirements(), []);

  const payload = React.useMemo(
    () => draftToPayload(f, dept, reportsTo),
    [f, dept, reportsTo],
  );
  const docCodes = React.useMemo(
    () =>
      docs
        .filter((d) => d.file || d.document_number.trim() || d.physical_ref.trim())
        .map((d) => d.code),
    [docs],
  );
  const ready = React.useMemo(
    () => readinessOf(payload as Record<string, unknown>, docCodes, reqs.data),
    [payload, docCodes, reqs.data],
  );

  const last = step === STEPS.length - 1;
  // An oversized scan blocks the SAVE, not the record: the fix is to drop the
  // file or re-take it, and letting the request go anyway would spend a minute
  // uploading it to be told the same thing by a 422.
  const oversized = docs.map((d) => fileTooLarge(d.file)).filter(Boolean);
  const canSave = f.full_name.trim().length >= 2 && oversized.length === 0;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createEmployee({
        ...payload,
        full_name: f.full_name.trim(),
        documents: await draftDocsToPayload(docs),
        allowances: draftAllowancesToPayload(allowances),
      });
      onSaved(created, provision && Boolean(payload.email));
      onClose();
    } catch (err) {
      setError(errMsg(err));
      // Land them back on the step the failure is about, so a rejected date is
      // in front of them rather than two steps behind. Driven by the FIELD NAMES
      // a 422 carries, not by matching words in the message — prose is
      // translated and rewritten, and a step that moves when somebody improves
      // an error string is a step nobody can rely on.
      const s = stepForRejection(err);
      if (s !== null) setStep(s);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      title={tr("New employee")}
      description={tr(
        "The record every contract, payslip and dispatch is written from. Only the name is required — the rest can be filled in later, and the meter says what is still outstanding.",
      )}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || busy}
          >
            {tr("Back")}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {tr("Cancel")}
            </Button>
            {last ? (
              <Button
                type="button"
                onClick={save}
                loading={busy}
                disabled={!canSave || busy}
              >
                {provision && payload.email
                  ? tr("Save and provision")
                  : tr("Save employee")}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                disabled={busy}
              >
                {tr("Continue")}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <StepProgress step={step} ready={ready} />
        {step === 0 && <IdentityStep f={f} set={set} />}
        {step === 1 && (
          <EmploymentStep
            f={f}
            set={set}
            dept={dept}
            setDept={setDept}
            reportsTo={reportsTo}
            setReportsTo={setReportsTo}
            entities={entities || []}
            staff={staff || []}
            allowances={allowances}
            setAllowances={setAllowances}
          />
        )}
        {step === 2 && (
          <DocumentsStep
            docs={docs}
            setDocs={setDocs}
            provision={provision}
            setProvision={setProvision}
            hasEmail={Boolean(payload.email)}
            missing={ready.missing}
          />
        )}
        {error && <ErrorState message={error} />}
      </div>
    </Modal>
  );
}
