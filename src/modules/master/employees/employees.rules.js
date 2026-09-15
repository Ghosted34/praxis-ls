/**
 * Employee master pure rules (MOD-02). No I/O — deterministic helpers the
 * service composes. Keeps CNPS risk-class defaults and bank-block shape in one
 * testable place (KB §9.1 work-injury categories).
 */
"use strict";
const { workSchedule } = require("@praxis/shared");

/**
 * CNPS work-injury (risk) class rate by employee category (KB §9.1).
 * Office staff ≈ 1.75%; drivers, warehouse and port/handling are higher-risk
 * (~2.5–5%). Returned as a decimal fraction (0.0175 = 1.75%). This is only a
 * *suggested default* when the record doesn't specify one — a tenant can always
 * override risk_class_rate per employee.
 */
const RISK_OFFICE = 0.0175;
const RISK_OPERATIONAL = 0.025;

function suggestRiskClass({ is_driver, department, employment_type } = {}) {
  if (is_driver) return RISK_OPERATIONAL;
  const hay = `${department || ""} ${employment_type || ""}`.toLowerCase();
  if (/warehouse|magasin|port|handling|manuten|logisti|fleet|driver|chauffeur/.test(hay)) {
    return RISK_OPERATIONAL;
  }
  return RISK_OFFICE;
}

/**
 * Normalise a bank block. Accepts a plain object of banking coordinates; drops
 * anything non-string and guarantees a JSON-serialisable object (schema stores
 * jsonb NOT NULL DEFAULT '{}'). Returns {} for empty/invalid input.
 *
 * ONLY the known banking fields are copied. A caller-supplied key must never
 * become a property write here (remote property injection): the schema's
 * jsonb column is free-form, but this module decides what a bank block may
 * contain, and an unknown key is dropped rather than written.
 */
const BANK_FIELDS = [
  "bank_name", "branch", "account_name", "account_number", "beneficiary_name",
  "iban", "swift", "swift_bic", "sort_code", "currency",
];

function normaliseBankBlock(block) {
  if (!block || typeof block !== "object" || Array.isArray(block)) return {};
  const out = {};
  for (const k of BANK_FIELDS) {
    const v = block[k];
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

/** Fields masked from roles without salary visibility (mirrors field_visibility 'employee.salary'). */
const SENSITIVE_FIELDS = ["base_salary", "bank_block"];

/** Return a copy with sensitive fields stripped, for callers that can't see salary. */
function redactSensitive(row) {
  if (!row) return row;
  const clone = { ...row };
  for (const f of SENSITIVE_FIELDS) delete clone[f];
  return clone;
}

/**
 * Property names that must never be written from caller-supplied input.
 *
 * `out[k] = v` with k = "__proto__" does not add a property: it invokes the
 * prototype setter, and `out` silently starts INHERITING whatever the caller
 * put there. Measured, not assumed — a body of
 * `{"__proto__": {"is_active": true, "base_salary": 99999999}}` produces an
 * object with no own keys whose `.is_active` reads true.
 *
 * Global `Object.prototype` is NOT affected, and today's callers are not
 * exploitable through it either: Zod strips unknown keys first, and both
 * `insertOne` (Object.keys) and the spread in `create` copy own properties
 * only, so nothing inherited reaches SQL. The guard is here because the helper
 * is general — a future reader using `in`, `for…in` or a destructuring default
 * WOULD see them — and because it costs one filter. Same stance
 * `normaliseBankBlock` takes with its allow-list.
 */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * `""` is what an HTML form sends for "I did not fill this in", and it is not
 * the same thing as a value. Left alone it becomes an empty string in the
 * column, which then prints as an empty string in a contract — "Né le  à " —
 * instead of being detectably absent. Every optional text field goes through
 * this on the way in.
 *
 * Only own string properties are touched: numbers, booleans, dates and the bank
 * block pass through untouched, and `null` stays `null`.
 */
function blankToNull(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  // `Object.fromEntries`, not `out[k] = …` (CodeQL, remote property injection).
  // fromEntries DEFINES each property rather than assigning it, so no setter is
  // invoked; the three names in UNSAFE_KEYS are dropped as well, so the result
  // cannot carry them even as own keys. See UNSAFE_KEYS for what the old form
  // actually did and why it was not exploitable here.
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([k]) => !UNSAFE_KEYS.has(k))
      .map(([k, v]) => [k, typeof v === "string" && v.trim() === "" ? null : v]),
  );
}

