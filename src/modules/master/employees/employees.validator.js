/** Employee master (MOD-02) Zod validators — full column coverage. */
"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

// Cameroon/OHADA employment categories (soft enum: unknown strings still allowed
// so a tenant isn't blocked, but the common set is documented for the UI/AI).
const EMPLOYMENT_TYPES = ["CDI", "CDD", "STAGE", "INTERIM", "CONSULTANT", "TEMPORARY"];
const CIVILITIES = ["MR", "MRS", "MS", "DR", "PROF"];
const GENDERS = ["MALE", "FEMALE", "UNSPECIFIED"];
const MARITAL_STATUSES = ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "SEPARATED", "COHABITING"];
const PAYMENT_METHODS = ["BANK_TRANSFER", "MOBILE_MONEY", "CASH", "CHEQUE"];
const EMPLOYEE_STATUSES = ["PENDING", "ACTIVE", "SUSPENDED", "TERMINATED"];
const ALLOWANCE_KINDS = ["ALLOWANCE", "BONUS", "INDEMNITY", "BENEFIT_IN_KIND", "DEDUCTION"];
const PERIODICITIES = ["MONTHLY", "QUARTERLY", "ANNUAL", "ONE_OFF"];
/** Marital states in which a birth name differs from the name in use. */
const NAME_CHANGE_STATUSES = ["MARRIED", "DIVORCED", "WIDOWED", "SEPARATED"];

/** YYYY-MM-DD, nullable so HR can clear a date rather than only replace it. */
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in the form YYYY-MM-DD")
  .optional()
  .nullable();
/** Free text that HR may also blank out. `""` is normalised to null on write. */
const text = (max) => z.string().trim().max(max).optional().nullable();

const base = {
  entity_id: z.string().uuid().optional(),
  full_name: z.string().min(2),
  // Department is a scope (0490): scope_id is the reference, department the
  // display snapshot the controller keeps in step with it.
  scope_id: z.string().uuid().optional().nullable(),
  // Line manager (0493). Cycles are rejected in the service, not here — the
  // check needs the tree.
  reports_to: z.string().uuid().optional().nullable(),
  department: z.string().max(120).optional(),
  job_title: z.string().max(120).optional(),
  email: z.string().email().optional().or(z.literal("")),
  employment_type: z.union([z.enum(EMPLOYMENT_TYPES), z.string().max(40)]).optional(),
  cnps_number: z.string().max(40).optional(),
  // Added in 12759. HR owns these; user_signature_profile overrides them on
  // signatures only. Nullable so HR can clear a number, not just replace it.
  phone_desk: z.string().trim().max(40).optional().nullable(),
  phone_mobile: z.string().trim().max(40).optional().nullable(),
  // Date service started (0696). Leave accrues per month of SERVICE, so the
  // accrual job has no anchor without it; the migration backfills it from
  // created_at and this is how a real start date replaces that proxy.
  hired_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in the form YYYY-MM-DD").optional().nullable(),
  base_salary: z.number().nonnegative().optional(),
  risk_class_rate: z.number().min(0).max(1).optional(),
  bank_block: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  signatory_name: z.string().max(160).optional(),
  avatar_ref: z.string().max(400).optional(),
  is_driver: z.boolean().optional(),

  /* ── Civil identity (12763) ─────────────────────────────────────────────
   * Everything a work contract names the employee by. See the migration for
   * the paragraph these come from; the short version is that a generator
   * missing any one of them produces a document with a hole in it.
   */
  civility: z.enum(CIVILITIES).optional().nullable(),
  gender: z.enum(GENDERS).optional().nullable(),
  // Only meaningful alongside gender + marital status — the FORM asks for it
  // conditionally (see the wizard), the SCHEMA accepts it unconditionally so an
  // imported record or an unusual case is still storable.
  maiden_name: text(160),
  date_of_birth: dateStr,
  place_of_birth: text(160),
  father_name: text(160),
  mother_name: text(160),
  // ISO 3166-1 alpha-2, matching corporate_entity.country_code.
  nationality: z.string().trim().toUpperCase().length(2).optional().nullable().or(z.literal("")),
  marital_status: z.enum(MARITAL_STATUSES).optional().nullable(),
  dependent_children: z.number().int().min(0).max(40).optional().nullable(),
  id_document_type: text(40),
  id_document_number: text(60),
  id_document_issued_on: dateStr,
  id_document_issued_at: text(120),
  id_document_expires_on: dateStr,

  /* ── Contact card (12763) ───────────────────────────────────────────────── */
  phone_whatsapp: text(40),
  personal_email: z.string().email().optional().nullable().or(z.literal("")),
  residence_address: text(400),
  residence_city: text(120),
  emergency_contact_name: text(160),
  emergency_contact_relationship: text(60),
  emergency_contact_phone: text(40),

  /* ── Standing terms a contract is drafted from (12763) ──────────────────── */
  probation_months: z.number().int().min(0).max(24).optional().nullable(),
  place_of_work: text(200),
  working_hours: text(200),
  payment_method: z.enum(PAYMENT_METHODS).optional().nullable(),
  salary_currency: z.string().trim().toUpperCase().length(3).optional().nullable().or(z.literal("")),

  /* ── Lifecycle (12763) ──────────────────────────────────────────────────
   * `is_active` stays writable for every existing caller; the DB trigger keeps
   * the two in step whichever one is written.
   */
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  terminated_on: dateStr,
  termination_reason: text(400),
};

