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
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const LOCKED = new Set(["APPROVED_LOCKED", "REJECTED"]);

async function replaceLines(client, costingId, lines) {
  await repo.deleteLines(client, costingId);
  for (const l of lines) {
    // eslint-disable-next-line no-await-in-loop
    await repo.insertLine(client, {
      costing_id: costingId, dictionary_item_id: l.dictionary_item_id || null, label: l.label || "Line",
      qty: l.qty || 1, unit_cost: l.unit_cost || 0, is_debours: l.is_debours === true, tax_code_id: l.tax_code_id || null,
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

async function setStatus(client, { id, to, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Costing not found", 404);
  if (LOCKED.has(before.status)) throw new AppError("LOCKED", "Costing is " + before.status, 422);
  const flow = { SUBMIT_VALIDATION: "SUBMITTED_FOR_VALIDATION", SUBMIT_APPROVAL: "SUBMITTED_FOR_APPROVAL", APPROVE: "APPROVED_LOCKED", REJECT: "REJECTED" };
  const status = flow[to];
  if (!status) throw new AppError("BAD_ACTION", "unknown transition", 422);
  const row = await repo.update(client, id, { status });
  // On submit-for-approval, open the tenant's configurable approval chain (if any
  // workflow is bound to costing.submitted). No workflow bound → autoApproved,
  // the manual APPROVE path below is unchanged (BUILD_CONVENTIONS §2).
  if (status === "SUBMITTED_FOR_APPROVAL") {
    const totals = computeCosting(await repo.listLines(client, id), before.margin_percent);
    await executor.start(client, { eventTypeKey: "costing.submitted", entityRef: "costing:" + id, amountXaf: totals && totals.service_base ? totals.service_base : null });
  }
  if (status === "APPROVED_LOCKED") await emitEvent(client, { eventTypeKey: events.APPROVED, moduleKey: events.MODULE, entityRef: "costing:" + id, actorUserId: actor.user_id || null });
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
onApproved.register("costing", (client, { id, actor }) => setStatus(client, { id, to: "APPROVE", actor: actor || {} }));

module.exports = { createDraft, updateDraft, setStatus, get, list };
