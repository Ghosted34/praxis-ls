/**
 * Quote request (MOD-20-intake) — service layer.
 *
 * The intake register from F6 (doc/SALES_CRM_FEATURES.md): a request for a
 * quote arrives from the website or is keyed in by staff, carrying the whole
 * logistics scope; staff work it; when it becomes real it converts into a
 * tracked opportunity.
 *
 * THREE THINGS THIS LAYER IS RESPONSIBLE FOR, EACH OF WHICH WAS WRONG BEFORE:
 *
 * 1. THE REFERENCE. `numbering.allocate` refuses a null entity — `doc_sequence`
 *    is keyed (module, year, entity) so a tenant with two corporate entities
 *    cannot share one counter. It was being called with `entityId: null` on
 *    every create, so every create raised 422 NO_ENTITY and the register could
 *    not take a single row. The entity is now resolved (payload → the lead's →
 *    the tenant's only active entity) and the number is allocated BEFORE the
 *    insert, so the row and its reference are one statement, not two.
 *
 * 2. CONVERSION IS ONE TRANSACTION. The opportunity used to be created — and
 *    COMMITTED, since opportunity.service opens its own BEGIN/COMMIT — before
 *    this function opened its transaction. A failure on the quote_request
 *    update then left an opportunity in the pipeline that no request pointed
 *    at, which is exactly the "converted computed two ways" defect F6 exists to
 *    correct. Both writes now share one transaction, opened here, and the
 *    opportunity repo is called directly so no nested BEGIN can commit early.
 *
 * 3. AN ATTACHMENT THAT FAILS LEAVES NOTHING BEHIND. There was no upload path
 *    at all — the controller took a `vault_id` from the request body and linked
 *    it — while a comment asserted that the controller deleted the vault row on
 *    rollback. It did not. The upload now happens here, inside the transaction
 *    that writes the link, and the stored object is deleted when that
 *    transaction rolls back.
 */
"use strict";
const repo = require("./quote_request.repo");
const events = require("./quote_request.events");
const rules = require("./quote_request.rules");
const opportunityRepo = require("../opportunity/opportunity.repo");
const opportunityEvents = require("../opportunity/opportunity.events");
const vault = require("../../vault/document_vault/document_vault.service");
const storage = require("../../../services/storage.service");
const numbering = require("../../../services/documents/numbering.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");
const { atomically } = require("../../../shared/db/tx");

const ref = (id) => "quote_request:" + id;

/** An enquiry attachment: a packing list, a photo of the cargo, a spec sheet. */
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"];

/** Rows a CSV export will stream before it tells the caller it truncated. */
const EXPORT_CAP = 10000;

/**
 * Which corporate entity this enquiry belongs to.
 *
 * Order: what the caller said → what the linked lead already belongs to → the
 * tenant's only active entity. A tenant with two entities and no explicit
 * choice gets a 422 naming the field rather than a guess: the entity decides
 * which counter the reference comes from and whose letterhead the quotation
 * will eventually carry, and picking one silently files the enquiry under the
 * wrong company.
 */
async function resolveEntityId(client, { data = {} }) {
  if (data.entity_id) return data.entity_id;
  if (data.lead_id) {
    const { rows } = await client.query("SELECT entity_id FROM lead WHERE lead_id = $1", [data.lead_id]);
    if (rows[0] && rows[0].entity_id) return rows[0].entity_id;
  }
  const fallback = await repo.defaultEntityId(client);
  if (fallback) return fallback;
  throw new AppError(
    "ENTITY_REQUIRED",
    "This tenant has more than one corporate entity — say which one the request belongs to",
    422,
    { entity_id: ["required when the tenant has several corporate entities"] },
  );
}

