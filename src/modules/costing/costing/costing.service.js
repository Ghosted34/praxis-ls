/**
 * Project costing (MOD-46, KB §6.7). A dossier budget: lines (service vs débours),
 * a margin % on the service base (débours pass-through), and a draft→validate→
 * approve lifecycle. No GL (budget only) — actuals post via cost_tracking (MOD-47).
 * SQL in the repo.
 */
"use strict";
const repo = require("./costing.repo");
const events = require("./costing.events");
const { computeCosting } = require("./costing.rules");
const numbering = require("../../../services/documents/numbering.service");
const executor = require("../../../services/workflow/executor");
const onApproved = require("../../../services/workflow/on-approved");
const { assertNoPendingChain } = require("../../../services/workflow/pending-guard");
const finalInvoice = require("../../finance/final_invoice/final_invoice.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");
const { AppError } = require("../../../utils/errors");
const shipmentDetails = require("../../operations/shipment_details/shipment_details.service");

const LOCKED = new Set(["APPROVED_LOCKED", "REJECTED"]);

async function replaceLines(client, costingId, lines) {
  await repo.deleteLines(client, costingId);
  for (const l of lines) {
     
    await repo.insertLine(client, {
      costing_id: costingId, dictionary_item_id: l.dictionary_item_id || null, label: l.label || "Line",
      qty: l.qty || 1, unit_cost: l.unit_cost || 0, is_disbursement: l.is_disbursement === true, tax_code_id: l.tax_code_id || null,
      // Which box this charge was priced for (0663). NULL for anything with no
      // equipment dimension, which is most of the catalogue.
      container_type_ref_id: l.container_type_ref_id || null,
    });
  }
}

async function createDraft(client, { data, actor = {} }) {
  await client.query("BEGIN");
  try {
    const costing = await repo.insert(client, {
      dossier_id: data.dossier_id, currency: data.currency || "XAF",
      exchange_rate_to_xaf: data.exchange_rate_to_xaf || 1, margin_percent: data.margin_percent || 0, status: "DRAFT",
    });
    if (Array.isArray(data.lines) && data.lines.length) await replaceLines(client, costing.costing_id, data.lines);
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "costing:" + costing.costing_id, after: costing });
    await client.query("COMMIT");
    return get(client, costing.costing_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function updateDraft(client, { id, patch = {}, lines = null, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Costing not found", 404);
  if (before.status !== "DRAFT") throw new AppError("LOCKED", "Only a DRAFT costing can be edited", 422);
  await client.query("BEGIN");
  try {
    const fields = {};
    for (const k of ["currency", "exchange_rate_to_xaf", "margin_percent"]) if (patch[k] !== undefined) fields[k] = patch[k];
    if (Object.keys(fields).length) await repo.update(client, id, fields);
    if (Array.isArray(lines)) await replaceLines(client, id, lines);
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function setStatus(client, { id, to, actor = {}, viaChain = false }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Costing not found", 404);
  if (LOCKED.has(before.status)) throw new AppError("LOCKED", "Costing is " + before.status, 422);
  const flow = { SUBMIT_VALIDATION: "SUBMITTED_FOR_VALIDATION", SUBMIT_APPROVAL: "SUBMITTED_FOR_APPROVAL", APPROVE: "APPROVED_LOCKED", REJECT: "REJECTED" };
  const status = flow[to];
  if (!status) throw new AppError("BAD_ACTION", "unknown transition", 422);
  // Approving/rejecting directly while a chain is live would skip it (W4).
  if (to === "APPROVE" || to === "REJECT") {
    await assertNoPendingChain(client, "costing:" + id, { viaChain, what: "costing" });
  }
  const row = await repo.update(client, id, { status });
  // On submit-for-approval, open the tenant's configurable approval chain (if any
  // workflow is bound to costing.submitted).
  // No workflow bound → autoApproved and the manual APPROVE path stays available;
  // see the note on W8 in purchase_order.service.js for why nothing auto-advances.
  if (status === "SUBMITTED_FOR_APPROVAL") {
    const totals = computeCosting(await repo.listLines(client, id), before.margin_percent);
    await executor.start(client, { eventTypeKey: "costing.submitted", entityRef: "costing:" + id, amountXaf: totals && totals.service_base ? totals.service_base : null });
  }
  if (status === "APPROVED_LOCKED") {
    await emitEvent(client, { eventTypeKey: events.APPROVED, moduleKey: events.MODULE, entityRef: "costing:" + id, actorUserId: actor.user_id || null });
    // Freeze the file's shipment details onto the costing (0661). An approved
    // costing must keep citing the vessel and route it was approved with, even
    // after the carrier rolls the booking and ops updates the file. Never
    // throws — see shipment_details.snapshotOnto.
    await shipmentDetails.snapshotOnto(client, { table: "costing", id, dossierId: before.dossier_id });
    // SYNCHRONOUS handoff (A7 #3): open the DRAFT final invoice now, in-request.
    // TX-agnostic + idempotent; the async orchestration handler is a backstop and
    // no-ops once this has run. Best-effort — a draft-shell failure must not block
    // the approval (the backstop retries).
    try {
      await finalInvoice.ensureDraftForCosting(client, id);
    } catch (err) {
      logger.error({ err, costing_id: id }, "sync draft-invoice on costing approval failed; async backstop will retry");
    }
  }
  await audit(client, { actorUserId: actor.user_id || null, action: events.statusChange(status), moduleKey: events.MODULE, entityRef: "costing:" + id, before, after: row });
  return row;
}

async function get(client, id) {
  const costing = await repo.get(client, id);
  if (!costing) return null;
  const lines = await repo.listLines(client, id);
  costing.lines = lines;
  costing.totals = computeCosting(lines, costing.margin_percent);
  return costing;
}
const list = (client, q) => repo.list(client, q);

// A cleared approval chain approves+locks the costing (BUILD_CONVENTIONS §2/§5).
onApproved.register("costing", (client, { id, actor }) => setStatus(client, { id, to: "APPROVE", actor: actor || {}, viaChain: true }));

module.exports = { createDraft, updateDraft, setStatus, get, list };