/**
 * A standing pay line, with the defaults its KIND implies.
 *
 * ── WHY THIS IS NOT JUST THE COLUMN DEFAULT ───────────────────────────────
 *
 * `employee_allowance.in_gross` defaults to true, which is right for a prime
 * and wrong for the one kind whose whole definition is that it is NOT paid in
 * cash. A company car is remuneration and it is taxed — so `is_taxable` and
 * `in_cnps_base` stay true — but nobody is handed 80,000 francs, and counting
 * it toward the gross makes the contract state a monthly figure the payslip can
 * never match.
 *
 * Caught by inserting one against a real database and watching a 650,000 gross
 * come back as 730,000. A per-kind default cannot be expressed as a column
 * DEFAULT, so it is applied here, where both the wizard's bulk create and the
 * single-allowance endpoint go through it.
 *
 * Only when the caller said NOTHING: an explicit `in_gross: true` on a benefit
 * in kind is a deliberate, unusual choice (a car allowance paid as cash), and
 * overriding it would make the field a lie.
 */
function withAllowanceDefaults(body = {}) {
  const out = { ...body };
  if (out.kind === "BENEFIT_IN_KIND" && out.in_gross === undefined) out.in_gross = false;
  return out;
}

/**
 * Keep the printed working-hours line in step with the grid it comes from.
 *
 * `work_schedule` (13775) is the week per day; `working_hours` is the sentence a
 * contract prints. They are the same fact twice, and two fields holding one
 * fact disagree by the second edit — so whenever a write carries a schedule,
 * the sentence is RE-DERIVED from it and whatever the caller sent for
 * `working_hours` is discarded. The form sends both (it renders the line as you
 * tick the days); the server decides which one is true.
 *
 * A write that carries no schedule is left entirely alone: every record that
 * predates 13775 has free text and no grid, and rewriting a term somebody
 * agreed to because an unrelated field was patched is not a tidy-up.
 *
 * Clearing the schedule (`work_schedule: null`) clears the derived line too —
 * otherwise the sentence outlives the grid it was rendered from and becomes a
 * claim with nothing behind it.
 */
function withDerivedWorkingHours(fields = {}) {
  if (!Object.prototype.hasOwnProperty.call(fields, "work_schedule")) return fields;
  const schedule = workSchedule.normalise(fields.work_schedule);
  return { ...fields, work_schedule: schedule, working_hours: schedule ? workSchedule.summarise(schedule) : null };
}

/** A copy of `obj` without `keys`. Named rather than done with a rest-destructure
 *  so the discarded keys do not become unused variables the linter has to be
 *  told to ignore — and so the call site says WHY they are being dropped. */
function omit(obj, keys) {
  if (!obj || typeof obj !== "object") return obj;
  const drop = new Set(keys);
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !drop.has(k)));
}

/* ── What a work contract actually needs ────────────────────────────────────
 *
 * This list is not a wish. Every entry is a fact printed in the body of a real
 * Cameroonian CDI (see 12763 for the paragraph), and a contract generated
 * without one of them has a visible hole where a legal identification should
 * be. It is stated once, here, so the wizard's progress meter, the 360's
 * readiness panel and the contract module all measure the same thing — three
 * separate lists would drift, and the one that drifts is always the one the
 * generator reads.
 *
 * `group` is the wizard step the field lives on, so "3 missing" can say WHERE.
 */