async function create(client, { data, actor = {} }) {
  const entityId = await resolveEntityId(client, { data });
  return atomically(client, async () => {
    // Allocated INSIDE the transaction (BUILD_CONVENTIONS §3) so the number and
    // the row commit together — a rolled-back create must not burn a reference.
    const { number } = await numbering.allocate(client, {
      moduleKey: "MOD-20-INTAKE",
      entityId,
      date: new Date().toISOString().slice(0, 10),
    });
    const row = await repo.insert(client, {
      ...data,
      entity_id: entityId,
      public_ref: data.public_ref || number,
      created_by_user_id: actor.user_id || null,
    });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.quote_request_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.quote_request_id), after: row });
    return row;
  });
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  if (rules.isTerminal(before.status)) {
    throw new AppError("LOCKED", "A " + before.status + " quote request cannot be edited", 422);
  }
  const fields = {};
  for (const k of repo.WRITABLE) {
    // public_ref is allocated once and is history; entity_id decides the
    // counter that produced it, so neither is patchable after the fact.
    if (k === "public_ref" || k === "entity_id") continue;
    if (patch[k] !== undefined) fields[k] = patch[k];
  }
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

async function transition(client, { id, to, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  rules.assertTransition(before.status, to);
  const row = await repo.update(client, id, { status: to });
  await emitEvent(client, { eventTypeKey: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/**
 * Convert a quote request into an opportunity — ONE transaction.
 *
 * The opportunity row is written through its own repo rather than through
 * opportunity.service.create, precisely because that service opens and commits
 * its own transaction: calling it here would commit the opportunity before this
 * function's own write, and a failure afterwards would strand it. The events
 * and audit rows the opportunity module would have emitted are emitted here
 * with the same keys, so nothing downstream loses a record.
 *
 * `converted_opportunity_id` is the single source of truth for "is converted";
 * the trg_quote_request_sync_converted trigger keeps `status` and `converted_at`
 * in step with it, so the two can never disagree the way the legacy's did.
 */
async function convertToOpportunity(client, { id, opportunity = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  if (before.converted_opportunity_id) {
    throw new AppError("ALREADY_CONVERTED", "Quote request is already converted", 422);
  }
  rules.assertTransition(before.status, "CONVERTED_TO_OPPORTUNITY");

  return atomically(client, async () => {
    const opp = await opportunityRepo.insert(client, {
      name: opportunity.name,
      lead_id: before.lead_id || null,
      client_id: opportunity.client_id || null,
      pipeline_stage_id: opportunity.pipeline_stage_id || null,
      estimated_value: opportunity.estimated_value ?? null,
      currency: opportunity.currency || "XAF",
      owner_user_id: opportunity.owner_user_id || before.owner_user_id || actor.user_id || null,
      probability: opportunity.probability ?? null,
      status: "OPEN",
    });
    await emitEvent(client, { eventTypeKey: opportunityEvents.CREATED, moduleKey: opportunityEvents.MODULE, entityRef: "opportunity:" + opp.opportunity_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: opportunityEvents.CREATED, moduleKey: opportunityEvents.MODULE, entityRef: "opportunity:" + opp.opportunity_id, after: opp });

    const row = await repo.update(client, id, {
      converted_opportunity_id: opp.opportunity_id,
      status: "CONVERTED_TO_OPPORTUNITY",
    });
    await emitEvent(client, { eventTypeKey: events.CONVERTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CONVERTED, moduleKey: events.MODULE, entityRef: ref(id), before, after: { opportunity_id: opp.opportunity_id } });
    return { quote_request: row, opportunity: opp };
  });
}

/* ─── attachments ─────────────────────────────────────────────────────────── */

/**
 * Upload a document against an enquiry — bytes and link in one transaction.
 *
 * THE ORPHAN RULE. Two things can be left behind by a half-done upload: a
 * `document_vault` row and the stored object it names. The row is inside this
 * transaction and disappears with the ROLLBACK. The object is not — object
 * storage has no transaction to join — so it is deleted explicitly on the
 * failure path, keyed on the storage_path the vault just returned. The delete
 * is best-effort and logged rather than thrown: failing the caller a SECOND
 * time, over cleanup, would replace a recoverable orphan with a lost document.
 *
 * `sniff` is on. An enquiry attachment arrives from a stranger through the
 * public intake in F13, and a .exe renamed .pdf is refused on its bytes.
 */
async function uploadAttachment(client, { id, dataUrl, filename = null, kind = "ADDITIONAL", slug, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  if (rules.isTerminal(before.status)) {
    throw new AppError("LOCKED", "Cannot add attachments to a " + before.status + " quote request", 422);
  }

  let storedPath = null;
  try {
    return await atomically(client, async () => {
    const doc = await vault.createDocument(client, {
      dataUrl,
      docType: "QUOTE_REQUEST_ATTACHMENT",
      entityRef: ref(id),
      originalName: filename,
      maxBytes: ATTACHMENT_MAX_BYTES,
      allowedTypes: ATTACHMENT_TYPES,
      sniff: true,
      slug,
      actor,
    });
    storedPath = doc.storage_path;
    if (kind === "PRIMARY") await repo.demotePrimary(client, id);
    const link = await repo.addAttachment(client, {
      quote_request_id: id, vault_id: doc.doc_id, kind, uploaded_by_user_id: actor.user_id || null,
    });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ATTACHMENT_ADDED, moduleKey: events.MODULE, entityRef: ref(id), after: link });
    return { ...link, original_name: doc.original_name, content_hash: doc.content_hash };
    });
  } catch (err) {
    if (storedPath) {
      try { await storage.delete(storedPath); } catch (cleanupErr) {
        logger.error({ err: cleanupErr, storedPath, quoteRequestId: id },
          "[quote-request] attachment rolled back but its stored object could not be deleted");
      }
    }
    throw err;
  }
}

async function removeAttachment(client, { id, attachment_id, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  if (rules.isTerminal(before.status)) {
    throw new AppError("LOCKED", "Cannot remove attachments from a " + before.status + " quote request", 422);
  }
  const link = await repo.getAttachment(client, { quote_request_id: id, attachment_id });
  if (!link) throw new AppError("NOT_FOUND", "Attachment not found", 404);
  return atomically(client, async () => {
    await repo.removeAttachment(client, { quote_request_id: id, attachment_id });
    // The vault row is ARCHIVED, never deleted: the document is evidence of what
    // the client sent, and MOD-64's whole contract is that vault rows are
    // retained. Detaching it from the enquiry is the operator's intent; erasing
    // it is not.
    await vault.archiveDocument(client, { id: link.vault_id, actor });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ATTACHMENT_REMOVED, moduleKey: events.MODULE, entityRef: ref(id), before: link, after: { attachment_id } });
    return { removed: true };
  });
}

async function listAttachments(client, id) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  return repo.listAttachments(client, id);
}

/* ─── reads ───────────────────────────────────────────────────────────────── */

const get = (client, id) => repo.get(client, id);

/**
 * List + the KPI tiles.
 *
 * The fold lives in `rules.kpiFrom`, which derives one tile per status from the
 * status list itself, and `assertPartitions` proves the tiles add up to TOTAL
 * before the response leaves. The previous version hand-listed four tiles while
 * the CHECK constraint allowed six, so every CLARIFICATION_REQUIRED and
 * CLOSED_NO_ACTION row was counted into TOTAL and shown in no tile — the
 * register disagreed with itself, which is the legacy defect verbatim.
 */
async function list(client, q = {}) {
  const { rows, total, kpiRows, limit, offset } = await repo.list(client, q);
  const kpi = rules.kpiFrom(kpiRows);
  rules.assertPartitions(kpi);
  return { rows, total, kpi, limit, offset };
}

/** Every matching row, for the CSV export. `truncated` is reported, never hidden. */
const listForExport = (client, q = {}) => repo.listForExport(client, q, EXPORT_CAP);

module.exports = {
  create, update, transition, convertToOpportunity,
  uploadAttachment, removeAttachment, listAttachments,
  get, list, listForExport,
  resolveEntityId,
  ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, EXPORT_CAP,
};