/**
 * Self-service (employees.self.js). `.strict()` so an unknown key is a 422
 * rather than being quietly dropped: someone POSTing `base_salary` here should
 * get a clear refusal, not a silent no-op that looks like it worked.
 */
const updateMine = z.object({
  phone_desk: z.string().trim().max(40).nullable().optional().or(z.literal("")),
  phone_mobile: z.string().trim().max(40).nullable().optional().or(z.literal("")),
}).strict();

/** One row of `employee_document` (12764), as the wizard and the docs tab post it. */
const documentBody = z.object({
  document_type_id: z.string().uuid().optional().nullable(),
  // Accepted as an alternative to the uuid so a caller can say EMP_ID_CARD
  // without first resolving the registry.
  document_type_code: z.string().trim().max(60).optional().nullable(),
  title: text(200),
  document_number: text(120),
  issuing_authority: text(200),
  issued_on: dateStr,
  expires_on: dateStr,
  country_code: z.string().trim().toUpperCase().length(2).optional().nullable().or(z.literal("")),
  physical_ref: text(120),
  notes: text(1000),
  // The scan itself: a base64 data URL the service vaults, or an already-vaulted
  // document id. Both optional — a paper-only row is valid (12764).
  //
  // 8 MB of base64 is ~6 MB of file, which is a phone photograph of an ID card
  // with room to spare. It sits UNDER the 12 MB body limit these two routes
  // carry (src/server.js) so one oversized file is refused by name here rather
  // than as a 413 that blames nothing, and the whole four-document create still
  // fits. document_vault re-checks the decoded bytes and the content type.
  file_data_url: z.string().max(8_000_000, "That file is too large — 6 MB is the limit").optional().nullable(),
  file_name: text(260),
  vault_id: z.string().uuid().optional().nullable(),
});

/** One row of `employee_allowance` (12765). */
const allowanceBody = z.object({
  label: z.string().trim().min(1).max(160),
  kind: z.enum(ALLOWANCE_KINDS).optional(),
  amount: z.number().nonnegative(),
  currency: z.string().trim().toUpperCase().length(3).optional().nullable().or(z.literal("")),
  periodicity: z.enum(PERIODICITIES).optional(),
  is_taxable: z.boolean().optional(),
  in_cnps_base: z.boolean().optional(),
  in_gross: z.boolean().optional(),
  effective_on: dateStr,
  ends_on: dateStr,
  notes: text(1000),
});

const create = z.object({
  ...base,
  // The wizard submits the whole hire in one call: the person, their papers and
  // their standing pay lines. Doing it in three round-trips would leave an
  // employee half-created when the second one fails, which is precisely the
  // state the lifecycle enum exists to make visible rather than to produce.
  documents: z.array(documentBody).max(30).optional(),
  allowances: z.array(allowanceBody).max(30).optional(),
});
const update = z.object({ ...base, full_name: z.string().min(2).optional(), is_active: z.boolean().optional() });
const setActive = z.object({ is_active: z.boolean() });
const setStatus = z.object({
  status: z.enum(EMPLOYEE_STATUSES),
  terminated_on: dateStr,
  termination_reason: text(400),
});
// AI-facing: employee_id in the payload → list_employees picker.
const aiUpdate = update.extend({ employee_id: z.string().uuid() });
const aiSetActive = setActive.extend({ employee_id: z.string().uuid() });

// PATCH is a partial edit: requiring `label` and `amount` to change an end date
// would make the caller resend fields it was not touching, which is how a
// concurrent edit gets clobbered by a stale value.
const allowancePatch = allowanceBody.partial();

const schemas = {
  create, update, setActive, setStatus, updateMine, aiUpdate, aiSetActive,
  document: documentBody, allowance: allowanceBody, allowancePatch,
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
module.exports = {
  create: mw("create"), update: mw("update"), setActive: mw("setActive"),
  setStatus: mw("setStatus"), updateMine: mw("updateMine"),
  document: mw("document"), allowance: mw("allowance"), allowancePatch: mw("allowancePatch"),
  schemas, EMPLOYMENT_TYPES, CIVILITIES, GENDERS, MARITAL_STATUSES,
  PAYMENT_METHODS, EMPLOYEE_STATUSES, ALLOWANCE_KINDS, PERIODICITIES,
  NAME_CHANGE_STATUSES,
};
