/**
 * Employee master (MOD-02) — the HR/payroll/fleet foundation record
 * (PRD §MOD-02, KB §9). Full lifecycle over the `employee` registry: create,
 * edit, activate/deactivate, reference-guarded delete, plus the read shapes the
 * rest of Phase 3 consumes (roster, drivers) and `assertActive` — the guard
 * every referencing module (payroll lines, dispatch, contracts) calls before it
 * binds an employee. SQL lives in the repo; rules in employees.rules.
 */
"use strict";
const repo = require("./employees.repo");
const events = require("./employees.events");
const {
  suggestRiskClass, normaliseBankBlock, blankToNull, contractReadiness, omit,
  withAllowanceDefaults, withDerivedWorkingHours,
  CONTRACT_REQUIREMENTS, REQUIRED_DOCUMENT_CODES, driverLicenceGap,
} = require("./employees.rules");
const vault = require("../../vault/document_vault/document_vault.service");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "employee:" + id;

/**
 * A reporting line may not loop (0493). The DB rejects self-management with a
 * CHECK; A→B→A needs a walk, and expressing that declaratively would mean a
 * trigger firing on every employee write for a rule that only matters when
 * `reports_to` changes.
 *
 * The message names the manager, because "cycle detected" tells an HR clerk
 * nothing about which pick was wrong.
 */
async function assertNoReportingCycle(client, employeeId, managerId) {
  if (!managerId) return;
  // Creation passes a null employeeId: a row that does not exist yet cannot be
  // anywhere in the chain above its own manager, so the only check worth making
  // is that the manager exists at all.
  if (!employeeId) {
    const mgr = await repo.getBare(client, managerId);
    if (!mgr) throw new AppError("NOT_FOUND", "That line manager no longer exists", 422);
    return;
  }
  if (managerId === employeeId) {
    throw new AppError("REPORTING_CYCLE", "Somebody can't report to themselves", 422);
  }
  if (await repo.wouldCycle(client, employeeId, managerId)) {
    const mgr = await repo.getBare(client, managerId);
    throw new AppError(
      "REPORTING_CYCLE",
      `${mgr && mgr.full_name ? mgr.full_name : "That person"} already reports to this employee, directly or through someone else — the line would loop`,
      422,
    );
  }
}

/**
 * Refuse to put somebody in the dispatch pool without a licence on file.
 *
 * The reasoning is in `driverLicenceGap`; this is the throw. The 422 names
 * `is_driver` in `fields` because that is the control the operator ticked, and
 * a rejection that names a field the form does not show is a rejection nobody
 * can act on — the wizard's `stepForRejection` reads exactly this to land them
 * back on the step that holds the checkbox.
 */
function assertDriverLicence(employee, documents) {
  const gap = driverLicenceGap(employee, documents);
  if (!gap) return;
  throw new AppError("DRIVER_LICENCE_REQUIRED", gap.message, 422, {
    is_driver: [gap.message],
  });
}

/**
 * Hire somebody.
 *
 * ── ONE TRANSACTION, THREE TABLES ──────────────────────────────────────────
 *
 * The wizard collects the person, their papers and their standing pay lines and
 * submits them together, and they are written together. Splitting it into three
 * calls would mean a failure on the second leaves an employee with no documents
 * and no way for the UI to know that is what happened — a half-hire that looks
 * like a whole one. The `documents` and `allowances` arrays are optional: an
 * employee created by the AI tool, or by a caller that predates the wizard,
 * still writes exactly one row and behaves exactly as it did.
 *
 * ── THE MATRICULE IS ALLOCATED HERE, INSIDE THE TRANSACTION ────────────────
 *
 * So a rollback returns the number. Allocating before BEGIN would burn a
 * matricule every time a validation error came back from Postgres, and a staff
 * series with holes in it invites the question "who was SLAS-014?".
 */
