/**
 * The employee form, as data.
 *
 * ── WHY A MODEL FILE AND NOT TWO FORMS ─────────────────────────────────────
 *
 * A new hire is collected as a three-step wizard; an existing employee is
 * edited as grouped sections on their dossier. Those are two different shapes
 * for the same fifty-odd fields, and the moment they each own their own list of
 * what an employee is, one of them starts missing a column. Both read this.
 *
 * `EmployeeDraft` is deliberately all-strings — it is form state, and an
 * `<input>` holds a string. The number/date/null conversions happen once, in
 * `draftToPayload`, rather than at fifty call sites.
 */
import type {
  Employee,
  EmployeeInput,
  EmployeeDocumentInput,
  EmployeeAllowanceInput,
  ReadinessGap,
} from "@/lib/hr-api";

export const STEPS = [
  { key: "identity", label: "Who they are" },
  { key: "employment", label: "The engagement" },
  { key: "documents", label: "Papers & access" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];

/* ── Option lists. Mirror the CHECK constraints in 12763/12765 — a value not
 * in these lists is a 422 from the API, so they are a contract, not a taste. */
export const CIVILITIES = [
  { value: "MR", label: "M." },
  { value: "MRS", label: "Mme" },
  { value: "MS", label: "Mlle" },
  { value: "DR", label: "Dr" },
  { value: "PROF", label: "Pr" },
];
export const GENDERS = [
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
  { value: "UNSPECIFIED", label: "Prefer not to say" },
];
export const MARITAL_STATUSES = [
  { value: "SINGLE", label: "Single" },
  { value: "MARRIED", label: "Married" },
  { value: "DIVORCED", label: "Divorced" },
  { value: "WIDOWED", label: "Widowed" },
  { value: "SEPARATED", label: "Separated" },
  { value: "COHABITING", label: "Cohabiting" },
];
export const PAYMENT_METHODS = [
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "MOBILE_MONEY", label: "Mobile money" },
  { value: "CASH", label: "Cash" },
  { value: "CHEQUE", label: "Cheque" },
];
/** Open text in the column (12763) — a tenant hiring a refugee holds a document
 *  none of these name — so the control offers the common three and accepts more. */
export const ID_DOCUMENT_TYPES = [
  { value: "CNI", label: "National ID card (CNI)" },
  { value: "PASSPORT", label: "Passport" },
  { value: "RESIDENCE_PERMIT", label: "Residence permit" },
  { value: "OTHER", label: "Other" },
];
export const EMPLOYMENT_TYPES = [
  "CDI",
  "CDD",
  "STAGE",
  "INTERIM",
  "CONSULTANT",
  "TEMPORARY",
];
export const ALLOWANCE_KINDS = [
  { value: "ALLOWANCE", label: "Allowance / prime" },
  { value: "INDEMNITY", label: "Indemnity" },
  { value: "BONUS", label: "Standing bonus" },
  { value: "BENEFIT_IN_KIND", label: "Benefit in kind" },
  { value: "DEDUCTION", label: "Standing deduction" },
];
export const EMPLOYEE_STATUSES = [
  { value: "PENDING", label: "Pending — not in service yet" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "TERMINATED", label: "Terminated" },
];

/** The document slots step 3 lays out by default. Everything else is added by
 *  hand; these are the four a staff file is expected to open with. Codes are
 *  from 12764's registry seed. */
export const WIZARD_DOC_SLOTS = [
  { code: "EMP_ID_CARD", label: "ID card / passport", required: true },
  { code: "EMP_CV", label: "Curriculum vitae", required: false },
  { code: "EMP_PHOTO", label: "Passport photograph", required: false },
  { code: "EMP_BANK_RIB", label: "Bank RIB", required: false },
];

/** One document as the form holds it: a chosen File that has not been read yet,
 *  plus the metadata typed beside it. */
export type DraftDoc = {
  code: string;
  label: string;
  required: boolean;
  file: File | null;
  document_number: string;
  issued_on: string;
  expires_on: string;
  physical_ref: string;
};

export type DraftAllowance = {
  label: string;
  kind: string;
  amount: string;
  periodicity: string;
  is_taxable: boolean;
  in_cnps_base: boolean;
  in_gross: boolean;
};