const CONTRACT_REQUIREMENTS = [
  // Step 1 — who this person is.
  { key: "full_name", label: "Full name", group: "identity", severity: "required" },
  { key: "civility", label: "Civility", group: "identity", severity: "required" },
  { key: "gender", label: "Gender", group: "identity", severity: "required" },
  { key: "date_of_birth", label: "Date of birth", group: "identity", severity: "required" },
  { key: "place_of_birth", label: "Place of birth", group: "identity", severity: "required" },
  { key: "father_name", label: "Father's name", group: "identity", severity: "required" },
  { key: "mother_name", label: "Mother's name", group: "identity", severity: "required" },
  { key: "nationality", label: "Nationality", group: "identity", severity: "required" },
  { key: "id_document_number", label: "ID document number", group: "identity", severity: "required" },
  { key: "id_document_issued_on", label: "ID issued on", group: "identity", severity: "required" },
  { key: "id_document_issued_at", label: "ID issued at", group: "identity", severity: "required" },
  { key: "residence_address", label: "Residence", group: "identity", severity: "required" },
  { key: "marital_status", label: "Marital status", group: "identity", severity: "recommended" },
  { key: "dependent_children", label: "Dependent children", group: "identity", severity: "recommended" },
  { key: "phone_mobile", label: "Mobile phone", group: "identity", severity: "recommended" },
  { key: "emergency_contact_phone", label: "Emergency contact", group: "identity", severity: "recommended" },

  // Step 2 — the engagement.
  { key: "entity_id", label: "Employer entity", group: "employment", severity: "required" },
  { key: "job_title", label: "Job title", group: "employment", severity: "required" },
  { key: "employment_type", label: "Contract type", group: "employment", severity: "required" },
  { key: "hired_on", label: "Start date", group: "employment", severity: "required" },
  { key: "staff_no", label: "Matricule", group: "employment", severity: "required" },
  { key: "base_salary", label: "Base salary", group: "employment", severity: "required" },
  { key: "place_of_work", label: "Place of work", group: "employment", severity: "required" },
  { key: "working_hours", label: "Working hours", group: "employment", severity: "required" },
  { key: "payment_method", label: "Payment method", group: "employment", severity: "required" },
  { key: "probation_months", label: "Probation (months)", group: "employment", severity: "recommended" },
  { key: "scope_id", label: "Department", group: "employment", severity: "recommended" },
  { key: "reports_to", label: "Line manager", group: "employment", severity: "recommended" },
  { key: "cnps_number", label: "CNPS number", group: "employment", severity: "recommended" },
  // Recommended, not required: a contract does not print the NIU, but the DIPE
  // return and the payslip's IRPP line both quote it, so a record without one
  // is a payroll problem waiting for the end of the month (13775).
  { key: "niu", label: "NIU (tax number)", group: "employment", severity: "recommended" },
  { key: "email", label: "Work email", group: "employment", severity: "recommended" },
];

/** The staff document a driver must hold. Code from 12764's registry seed,
 *  where it is already `requires_expiry` — a licence is the archetype of a
 *  paper that lapses. */
const DRIVER_LICENCE_CODE = "EMP_DRIVING_LICENCE";

/**
 * The columns a licence row has to carry before it counts as one.
 *
 * A driving licence is not satisfied by a row that merely exists. What makes it
 * a licence is the number on it and the window it is valid for — that is what a
 * gendarme asks for at a checkpoint and what the insurer asks for after an
 * incident. `issued_on` is the "from", `expires_on` the "till".
 */
const DRIVER_LICENCE_FIELDS = ["document_number", "issued_on", "expires_on"];

/**
 * Documents a complete staff file holds. Codes from 12764's registry seed.
 *
 * `when` names an employee column that has to be truthy for the entry to apply
 * at all, and `needs` the columns the document row itself must carry. Both
 * exist for the driving licence, and the licence is why they exist: it is
 * required OF DRIVERS ONLY — demanding one from an accountant would be a
 * permanent red mark on a complete file, which is how a readiness meter stops
 * being read — and a blank row against the code would otherwise satisfy it.
 */
const REQUIRED_DOCUMENT_CODES = [
  { code: "EMP_ID_CARD", label: "ID card / passport", severity: "required" },
  {
    code: DRIVER_LICENCE_CODE,
    label: "Driving licence (number and validity)",
    severity: "required",
    when: "is_driver",
    needs: DRIVER_LICENCE_FIELDS,
  },
  { code: "EMP_CV", label: "Curriculum vitae", severity: "recommended" },
  { code: "EMP_PHOTO", label: "Passport photograph", severity: "recommended" },
  { code: "EMP_BANK_RIB", label: "Bank RIB", severity: "recommended" },
];

/** Does this document row carry everything its requirement asked for? */
function documentSatisfies(doc, req) {
  if (!doc) return false;
  return (req.needs || []).every((f) => isPresent(doc[f]));
}

/**
 * The licence on file for this person, if there is a usable one.
 *
 * "Usable" is the same test the readiness meter applies, so the API's refusal
 * and the meter's red row can never disagree about what a licence is. Takes
 * anything document-shaped — rows read back from `employee_document`, or the
 * `documents[]` a create request is carrying, which do not exist yet.
 */
function findDriverLicence(documents = []) {
  const req = REQUIRED_DOCUMENT_CODES.find((d) => d.code === DRIVER_LICENCE_CODE);
  return (
    (documents || []).find(
      (d) =>
        d &&
        d.is_active !== false &&
        (d.document_type_code || d.code) === DRIVER_LICENCE_CODE &&
        documentSatisfies(d, req),
    ) || null
  );
}