async function create(client, { data, slug, actor = {} }) {
  const { documents = [], allowances = [], ...fields } = data;
  await client.query("BEGIN");
  try {
    const bank_block = normaliseBankBlock(fields.bank_block);
    const risk_class_rate =
      fields.risk_class_rate !== undefined && fields.risk_class_rate !== null
        ? fields.risk_class_rate
        : suggestRiskClass(fields);
    // Allocated, never typed. `staff_no` is not in the create schema, so an HTTP
    // caller cannot supply one — Zod strips it before this runs. The fallback is
    // for the service's own callers (a seed, a data-import script) that legitimately
    // carry an existing number; going through the sequence is the only path a
    // person has.
    const staff_no = fields.staff_no || (await repo.allocateStaffNo(client, { entity_id: fields.entity_id || null }));
    // The line manager is checked before the insert, not after: a cycle caught
    // afterwards would mean rolling back a hire that was otherwise fine, and the
    // clerk would see a failure whose cause was three fields further up.
    if (fields.reports_to) await assertNoReportingCycle(client, null, fields.reports_to);
    // Before the insert, for the same reason the cycle check is: a hire refused
    // afterwards is a rollback the clerk sees as a failure whose cause is on
    // another step. The licence rides in on `documents[]`, which the wizard
    // already sends in this one call.
    assertDriverLicence(fields, documents);
    const row = await repo.insert(client, {
      // `withDerivedWorkingHours` re-renders the printed hours line from the
      // grid, so the contract's sentence cannot disagree with the days HR
      // ticked. AFTER blankToNull: an empty string for `work_schedule` is "not
      // filled in", and normalising it before it has become null would read it
      // as a schedule that could not be parsed.
      ...withDerivedWorkingHours(blankToNull(fields)), bank_block, risk_class_rate, staff_no,
    });
    for (const d of documents) await addDocumentRow(client, { employeeId: row.employee_id, body: d, slug, actor });
    for (const a of allowances) await addAllowanceRow(client, { employeeId: row.employee_id, body: a, actor });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.employee_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.employee_id), after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function update(client, { id, patch, actor = {} }) {
  const before = await repo.getBare(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Employee not found", 404);
  // `documents` / `allowances` are creation-time conveniences; editing them is
  // done through their own endpoints, where one row can be changed without
  // resubmitting the rest. Dropping them here rather than letting the update
  // builder reject an unknown column keeps the error the caller sees honest.
  const fields = withDerivedWorkingHours(blankToNull(omit(patch, ["documents", "allowances"])));
  if (fields.bank_block !== undefined) fields.bank_block = normaliseBankBlock(fields.bank_block);
  // Asked only when this patch SAYS `is_driver: true`. A patch that does not
  // mention the flag leaves a legacy driver editable — their phone number must
  // not fail with a message about a licence — while the edit form, which
  // resubmits the whole draft, is checked on every save. The licence itself is
  // written through the documents endpoint before this call (a licence with no
  // flag is harmless; a flag with no licence is the thing being prevented), so
  // by now it is on file if the operator supplied one.
  if (fields.is_driver === true) {
    assertDriverLicence(fields, await repo.listDocuments(client, id));
  }
  // Only when the line actually changes — a no-op save shouldn't pay for a walk.
  if (fields.reports_to !== undefined && fields.reports_to !== before.reports_to) {
    await assertNoReportingCycle(client, id, fields.reports_to);
  }
  const row = await repo.update(client, id, fields);
  await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/** Activate / deactivate (soft state). Deactivation keeps history intact. */
async function setActive(client, { id, is_active, actor = {} }) {
  const before = await repo.getBare(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Employee not found", 404);
  if (before.is_active === is_active) return before; // idempotent
  const row = await repo.update(client, id, { is_active });
  const evt = is_active ? events.REACTIVATED : events.DEACTIVATED;
  await emitEvent(client, { eventTypeKey: evt, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: evt, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/**
 * Delete. An employee referenced anywhere (payroll, contracts, dispatch, a user
 * account…) is never hard-deleted — history must survive. In that case we
 * deactivate and report why; only an unreferenced record is physically removed.
 */
async function remove(client, { id, actor = {} }) {
  const before = await repo.getBare(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Employee not found", 404);
  const refs = await repo.countReferences(client, id);
  if (refs.total > 0) {
    const row = await setActive(client, { id, is_active: false, actor });
    return { deleted: false, deactivated: true, references: refs, employee: row };
  }
  await client.query("DELETE FROM employee WHERE employee_id = $1", [id]);
  await emitEvent(client, { eventTypeKey: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), before });
  return { deleted: true, deactivated: false, references: refs };
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
const roster = (client, q = {}) => repo.roster(client, q);
const drivers = (client, q = {}) => repo.drivers(client, q);
const references = (client, id) => repo.countReferences(client, id);

/**
 * Integration guard for other modules: resolve an employee that must exist and
 * be active before it can be bound (payroll line, dispatch, contract). Throws a
 * 404/422 the caller can surface. This is the single end-to-end contract point.
 */
async function assertActive(client, id) {
  const e = await repo.getBare(client, id);
  if (!e) throw new AppError("EMPLOYEE_NOT_FOUND", "Employee not found", 404);
  if (!e.is_active) throw new AppError("EMPLOYEE_INACTIVE", "Employee is deactivated", 422);
  return e;
}

/* ── The reporting line (0493) ──────────────────────────────────────────────
 * `role.is_line_manager` is seeded as "approves for own team" and, until 0493,
 * nothing could resolve a team. These are what that needs — and what escalation
 * (audit W13) will read when it lands.
 */
const directReports = (client, id) => repo.directReports(client, id);
const team = (client, id, opts) => repo.teamOf(client, id, opts);
/** Nearest-first chain of managers above someone — the escalation path. */
const managerChain = (client, id) => repo.managerChain(client, id);

/* ── The staff file (12764) ──────────────────────────────────────────────────
 *
 * A scan is a verification gate, not a creation gate. Every path below records
 * the row whether or not a file came with it, and says what is outstanding
 * instead of refusing the row. See 12764 for why.
 */

/** Vault the scan if one was sent, then write the document row. Shared by the
 *  wizard's bulk create and the single-document endpoint, so the two cannot
 *  diverge on what a document means. */
async function addDocumentRow(client, { employeeId, body, slug, actor = {} }) {
  const {
    file_data_url: dataUrl, file_name: fileName, document_type_code: code,
    ...fields
  } = body;
  let document_type_id = fields.document_type_id || null;
  if (!document_type_id && code) {
    document_type_id = await repo.documentTypeByCode(client, code);
    if (!document_type_id) {
      throw new AppError("UNKNOWN_DOCUMENT_TYPE", `No staff document type called ${code}`, 422);
    }
  }
  let vault_id = fields.vault_id || null;
  if (!vault_id && dataUrl) {
    // `entityRef` ties the vaulted bytes back to the person, so a vault audit
    // can answer whose ID card this is without joining through employee_document.
    const doc = await vault.createDocument(client, {
      entityRef: ref(employeeId), docType: code || "EMPLOYEE_DOCUMENT",
      dataUrl, originalName: fileName || null, slug, actor,
    });
    vault_id = doc.doc_id;
  }
  const row = await repo.insertDocument(client, {
    ...blankToNull(fields),
    employee_id: employeeId,
    document_type_id,
    vault_id,
    // A row that arrived with its scan is SCANNED; one recorded from paper stays
    // PENDING with whatever physical_ref the clerk gave. Verification is a
    // separate, human decision either way.
    scan_status: vault_id ? "SCANNED" : "PENDING",
    // Through `resolveActorId`, not `actor.user_id` (DATA 2.4). `created_by`
    // REFERENCES app_user, identity lives in the LIVE schema, and this write may
    // land in SANDBOX — where that user does not exist and Postgres answers
    // 23503, failing the whole hire. Losing an attribution is a far smaller harm
    // than losing the document.
    created_by: await resolveActorId(client, actor.user_id),
  });
  return row;
}

async function addDocument(client, { id, body, slug, actor = {} }) {
  const employee = await repo.getBare(client, id);
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found", 404);
  const row = await addDocumentRow(client, { employeeId: id, body, slug, actor });
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), after: { document_id: row.document_id, document_type_id: row.document_type_id } });
  return row;
}

const listDocuments = (client, id) => repo.listDocuments(client, id);
const documentTypes = (client) => repo.documentTypes(client);

async function updateDocument(client, { id, documentId, patch, actor = {} }) {
  const before = await repo.getDocument(client, documentId);
  if (!before || before.employee_id !== id) throw new AppError("NOT_FOUND", "Document not found", 404);
  // Re-vaulting a scan is `POST /documents` with a new row, not an edit: a staff
  // file records what was held and when, and silently swapping the bytes behind
  // an existing row would erase that. The upload keys are dropped here.
  const fields = omit(patch, ["file_data_url", "file_name", "document_type_code"]);
  const row = await repo.updateDocument(client, documentId, blankToNull(fields));
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/** Soft-delete: a staff file is evidence, so the row is deactivated, not erased. */
async function removeDocument(client, { id, documentId, actor = {} }) {
  const before = await repo.getDocument(client, documentId);
  if (!before || before.employee_id !== id) throw new AppError("NOT_FOUND", "Document not found", 404);
  const row = await repo.archiveDocument(client, documentId);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/* ── Standing pay lines (12765) ─────────────────────────────────────────────*/

async function addAllowanceRow(client, { employeeId, body, actor = {} }) {
  return repo.insertAllowance(client, {
    ...blankToNull(withAllowanceDefaults(body)),
    employee_id: employeeId,
    // Resolved, not passed through — same reason as the document row above.
    created_by: await resolveActorId(client, actor.user_id),
  });
}

async function addAllowance(client, { id, body, actor = {} }) {
  const employee = await repo.getBare(client, id);
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found", 404);
  const row = await addAllowanceRow(client, { employeeId: id, body, actor });
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), after: row });
  return row;
}

const listAllowances = (client, id, opts) => repo.listAllowances(client, id, opts);

async function updateAllowance(client, { id, allowanceId, patch, actor = {} }) {
  const before = await repo.getAllowance(client, allowanceId);
  if (!before || before.employee_id !== id) throw new AppError("NOT_FOUND", "Allowance not found", 404);
  const row = await repo.updateAllowance(client, allowanceId, blankToNull(patch));
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

async function removeAllowance(client, { id, allowanceId, actor = {} }) {
  const before = await repo.getAllowance(client, allowanceId);
  if (!before || before.employee_id !== id) throw new AppError("NOT_FOUND", "Allowance not found", 404);
  await repo.deleteAllowance(client, allowanceId);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before });
  return { deleted: true };
}

/**
 * What this person is paid, decomposed the way the contract states it.
 *
 * Article 3 of a contract is a table, not a number, and it has to add up: base
 * + the live cash allowances = the gross the document prints. Computing it here
 * rather than in the contract module means the payslip, the offer letter and
 * the renewal all quote the same figure.
 *
 * Benefits in kind are returned but excluded from the total (`in_gross`): they
 * are remuneration and they are taxed, but nobody is handed them in cash, and a
 * gross that includes a company car is a gross that does not match the payslip.
 */
async function pay(client, id, { on = null } = {}) {
  const employee = await repo.getBare(client, id);
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found", 404);
  const lines = await repo.listAllowances(client, id, { on });
  const base = Number(employee.base_salary || 0);
  const cash = lines.filter((l) => l.in_gross && l.kind !== "DEDUCTION" && l.periodicity === "MONTHLY");
  const additions = cash.reduce((sum, l) => sum + Number(l.amount || 0), 0);
  return {
    base_salary: base,
    currency: employee.salary_currency || null,
    lines,
    monthly_gross: base + additions,
  };
}

/* ── Readiness and the account (the two questions the 360 opens with) ────────*/

/**
 * Can a contract be generated from this record yet, and if not, what is missing?
 *
 * This is the number the wizard's meter shows and the panel the 360 leads with.
 * It reads the SAME list the contract module will read (employees.rules), so a
 * record that says it is ready is a record the generator will accept.
 */
async function readiness(client, id) {
  const employee = await repo.get(client, id);
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found", 404);
  const documents = await repo.listDocuments(client, id);
  return contractReadiness(employee, documents);
}

/**
 * The requirement list itself, so the creation wizard can show a LIVE readiness
 * count against a draft that has not been saved yet.
 *
 * Served rather than duplicated in the browser bundle: a second copy of this
 * list is a second definition of "contract-ready", and the two would disagree
 * the first time either is edited — with the UI cheerfully reporting 100% on a
 * record the generator then rejects.
 */
const readinessRequirements = () => ({
  fields: CONTRACT_REQUIREMENTS,
  documents: REQUIRED_DOCUMENT_CODES,
});

/** The login(s) this employee can sign in with — the provisioning affordance's state. */
async function account(client, id) {
  const employee = await repo.getBare(client, id);
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found", 404);
  const accounts = await repo.accountsFor(client, id);
  return {
    employee_id: id,
    provisioned: accounts.length > 0,
    accounts,
    // What the Users screen should be pre-filled with when nobody has been
    // provisioned yet. Resolved here, not in the browser, so the deep link
    // carries an id and the target screen reads the record itself — a prefill
    // passed through a URL is a prefill anybody can rewrite.
    suggested: accounts.length
      ? null
      : {
        full_name: employee.full_name || "",
        email: employee.email || employee.personal_email || "",
        employee_id: id,
      },
  };
}

/**
 * Move an employee through the lifecycle (12763).
 *
 * Separate from `update` because it is an event, not a field edit: it emits a
 * distinct audit action and, for a termination, records why and when. `setActive`
 * stays as it was — the boolean and the enum are reconciled by the DB trigger,
 * so an older caller flipping `is_active` still lands in a coherent state.
 */
async function setStatus(client, { id, status, terminated_on = null, termination_reason = null, actor = {} }) {
  const before = await repo.getBare(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Employee not found", 404);
  if (before.status === status) return before;
  const fields = { status };
  if (status === "TERMINATED") {
    fields.terminated_on = terminated_on || new Date().toISOString().slice(0, 10);
    fields.termination_reason = termination_reason || null;
  } else {
    // Re-hiring somebody clears the leaving date rather than leaving a
    // termination on the record of a person who is back at their desk.
    fields.terminated_on = null;
    fields.termination_reason = null;
  }
  const row = await repo.update(client, id, fields);
  const evt = status === "ACTIVE" ? events.REACTIVATED : status === "TERMINATED" ? events.ARCHIVED : events.DEACTIVATED;
  await emitEvent(client, { eventTypeKey: evt, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: evt, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

module.exports = {
  create, update, setActive, setStatus, remove, get, list, roster, drivers, references, assertActive,
  directReports, team, managerChain, assertNoReportingCycle,
  addDocument, listDocuments, documentTypes, updateDocument, removeDocument,
  addAllowance, listAllowances, updateAllowance, removeAllowance, pay,
  readiness, readinessRequirements, account,
};
