/**
 * Partnership request (MOD-25) — the partnership / vendor intake desk, and the
 * bridge from an approved vendor to the supplier register (F10,
 * doc/SALES_CRM_FEATURES.md).
 *
 * WHAT THIS LAYER IS RESPONSIBLE FOR, AND WHY EACH PIECE IS HERE.
 *
 * 1. THE DECISION IS A TRANSITION, NOT A COLUMN WRITE. The legacy's update.php
 *    takes `{id, status, internal_notes}` and writes whatever status it is
 *    given, with no guard, no reason, no record of who decided. Approve and
 *    reject are separate operations here: approve is reachable only from
 *    IN_REVIEW, reject demands a reason (the database enforces it too), and
 *    both stamp reviewed_at / reviewed_by_user_id.
 *
 * 2. APPROVING A VENDOR CREATES THE SUPPLIER — IN THE SAME TRANSACTION. The
 *    legacy prints "This module captures intake only... Approved vendors must
 *    be manually onboarded in the Supplier Master Registry", which is a
 *    limitation described as a control. The real control already exists in
 *    src/modules/master/supplier_master: a supplier is born DRAFT, gets no
 *    auxiliary accounting account until activation, and only the approve
 *    permission can verify it. So the row is created here and the gate stays
 *    where it is. Re-typing the company name into a second screen was never the
 *    safeguard; it was the data-entry error.
 *
 *    The supplier is written through supplier_master's REPO, not its service —
 *    exactly as quote_request does for opportunity, and for the same reason:
 *    supplier_master.service.create opens and commits its own transaction, so
 *    calling it here would commit the supplier before this function's own
 *    write, and a failure afterwards would strand a supplier no application
 *    points at. The events and audit rows that service would have emitted are
 *    emitted here under the same keys, so nothing downstream loses a record.
 *
 * 3. TWICE APPROVED IS STILL ONE SUPPLIER. Three separate defences, because
 *    this is the one irreversible side effect in the module: the request is
 *    re-read and refused if it already carries a supplier_id; an existing
 *    supplier with the same normalised name is REUSED rather than duplicated;
 *    and ux_partnership_request_supplier makes the first two true under
 *    concurrency instead of merely likely.
 *
 * 4. AN UPLOAD THAT FAILS LEAVES NOTHING BEHIND. The corporate profile goes
 *    into the vault inside the transaction that links it, and the stored object
 *    is deleted when that transaction rolls back — object storage has no
 *    transaction to join, so the cleanup is explicit.
 */
