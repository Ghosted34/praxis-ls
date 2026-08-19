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
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");
const { AppError } = require("../../../utils/errors");
const shipmentDetails = require("../../operations/shipment_details/shipment_details.service");

const LOCKED = new Set(["APPROVED_LOCKED", "REJECTED"]);

/**
 * The unlock loop — the way out of APPROVED_LOCKED (10718).
 *
 * `setStatus` refuses ANY transition out of a locked status before it looks at
 * the target, which is correct for the ordinary flow and is exactly why an
 * approved costing could never be corrected. Rather than punch a hole in that
 * guard, unlock is its own small state machine handled ahead of it: request,
 * grant, deny. Legacy did the same (api/costing/transition.php:175-205) and
 * parked the request in its own status so "someone has asked" is visible.
 */
const UNLOCK_FLOW = {
  REQUEST_UNLOCK: { from: "APPROVED_LOCKED", to: "UNLOCK_REQUESTED" },
  // Legacy returns to DRAFT (transition.php:192), and DRAFT is the only status
  // updateDraft will edit (see line ~54) — anywhere else would be unlocked in
  // name and still uneditable in fact.
  UNLOCK: { from: "UNLOCK_REQUESTED", to: "DRAFT" },
  DENY_UNLOCK: { from: "UNLOCK_REQUESTED", to: "APPROVED_LOCKED" },
};

/**
 * Refuse to reopen a costing whose final invoice has left DRAFT.
 *
 * Approving a costing OPENS a final invoice for its dossier
 * (`ensureDraftForCosting`, called below on APPROVED_LOCKED). That invoice can
 * go on to ISSUED_LOCKED / POSTED_LOCKED (0230:66) and carry a posted
 * `entry_id`. Unlocking the costing underneath it would let the priced basis
 * change while the booked revenue stays as it was — a wrong ledger position
 * produced by a workflow completing normally, which is the same failure 10717
 * was written to remove.
 *
 * A DRAFT invoice is fine: nothing is posted and it is regenerated from the
 * costing anyway. Checked against the invoice table rather than a costing
 * column because the invoice is the thing that moved.
 */
async function assertInvoiceNotPosted(client, costing) {
  if (!costing.dossier_id) return;
  const { rows } = await client.query(
    "SELECT invoice_id, doc_number, status FROM invoice " +
      "WHERE dossier_id = $1 AND type = 'FINAL' AND status <> 'DRAFT' LIMIT 1",
    [costing.dossier_id],
  );
  const inv = rows[0];
  if (inv) {
    throw new AppError(
      "INVOICE_ISSUED",
      `Final invoice ${inv.doc_number || inv.invoice_id} is ${inv.status}. ` +
        "Reverse or cancel it before reopening the costing it was priced from.",
      422,
    );
  }
}

/**
 * REQUEST_UNLOCK / UNLOCK / DENY_UNLOCK.
 *
 * Permissions are NOT ported from the legacy role lists
 * (REQUEST_UNLOCK: ADMIN/SALES/OPERATIONS/MANAGEMENT; UNLOCK and DENY_UNLOCK:
 * ADMIN/MANAGEMENT). Hardcoded role names are strictly less expressive than
 * this system's module grants plus the SoD capability overlay, so the routes
 * express the same intent as `edit` for the request and `approve` + APPROVER
 * for the decision — the split costing.routes.js already documents for
 * SUBMIT vs APPROVE.
 */