export type EmployeeDraft = {
  /* identity */
  full_name: string;
  civility: string;
  gender: string;
  maiden_name: string;
  date_of_birth: string;
  place_of_birth: string;
  father_name: string;
  mother_name: string;
  nationality: string;
  marital_status: string;
  dependent_children: string;
  id_document_type: string;
  id_document_number: string;
  id_document_issued_on: string;
  id_document_issued_at: string;
  id_document_expires_on: string;
  residence_address: string;
  residence_city: string;
  phone_mobile: string;
  phone_whatsapp: string;
  phone_desk: string;
  personal_email: string;
  emergency_contact_name: string;
  emergency_contact_relationship: string;
  emergency_contact_phone: string;
  /* employment */
  entity_id: string;
  job_title: string;
  employment_type: string;
  email: string;
  hired_on: string;
  probation_months: string;
  place_of_work: string;
  working_hours: string;
  cnps_number: string;
  is_driver: boolean;
  status: string;
  /* pay */
  base_salary: string;
  salary_currency: string;
  payment_method: string;
  bank_name: string;
  bank_branch: string;
  bank_account_number: string;
  bank_iban: string;
  bank_swift: string;
};

export const emptyDraft = (): EmployeeDraft => ({
  full_name: "",
  civility: "",
  gender: "",
  maiden_name: "",
  date_of_birth: "",
  place_of_birth: "",
  father_name: "",
  mother_name: "",
  nationality: "",
  marital_status: "",
  dependent_children: "",
  id_document_type: "CNI",
  id_document_number: "",
  id_document_issued_on: "",
  id_document_issued_at: "",
  id_document_expires_on: "",
  residence_address: "",
  residence_city: "",
  phone_mobile: "",
  phone_whatsapp: "",
  phone_desk: "",
  personal_email: "",
  emergency_contact_name: "",
  emergency_contact_relationship: "",
  emergency_contact_phone: "",
  entity_id: "",
  job_title: "",
  employment_type: "CDI",
  email: "",
  hired_on: "",
  probation_months: "",
  place_of_work: "",
  working_hours: "",
  cnps_number: "",
  is_driver: false,
  // A record typed before someone starts is PENDING, and the 360 offers "Mark
  // active" on their first day. Defaulting to ACTIVE would put an unstarted
  // hire on the payroll roster.
  status: "PENDING",
  base_salary: "",
  salary_currency: "",
  payment_method: "BANK_TRANSFER",
  bank_name: "",
  bank_branch: "",
  bank_account_number: "",
  bank_iban: "",
  bank_swift: "",
});

/** Seed the form from a saved record — the sectioned edit form's entry point. */
export function draftFrom(e: Employee): EmployeeDraft {
  const d = emptyDraft();
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const bank = (e.bank_block || {}) as Record<string, unknown>;
  return {
    ...d,
    full_name: s(e.full_name),
    civility: s(e.civility),
    gender: s(e.gender),
    maiden_name: s(e.maiden_name),
    date_of_birth: s(e.date_of_birth).slice(0, 10),
    place_of_birth: s(e.place_of_birth),
    father_name: s(e.father_name),
    mother_name: s(e.mother_name),
    nationality: s(e.nationality),
    marital_status: s(e.marital_status),
    dependent_children: s(e.dependent_children),
    id_document_type: s(e.id_document_type) || d.id_document_type,
    id_document_number: s(e.id_document_number),
    id_document_issued_on: s(e.id_document_issued_on).slice(0, 10),
    id_document_issued_at: s(e.id_document_issued_at),
    id_document_expires_on: s(e.id_document_expires_on).slice(0, 10),
    residence_address: s(e.residence_address),
    residence_city: s(e.residence_city),
    phone_mobile: s(e.phone_mobile),
    phone_whatsapp: s(e.phone_whatsapp),
    phone_desk: s(e.phone_desk),
    personal_email: s(e.personal_email),
    emergency_contact_name: s(e.emergency_contact_name),
    emergency_contact_relationship: s(e.emergency_contact_relationship),
    emergency_contact_phone: s(e.emergency_contact_phone),
    entity_id: s(e.entity_id),
    job_title: s(e.job_title),
    employment_type: s(e.employment_type) || d.employment_type,
    email: s(e.email),
    hired_on: s(e.hired_on).slice(0, 10),
    probation_months: s(e.probation_months),
    place_of_work: s(e.place_of_work),
    working_hours: s(e.working_hours),
    cnps_number: s(e.cnps_number),
    is_driver: e.is_driver === true,
    status: s(e.status) || "ACTIVE",
    base_salary: s(e.base_salary),
    salary_currency: s(e.salary_currency),
    payment_method: s(e.payment_method) || d.payment_method,
    bank_name: s(bank.bank_name),
    bank_branch: s(bank.branch),
    bank_account_number: s(bank.account_number),
    bank_iban: s(bank.iban),
    bank_swift: s(bank.swift),
  };
}