/**
 * Why this person cannot be marked as a driver, or null when they can.
 *
 * ── WHY THIS ONE BLOCKS THE SAVE WHEN THE ID CARD DOES NOT ─────────────────
 *
 * 12764's rule is that a scan is a verification gate and not a creation gate:
 * refusing to record a CNI you are physically holding because the scanner is
 * down produces an incomplete register, which is worse than one with unscanned
 * rows. That rule is about BYTES, and it still stands here — the scan of the
 * licence is never required to save.
 *
 * The number and the validity window are a different thing. `is_driver` is not
 * a description, it is an assignment: it puts this person in the fleet dispatch
 * pool, where the next thing that happens is a vehicle being dispatched to
 * them. A dispatch to an unlicensed driver is not a paperwork gap, it is an
 * uninsured vehicle on the road with the company's name on it — so this is
 * refused at the point the box is ticked rather than counted as a gap somebody
 * may close later.
 *
 * It fires only where the flag is being SET. A record that already has the flag
 * and no licence predates the rule; editing that person's phone number must not
 * fail with a message about a licence, so `update` asks only when the patch
 * turns the flag on or resubmits it as on.
 */
function driverLicenceGap(employee = {}, documents = []) {
  if (!employee.is_driver) return null;
  if (findDriverLicence(documents)) return null;
  return {
    code: DRIVER_LICENCE_CODE,
    fields: DRIVER_LICENCE_FIELDS,
    message:
      "A driver needs a driving licence on file: its number, and the dates it is valid from and until.",
  };
}

/** A field counts as present when it holds something a contract could print. */
function isPresent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

/**
 * How close this record is to producing a contract without holes.
 *
 * Returns the missing entries rather than a bare percentage, because "78%
 * complete" tells a clerk to go hunting while "missing: place of birth,
 * mother's name" tells them what to type. The percentage is over the REQUIRED
 * set only — a recommended field that nobody filled must not sit at 94% forever
 * and train people to ignore the number.
 *
 * `dependent_children` counts as present at zero: "no children" is an answer.
 */
function contractReadiness(employee = {}, documents = []) {
  const held = (documents || []).filter((d) => d && d.is_active !== false);
  // First row per code wins; `listDocuments` orders newest first within a type.
  const byCode = new Map();
  for (const d of held) {
    const code = d.document_type_code || d.code;
    if (code && !byCode.has(code)) byCode.set(code, d);
  }
  // A requirement gated on a column the record does not have is not a gap.
  // `is_driver` is false for most of the payroll, and a licence counted against
  // all of them would put every complete file permanently short of 100%.
  const docReqs = REQUIRED_DOCUMENT_CODES.filter((d) => !d.when || !!employee[d.when]);
  const missing = [];
  for (const req of CONTRACT_REQUIREMENTS) {
    const raw = employee[req.key];
    const present = req.key === "dependent_children" ? raw !== null && raw !== undefined : isPresent(raw);
    if (!present) missing.push({ ...req, kind: "field" });
  }
  for (const doc of docReqs) {
    // With no `needs`, `documentSatisfies` reduces to "a row for this code
    // exists", which is what every other entry has always meant.
    if (!documentSatisfies(byCode.get(doc.code) || null, doc)) {
      missing.push({ key: doc.code, label: doc.label, group: "documents", severity: doc.severity, kind: "document" });
    }
  }
  const total = CONTRACT_REQUIREMENTS.filter((r) => r.severity === "required").length
    + docReqs.filter((d) => d.severity === "required").length;
  const missingRequired = missing.filter((m) => m.severity === "required");
  return {
    ready: missingRequired.length === 0,
    complete: total - missingRequired.length,
    total,
    percent: total === 0 ? 100 : Math.round(((total - missingRequired.length) / total) * 100),
    missing,
    missing_required: missingRequired,
  };
}

module.exports = {
  suggestRiskClass, normaliseBankBlock, redactSensitive, SENSITIVE_FIELDS,
  RISK_OFFICE, RISK_OPERATIONAL, blankToNull, isPresent, omit, withAllowanceDefaults,
  UNSAFE_KEYS, withDerivedWorkingHours,
  CONTRACT_REQUIREMENTS, REQUIRED_DOCUMENT_CODES, contractReadiness,
  DRIVER_LICENCE_CODE, DRIVER_LICENCE_FIELDS, documentSatisfies,
  findDriverLicence, driverLicenceGap,
};