async function unlockTransition(client, { id, action, reason = null, actor = {} }) {
  const step = UNLOCK_FLOW[action];
  if (!step) throw new AppError("BAD_ACTION", "unknown unlock action", 422);

  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Costing not found", 404);
  if (before.status !== step.from) {
    throw new AppError(
      "BAD_STATE",
      `${action} needs a costing in ${step.from}; this one is ${before.status}`,
      422,
    );
  }
  if (action === "REQUEST_UNLOCK" && !String(reason || "").trim()) {
    // The audit answer to "why is this approved costing open again". Legacy
    // appended it to a free-text remarks blob; here it is a column.
    throw new AppError("REASON_REQUIRED", "Say why the costing needs reopening", 422);
  }
  // Checked on the GRANT, not the request: asking is harmless, and the invoice
  // may well be reversed between the two.
  if (action === "UNLOCK") await assertInvoiceNotPosted(client, before);

  const patch = { status: step.to };
  if (action === "REQUEST_UNLOCK") {
    // DATA 2.4: FK to app_user, which lives in LIVE while this row may land in
    // SANDBOX. check-actor-fk-guard.js cannot see this idiom (it matches
    // `x_by:` in an object literal, not `patch.x_by =`), so it is guarded by
    // hand for the same reason the guard exists.
    patch.unlock_requested_by = await resolveActorId(client, actor.user_id);
    patch.unlock_requested_at = new Date().toISOString();
    patch.unlock_reason = reason;
  }
  if (action === "UNLOCK") {
    // DATA 2.4 — as above.
    patch.unlocked_by = await resolveActorId(client, actor.user_id);
    patch.unlocked_at = new Date().toISOString();
  }
  // DENY_UNLOCK deliberately keeps unlock_reason and the request metadata: the
  // fact that a reopening was asked for and refused is the audit trail.

  const row = await repo.update(client, id, patch);
  await emitEvent(client, {
    eventTypeKey: events.unlockEvent(action),
    moduleKey: events.MODULE,
    entityRef: "costing:" + id,
    actorUserId: actor.user_id || null,
  });
  await audit(client, {
    actorUserId: actor.user_id || null,
    action: events.unlockEvent(action),
    moduleKey: events.MODULE,
    entityRef: "costing:" + id,
    before,
    after: row,
  });
  return row;
}

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
      // §2.2: margin_percent is deprecated and never written — costing stops
      // at HT/VAT/TTC; margin belongs to margin_simulation + quotation.
      exchange_rate_to_xaf: data.exchange_rate_to_xaf || 1, status: "DRAFT",
      // §3.3: remarks + the named validator (legacy save.php:29,:6,:33). The
      // assignment moment is recorded so a stalled validation is visible.
      remarks: data.remarks || null,
      validator_id: data.validator_id || null,
      validator_assigned_at: data.validator_id ? new Date() : null,
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
    // §2.2: margin_percent removed from the patchable set — deprecated column.
    for (const k of ["currency", "exchange_rate_to_xaf", "remarks"]) if (patch[k] !== undefined) fields[k] = patch[k];
    // §3.3: naming (or changing) the validator stamps when it happened.
    if (patch.validator_id !== undefined) {
      fields.validator_id = patch.validator_id;
      fields.validator_assigned_at = patch.validator_id ? new Date() : null;
    }
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
  // §3.3: legacy save.php names validator_employee_id at submit time. Ours
  // silently allowed a costing to sit SUBMITTED_FOR_VALIDATION with nobody
  // named to validate it — a queue with no owner. Submitting for validation
  // now requires the validator to be picked first.
  if (to === "SUBMIT_VALIDATION" && !before.validator_id) {
    throw new AppError("NO_VALIDATOR", "Pick a validator before submitting for validation — a submission with nobody named goes to no one's queue", 422);
  }
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
    const totals = computeCosting(await repo.listLines(client, id));
    // `totals.total_ht` — the money the sheet commits us to. (The old code read
    // `totals.service_base`, a key computeCosting never returned, so the
    // approval chain's amount threshold always saw null.)
    await executor.start(client, { eventTypeKey: "costing.submitted", entityRef: "costing:" + id, amountXaf: totals ? totals.total_ht : null });
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
  costing.totals = computeCosting(lines);
  return costing;
}
const list = (client, q) => repo.list(client, q);

// A cleared approval chain approves+locks the costing (BUILD_CONVENTIONS §2/§5).
onApproved.register("costing", (client, { id, actor }) => setStatus(client, { id, to: "APPROVE", actor: actor || {}, viaChain: true }));

module.exports = { createDraft, updateDraft, setStatus, unlockTransition, get, list };