"use strict";
const repo = require("./partnership_request.repo");
const events = require("./partnership_request.events");
const rules = require("./partnership_request.rules");
const supplierRepo = require("../../master/supplier_master/supplier_master.repo");
const supplierEvents = require("../../master/supplier_master/supplier_master.events");
const partyWrite = require("../../master/_shared/party-write.service");
const masterConfig = require("../../master/master_config/master_config.service");
const numbering = require("../../../services/documents/numbering.service");
const vault = require("../../vault/document_vault/document_vault.service");
const storage = require("../../../services/storage.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

const ref = (id) => "partnership_request:" + id;

/** A company profile: a PDF prospectus, or a photographed one. */
const PROFILE_MAX_BYTES = 10 * 1024 * 1024;
const PROFILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"];

/** Rows a CSV export will stream before it tells the caller it truncated. */
const EXPORT_CAP = 10000;

/* ─── intake ──────────────────────────────────────────────────────────────── */

async function create(client, { data, actor = {} }) {
  if (!data.company_name) {
    throw new AppError("VALIDATION_ERROR", "company_name is required", 422,
      { company_name: ["required"] });
  }
  await client.query("BEGIN");
  try {
    const row = await repo.insert(client, data);
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.partnership_request_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.partnership_request_id), after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Edit. Applicant fields are frozen once the application is APPROVED — the row
 * is then the evidence behind a supplier that exists, and editing the company
 * name after the fact makes the two disagree. Internal notes stay writable in
 * every state: due diligence does not stop when the decision is made.
 */
async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Partnership request not found", 404);
  const editable = rules.isDecided(before.status) ? ["internal_notes"] : repo.WRITABLE;
  const attempted = Object.keys(patch).filter((k) => repo.WRITABLE.includes(k));
  const refused = attempted.filter((k) => !editable.includes(k));
  if (refused.length) {
    throw new AppError("LOCKED",
      `An ${before.status} application cannot be edited (${refused.join(", ")}) — only internal notes.`, 422);
  }
  const fields = repo.shape(Object.fromEntries(attempted.map((k) => [k, patch[k]])));
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/**
 * Move through the lifecycle. APPROVED is NOT reachable here — approving has a
 * side effect on the supplier register and its own entry point below, so a
 * generic transition endpoint must not be a second, unguarded way in.
 */
async function transition(client, { id, to, reason = null, notes = undefined, actor = {} }) {
  if (to === "APPROVED") {
    throw new AppError("USE_APPROVE", "Approve through the approve action — it decides the supplier side too.", 422);
  }
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Partnership request not found", 404);
  rules.assertTransition(before.status, to);

  const fields = { status: to };
  if (notes !== undefined) fields.internal_notes = notes;
  if (to === "REJECTED") {
    const why = String(reason || "").trim();
    if (!why) {
      throw new AppError("VALIDATION_ERROR", "A rejection needs a reason — it is what the next reviewer reads.", 422,
        { reason: ["required when rejecting"] });
    }
    fields.decision_reason = why;
    fields.reviewed_at = new Date();
    fields.reviewed_by_user_id = actor.user_id || null;
  }
  if (to === "IN_REVIEW" && before.status === "REJECTED") {
    // Re-application. The previous decision_reason stays on the audit trail;
    // clearing the column is what lets the CHECK hold if this is rejected again
    // for a different reason.
    fields.decision_reason = null;
    fields.reviewed_at = null;
    fields.reviewed_by_user_id = null;
  }

  const row = await repo.update(client, id, fields);
  const key = to === "REJECTED" ? events.REJECTED : events.transition(to);
  await emitEvent(client, { eventTypeKey: key, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: key, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/* ─── approval, and the supplier it may create ────────────────────────────── */

/**
 * Which corporate entity the supplier belongs to.
 *
 * Order: what the approver said → the tenant's only active entity → a 422
 * naming the field. Never "the oldest": the entity decides which counter issues
 * the supplier's reference and whose books it lands in, and guessing files a
 * payable party under the wrong company. The same rule the lead and intake
 * registers already follow.
 */
async function resolveEntityId(client, supplier = {}) {
  if (supplier.entity_id) return supplier.entity_id;
  const fallback = await repo.defaultEntityId(client);
  if (fallback) return fallback;
  throw new AppError("ENTITY_REQUIRED",
    "This tenant has more than one corporate entity — say which one the supplier belongs to", 422,
    { entity_id: ["required when the tenant has several corporate entities"] });
}

/**
 * Create (or find) the DRAFT supplier for an approved application. Runs inside
 * the caller's transaction — it opens none of its own.
 */
async function draftSupplierFor(client, { request, supplier = {}, actor = {} }) {
  const name = supplier.name || request.company_name;
  if (!name) {
    throw new AppError("VALIDATION_ERROR", "The application has no company name to register a supplier under", 422,
      { "supplier.name": ["required"] });
  }
  const nameNorm = partyWrite.normalizeName({ name, legal_name: supplier.legal_name });

  // Already a supplier? Link, do not duplicate. F10's definition of done in one
  // query — and the reason the register can be re-approved after a re-
  // application without growing a second payable party.
  const existing = await repo.findSupplierByNameNorm(client, nameNorm);
  if (existing) return { supplier: existing, reused: true };

  const entityId = await resolveEntityId(client, supplier);
  const registrations = supplier.registrations || [];
  const masterData = {
    entity_id: entityId,
    name,
    legal_name: supplier.legal_name || name,
    // NOT `|| request.country_of_origin`. That column is free text on an
    // applicant form — "Cameroon", "cameroun", "CM" all arrive — and
    // supplier_master.country_code is char(2) with an FK-shaped meaning. A
    // two-letter value is taken as the code it obviously is; anything longer is
    // left null for the approver to set, because guessing "Cameroon" -> "CA" is
    // a silent wrong answer and a rejected INSERT is a loud one nobody wanted.
    country_code: supplier.country_code
      || (String(request.country_of_origin || "").trim().length === 2
        ? String(request.country_of_origin).trim().toUpperCase()
        : null),
    email: supplier.email || request.email || null,
    // Not defaulted from proposal_type. `supplier_type` is a tenant-owned
    // registry (0511 seeds its codes); inventing "AGENT" here would write a
    // classification this tenant may not use. The approver picks one, or the
    // supplier stays untyped until whoever verifies it says what it is.
    ...(supplier.supplier_type ? { supplier_type: supplier.supplier_type } : {}),
    ...(supplier.supplier_type_id ? { supplier_type_id: supplier.supplier_type_id } : {}),
    website: supplier.website || request.website || null,
    // What the register should say about where this record came from, for
    // whoever picks it up to verify. The partnership request itself is
    // reachable by filtering the register on this supplier's id.
    notes: supplier.notes
      || `Created from partnership application ${request.partnership_request_id} (${request.proposal_type}).`,
    ...(supplier.address ? { address: supplier.address } : {}),
    ...(supplier.city ? { city: supplier.city } : {}),
  };
  partyWrite.validateRegistrations({ registrations, country: masterData.country_code, kind: "supplier", category: null });
  Object.assign(masterData, partyWrite.niuRccmMirror(registrations), { name_norm: nameNorm });

  // The tenant's own field policy, the same gate supplier_master.create runs.
  // Bypassing it "because this is only a draft" is how a register fills with
  // rows Finance cannot complete — the approver is told which fields to supply
  // and passes them in the `supplier` block, exactly as the lead convert drawer
  // does for a client.
  await masterConfig.enforceRequired(client, "SUPPLIER", masterData);

  const { number } = await numbering.allocate(client, {
    moduleKey: supplierEvents.MODULE,
    entityId,
    date: new Date().toISOString().slice(0, 10),
  });

  const row = await supplierRepo.insert(client, {
    ...masterData,
    ref: number,
    // DRAFT is the whole point: nothing is payable and no purchase order can
    // draw on it until somebody holding MOD-04 approve verifies it.
    registration_status: "DRAFT",
  });
  await partyWrite.writeChildren(client, {
    kind: "supplier",
    partyId: row.supplier_id,
    registrations,
    primary_contact: (supplier.primary_contact
      || (request.contact_name
        ? { name: request.contact_name, email: request.email || undefined, phone: request.contact_phone || undefined, title: request.contact_title || undefined }
        : undefined)),
    primary_address: supplier.primary_address,
  });
  await emitEvent(client, { eventTypeKey: supplierEvents.CREATED, moduleKey: supplierEvents.MODULE, entityRef: "supplier:" + row.supplier_id, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: supplierEvents.CREATED, moduleKey: supplierEvents.MODULE, entityRef: "supplier:" + row.supplier_id, after: row });
  return { supplier: row, reused: false };
}

/**
 * Approve an application.
 *
 * A VENDOR_REGISTRATION always produces a supplier. An AGENCY_PARTNERSHIP does
 * so only when the approver asks (`create_supplier: true`) — an approved
 * forwarding agent is sometimes a party we are invoiced by and sometimes one we
 * only send work to, and nothing on the application form distinguishes them, so
 * the person deciding decides. Default: no.
 */
async function approve(client, { id, create_supplier = false, supplier = {}, notes = undefined, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Partnership request not found", 404);
  if (before.supplier_id) {
    throw new AppError("ALREADY_APPROVED", "This application already has a supplier", 422);
  }
  rules.assertTransition(before.status, "APPROVED");
  const wantsSupplier = rules.suppliersFor(before, create_supplier);

  await client.query("BEGIN");
  try {
    let supplierRow = null;
    let reused = false;
    if (wantsSupplier) {
      const out = await draftSupplierFor(client, { request: before, supplier, actor });
      supplierRow = out.supplier;
      reused = out.reused;
      await emitEvent(client, { eventTypeKey: events.SUPPLIER_DRAFTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    }

    const fields = {
      status: "APPROVED",
      reviewed_at: new Date(),
      reviewed_by_user_id: actor.user_id || null,
      supplier_id: supplierRow ? supplierRow.supplier_id : null,
    };
    if (notes !== undefined) fields.internal_notes = notes;
    const row = await repo.update(client, id, fields);

    await emitEvent(client, { eventTypeKey: events.APPROVED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.APPROVED, moduleKey: events.MODULE, entityRef: ref(id), before, after: { status: "APPROVED", supplier_id: fields.supplier_id, supplier_reused: reused } });
    await client.query("COMMIT");
    return { partnership_request: row, supplier: supplierRow, supplier_reused: reused };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Reject, with the reason the database also insists on. */
const reject = (client, { id, reason, notes, actor }) =>
  transition(client, { id, to: "REJECTED", reason, notes, actor });

/* ─── the corporate profile document ──────────────────────────────────────── */

/**
 * Upload (or replace) the applicant's corporate profile.
 *
 * `sniff: true` — this arrives from a stranger through the public form in F13,
 * so a .exe renamed .pdf is refused on its bytes rather than on its name. The
 * previous document is ARCHIVED, never deleted: it is what the applicant
 * actually sent, and the vault's contract is retention.
 */
async function uploadProfile(client, { id, dataUrl, filename = null, slug, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Partnership request not found", 404);
  if (rules.isDecided(before.status)) {
    throw new AppError("LOCKED", "An APPROVED application cannot take a new profile document", 422);
  }

  let storedPath = null;
  await client.query("BEGIN");
  try {
    const doc = await vault.createDocument(client, {
      dataUrl,
      docType: "PARTNERSHIP_PROFILE",
      entityRef: ref(id),
      originalName: filename,
      maxBytes: PROFILE_MAX_BYTES,
      allowedTypes: PROFILE_TYPES,
      sniff: true,
      slug,
      actor,
    });
    storedPath = doc.storage_path;
    if (before.corporate_profile_vault_id) {
      await vault.archiveDocument(client, { id: before.corporate_profile_vault_id, actor });
    }
    const row = await repo.update(client, id, { corporate_profile_vault_id: doc.doc_id });
    await emitEvent(client, { eventTypeKey: events.DOCUMENT_ATTACHED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.DOCUMENT_ATTACHED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
    await client.query("COMMIT");
    return { partnership_request: row, vault_id: doc.doc_id, original_name: doc.original_name, content_hash: doc.content_hash };
  } catch (err) {
    await client.query("ROLLBACK");
    if (storedPath) {
      try { await storage.delete(storedPath); } catch (cleanupErr) {
        logger.error({ err: cleanupErr, storedPath, partnershipRequestId: id },
          "[partnership-request] profile upload rolled back but its stored object could not be deleted");
      }
    }
    throw err;
  }
}

/* ─── reads ───────────────────────────────────────────────────────────────── */

const get = (client, id) => repo.get(client, id);

/** List + the tiles, with both partitions proved before the response leaves. */
async function list(client, q = {}) {
  const { rows, total, statusRows, typeRows, limit, offset } = await repo.list(client, q);
  const kpi = rules.kpiFrom({ statusRows, typeRows });
  rules.assertPartitions(kpi);
  return { rows, total, kpi, limit, offset };
}

const listForExport = (client, q = {}) => repo.listForExport(client, q, EXPORT_CAP);

module.exports = {
  create, update, transition, approve, reject, uploadProfile,
  get, list, listForExport, draftSupplierFor, resolveEntityId,
  PROFILE_MAX_BYTES, PROFILE_TYPES, EXPORT_CAP,
};