/** "" → undefined, so an untouched field is absent from the PATCH rather than
 *  clearing a value somebody else filled in. */
const t = (v: string) => {
  const s = v.trim();
  return s === "" ? undefined : s;
};
const n = (v: string) => {
  const s = v.trim();
  if (s === "") return undefined;
  const num = Number(s);
  return Number.isFinite(num) ? num : undefined;
};

export function draftToPayload(
  f: EmployeeDraft,
  dept: { scope_id: string | null; department: string | null },
  reportsTo: string,
): EmployeeInput & { full_name: string } {
  const bank_block: Record<string, string> = {};
  if (t(f.bank_name)) bank_block.bank_name = f.bank_name.trim();
  if (t(f.bank_branch)) bank_block.branch = f.bank_branch.trim();
  if (t(f.bank_account_number))
    bank_block.account_number = f.bank_account_number.trim();
  if (t(f.bank_iban)) bank_block.iban = f.bank_iban.trim();
  if (t(f.bank_swift)) bank_block.swift = f.bank_swift.trim();

  return {
    full_name: f.full_name.trim(),
    entity_id: t(f.entity_id),
    scope_id: dept.scope_id || undefined,
    department: dept.department || undefined,
    reports_to: reportsTo || undefined,
    job_title: t(f.job_title),
    email: t(f.email),
    employment_type: t(f.employment_type),
    cnps_number: t(f.cnps_number),
    is_driver: f.is_driver,
    status: (t(f.status) as EmployeeInput["status"]) || undefined,

    civility: t(f.civility),
    gender: t(f.gender),
    maiden_name: t(f.maiden_name),
    date_of_birth: t(f.date_of_birth),
    place_of_birth: t(f.place_of_birth),
    father_name: t(f.father_name),
    mother_name: t(f.mother_name),
    nationality: t(f.nationality),
    marital_status: t(f.marital_status),
    dependent_children: n(f.dependent_children),
    id_document_type: t(f.id_document_type),
    id_document_number: t(f.id_document_number),
    id_document_issued_on: t(f.id_document_issued_on),
    id_document_issued_at: t(f.id_document_issued_at),
    id_document_expires_on: t(f.id_document_expires_on),

    residence_address: t(f.residence_address),
    residence_city: t(f.residence_city),
    phone_mobile: t(f.phone_mobile),
    phone_whatsapp: t(f.phone_whatsapp),
    phone_desk: t(f.phone_desk),
    personal_email: t(f.personal_email),
    emergency_contact_name: t(f.emergency_contact_name),
    emergency_contact_relationship: t(f.emergency_contact_relationship),
    emergency_contact_phone: t(f.emergency_contact_phone),

    hired_on: t(f.hired_on),
    probation_months: n(f.probation_months),
    place_of_work: t(f.place_of_work),
    working_hours: t(f.working_hours),
    payment_method: t(f.payment_method),
    base_salary: n(f.base_salary),
    salary_currency: t(f.salary_currency),
    bank_block: Object.keys(bank_block).length ? bank_block : undefined,
  };
}

/**
 * The largest file the document routes accept, checked in the browser.
 *
 * The API refuses anything over ~6 MB (employees.validator), and finding that
 * out AFTER base64-encoding a 20 MB photograph and pushing it over a Douala
 * mobile connection is a minute of somebody's life for an answer that was
 * knowable instantly. Same number, stated in both places on purpose: the server
 * is the enforcement, this is the courtesy.
 */
export const MAX_DOC_BYTES = 6 * 1024 * 1024;

/** Why this file cannot be uploaded, or null. */
export function fileTooLarge(file: File | null): string | null {
  if (!file || file.size <= MAX_DOC_BYTES) return null;
  return `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is 6 MB. Photograph it at a lower resolution, or attach a PDF.`;
}

/** Read a picked File as the base64 data URL the API vaults. */
export const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });

/** The document rows worth sending: one with a file, a number, or a paper
 *  reference. An untouched slot is not a document. */
export async function draftDocsToPayload(
  docs: DraftDoc[],
): Promise<EmployeeDocumentInput[]> {
  const out: EmployeeDocumentInput[] = [];
  for (const d of docs) {
    const meaningful =
      d.file || t(d.document_number) || t(d.physical_ref) || t(d.issued_on);
    if (!meaningful) continue;
    out.push({
      document_type_code: d.code,
      title: d.label,
      document_number: t(d.document_number) ?? null,
      issued_on: t(d.issued_on) ?? null,
      expires_on: t(d.expires_on) ?? null,
      physical_ref: t(d.physical_ref) ?? null,
      file_data_url: d.file ? await fileToDataUrl(d.file) : null,
      file_name: d.file ? d.file.name : null,
    });
  }
  return out;
}

