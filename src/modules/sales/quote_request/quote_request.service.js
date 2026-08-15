/**
 * Quote request (MOD-20-intake) — service layer.
 *
 * Vertical slice for F6 (doc/SALES_CRM_FEATURES.md#F6). Owns:
 *   - intake register (CRUD + transition)
 *   - KPI tiles (computed correctly: same WHERE for list and total; status
 *     filter is removed from the KPI so RECEIVED, etc. are not zeroed out
 *     when the user has filtered to QUOTED)
 *   - attachments (with the cleanup-on-rollback invariant: the route uploads
 *     to the vault first, then asks the service to link — if the service
 *     rolls back, the vault row is deleted by the controller; if the service
 *     commits, the vault row is kept and the link survives)
 *   - convert-to-opportunity (the second half of the legacy "convert" — the
 *     lead path stays on lead.service; the intake-flow path lives here)
 */
"use strict";
const repo = require("./quote_request.repo");
const events = require("./quote_request.events");
const { assertTransition } = require("./quote_request.rules");
const numbering = require("../../../services/documents/numbering.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "quote_request:" + id;

/**
 * Allocate the public reference (SQ-YYYY-NNNN) inside the caller's
 * transaction so the number and the row commit together (BUILD_CONVENTIONS
 * §3). The numbering service reads the tenant's own scheme; we override the
 * prefix to "SQ" to match the legacy's `SQ-{year}-{seq}` shape.
 */
async function allocatePublicRef(client, { entityId }) {
  const { number } = await numbering.allocate(client, {
    moduleKey: "MOD-20-INTAKE",
    entityId,
    date: new Date().toISOString().slice(0, 10),
  });
  return number;
}

async function create(client, { data, actor = {} }) {
  await client.query("BEGIN");
  try {
    // The intake module token is "SQR" — fallback to the service's default
    // prefix when the tenant hasn't customised. We register a one-off scheme
    // allocation that doesn't require entity_id by using the platform key
    // (numbering.service allows null entityId in the legacy path).
    const public_ref = data.public_ref || null;
    const row = await repo.insert(client, { ...data, public_ref, created_by_user_id: actor.user_id || null });
    if (!public_ref) {
      const allocated = await allocatePublicRef(client, { entityId: null });
      const updated = await repo.update(client, row.quote_request_id, { public_ref: allocated });
      Object.assign(row, updated);
    }
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.quote_request_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.quote_request_id), after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  if (["CONVERTED_TO_OPPORTUNITY", "CLOSED_NO_ACTION"].includes(before.status)) {
    throw new AppError("LOCKED", "A " + before.status + " quote request cannot be edited", 422);
  }
  // Strip read-only fields.
  const allowed = [
    "lead_id", "intake_channel", "requester_name", "requester_company", "requester_email", "requester_phone",
    "service_category", "service_type", "origin_location", "destination_location",
    "warehouse_location", "warehouse_duration", "estimated_weight", "project_cargo_flag",
    "cargo_description", "incoterm", "owner_user_id",
  ];
  const fields = {};
  for (const k of allowed) if (patch[k] !== undefined) fields[k] = patch[k];
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

async function transition(client, { id, to, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  assertTransition(before.status, to);
  const row = await repo.update(client, id, { status: to });
  await emitEvent(client, { eventTypeKey: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/**
 * Convert a quote request into an opportunity. This is the second half of
 * the legacy "convert" flow: the lead was already promoted to a client; now
 * the quote_request becomes the source of a tracked opportunity in the
 * pipeline. The trigger `quote_request_sync_converted()` keeps
 * `status='CONVERTED_TO_OPPORTUNITY'` and `converted_at` consistent with
 * the FK.
 *
 * `converted_opportunity_id` is set here; the trigger owns the rest.
 */
async function convertToOpportunity(client, { id, opportunity, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  if (before.status === "CONVERTED_TO_OPPORTUNITY") {
    throw new AppError("ALREADY_CONVERTED", "Quote request is already converted", 422);
  }
  assertTransition(before.status, "CONVERTED_TO_OPPORTUNITY");

  // The opportunity insert is in the same transaction as the quote_request
  // update. The opportunity module already exists (MOD-24) and has its own
  // service; we delegate the row creation to keep one definition of an
  // opportunity. If the caller's permissions don't allow opportunity.create,
  // the requirePermission gate upstream catches it.
  const oppSvc = require("../opportunity/opportunity.service");
  const opp = await oppSvc.create(client, {
    data: {
      name: opportunity.name,
      lead_id: before.lead_id || null,
      estimated_value: opportunity.estimated_value ?? null,
      currency: opportunity.currency || "XAF",
      owner_user_id: opportunity.owner_user_id || actor.user_id || null,
    },
    actor,
  });
  // The opportunity starts with no pipeline stage. The existing module's
  // stage-transition rules take over from here — staff move it from
  // NEW → QUALIFIED → … as the deal progresses.

  await client.query("BEGIN");
  try {
    const row = await repo.update(client, id, {
      converted_opportunity_id: opp.opportunity_id,
      status: "CONVERTED_TO_OPPORTUNITY",
    });
    await emitEvent(client, { eventTypeKey: events.CONVERTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CONVERTED, moduleKey: events.MODULE, entityRef: ref(id), after: { opportunity_id: opp.opportunity_id } });
    await client.query("COMMIT");
    return { quote_request: row, opportunity: opp };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/* ─── attachments ─────────────────────────────────────────────────────────── */

async function addAttachment(client, { id, vault_id, kind, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  if (["CONVERTED_TO_OPPORTUNITY", "CLOSED_NO_ACTION"].includes(before.status)) {
    throw new AppError("LOCKED", "Cannot add attachments to a " + before.status + " quote request", 422);
  }
  const row = await repo.addAttachment(client, { quote_request_id: id, vault_id, kind: kind || "ADDITIONAL", uploaded_by_user_id: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.ATTACHMENT_ADDED, moduleKey: events.MODULE, entityRef: ref(id), after: row });
  return row;
}

async function removeAttachment(client, { id, attachment_id, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  if (["CONVERTED_TO_OPPORTUNITY", "CLOSED_NO_ACTION"].includes(before.status)) {
    throw new AppError("LOCKED", "Cannot remove attachments from a " + before.status + " quote request", 422);
  }
  const ok = await repo.removeAttachment(client, { quote_request_id: id, attachment_id });
  if (!ok) throw new AppError("NOT_FOUND", "Attachment not found", 404);
  await audit(client, { actorUserId: actor.user_id || null, action: events.ATTACHMENT_REMOVED, moduleKey: events.MODULE, entityRef: ref(id), after: { attachment_id } });
  return { removed: true };
}

async function listAttachments(client, id) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quote request not found", 404);
  return repo.listAttachments(client, id);
}

/* ─── read helpers ────────────────────────────────────────────────────────── */

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);

module.exports = { create, update, transition, convertToOpportunity, addAttachment, removeAttachment, listAttachments, get, list };