export const draftAllowancesToPayload = (
  rows: DraftAllowance[],
): EmployeeAllowanceInput[] =>
  rows
    .filter((r) => r.label.trim() !== "" && r.amount.trim() !== "")
    .map((r) => ({
      label: r.label.trim(),
      kind: r.kind,
      amount: Number(r.amount),
      periodicity: r.periodicity,
      is_taxable: r.is_taxable,
      in_cnps_base: r.in_cnps_base,
      in_gross: r.in_gross,
      currency: null,
      effective_on: null,
      ends_on: null,
      notes: null,
    }));

/**
 * Which step a field is typed on.
 *
 * The wizard uses it to land a failed save on the step the rejection is about:
 * a 422 names its fields, and putting the operator two steps away from the one
 * that was refused is how a form gets abandoned. Keyed by column name because
 * that is what the API's `fields` map returns.
 *
 * Anything absent maps to step 0, which is where a rejection with no field name
 * is least likely to be a surprise.
 */
export const FIELD_STEP: Record<string, number> = {
  full_name: 0, civility: 0, gender: 0, maiden_name: 0, date_of_birth: 0,
  place_of_birth: 0, father_name: 0, mother_name: 0, nationality: 0,
  marital_status: 0, dependent_children: 0, id_document_type: 0,
  id_document_number: 0, id_document_issued_on: 0, id_document_issued_at: 0,
  id_document_expires_on: 0, residence_address: 0, residence_city: 0,
  phone_mobile: 0, phone_whatsapp: 0, phone_desk: 0, personal_email: 0,
  emergency_contact_name: 0, emergency_contact_relationship: 0,
  emergency_contact_phone: 0,

  entity_id: 1, scope_id: 1, department: 1, reports_to: 1, job_title: 1,
  employment_type: 1, email: 1, hired_on: 1, probation_months: 1,
  place_of_work: 1, working_hours: 1, cnps_number: 1, is_driver: 1, status: 1,
  base_salary: 1, salary_currency: 1, payment_method: 1, bank_block: 1,
  allowances: 1,

  documents: 2,
};

/** The step a rejected save should return to: the first field the API named. */
export function stepForRejection(err: unknown): number | null {
  const fields = (err as { fields?: Record<string, unknown> } | null)?.fields;
  if (!fields || typeof fields !== "object") return null;
  const keys = Object.keys(fields);
  if (!keys.length) return null;
  return Math.min(...keys.map((k) => FIELD_STEP[k] ?? 0));
}

/** Fields the API fills in itself — not gaps a person can close in a form. */
const SERVER_ALLOCATED = new Set(["staff_no"]);

/** The shape `GET /employees/readiness-requirements` returns. */
export type ReadinessRequirements = {
  fields: { key: string; label: string; group: string; severity: string }[];
  documents: { code: string; label: string; severity: string }[];
};

/**
 * Score an UNSAVED draft against the server's requirement list.
 *
 * The list is the server's; only the scoring runs here, because the record does
 * not exist yet and there is nothing to ask about. Once it is saved, the 360
 * reads `GET /employees/:id/readiness` instead and this is not used again.
 */
export function readinessOf(
  payload: Record<string, unknown>,
  docCodes: string[],
  reqs: ReadinessRequirements | null,
): { filled: number; total: number; missing: ReadinessGap[] } {
  if (!reqs) return { filled: 0, total: 0, missing: [] };
  const required = reqs.fields.filter(
    // The matricule is allocated by the server on save, so a draft never holds
    // one. Counting it would park the meter one short of the total for the
    // whole wizard and teach people the number never reaches the end.
    (r) => r.severity === "required" && !SERVER_ALLOCATED.has(r.key),
  );
  const requiredDocs = reqs.documents.filter((d) => d.severity === "required");
  const have = new Set(docCodes);
  const missing: ReadinessGap[] = [];
  for (const r of required) {
    const v = payload[r.key];
    const present =
      v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "");
    if (!present)
      missing.push({
        key: r.key,
        label: r.label,
        group: r.group as ReadinessGap["group"],
        severity: "required",
        kind: "field",
      });
  }
  for (const d of requiredDocs) {
    if (!have.has(d.code))
      missing.push({
        key: d.code,
        label: d.label,
        group: "documents",
        severity: "required",
        kind: "document",
      });
  }
  const total = required.length + requiredDocs.length;
  return { filled: total - missing.length, total, missing };
}
