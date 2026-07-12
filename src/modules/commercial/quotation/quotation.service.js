/**
 * Quotation (MOD-27) — the priced offer between opportunity and final invoice.
 * Lifecycle: createDraft → updateDraft → send (number+capture) → accept (→ can
 * convert into a final-invoice DRAFT from its lines) / reject / expire. Totals
 * recomputed on every edit; VAT rate from tenant settings. All SQL is in the repo.
 */
"use strict";

const repo = require("./quotation.repo");
const events = require("./quotation.events");
const { assertTransition, computeTotals } = require("./quotation.rules");
const finalInvoice = require("../../finance/final_invoice/final_invoice.service");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const { getRule } = require("../../../shared/config/settings");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "quotation:" + id;

async function vatRate(client) { return getRule(client, "finance", "vat", "rate_percent", 19.25); }

async function replaceLines(client, id, lines) {
  await repo.deleteLines(client, id);
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    /// eslint-disable-next-line no-await-in-loop
    await repo.insertLine(client, { quotation_id: id, dictionary_item_id: l.dictionary_item_id || null, label: l.label || "Line", qty: l.qty || 1, unit_price: l.unit_price || 0, is_debours: l.is_debours === true, tax_code_id: l.tax_code_id || null, line_no: i + 1 });
  }
}
async function recompute(client, id) {
  const lines = await repo.listLines(client, id);
  const totals = computeTotals(lines, await vatRate(client));
  return repo.update(client, id, { total_ht: totals.total_ht, total_ttc: totals.total_ttc });
}

async function createDraft(client, { data, actor = {} }) {
  await client.query("BEGIN");
  try {
    const q = await repo.insert(client, {
      entity_id: data.entity_id || null, client_id: data.client_id || null, dossier_id: data.dossier_id || null,
      costing_id: data.costing_id || null, opportunity_id: data.opportunity_id || null, currency: data.currency || "XAF",
      quote_model: data.quote_model || "HT_ON_TOP", margin_percent: data.margin_percent ?? null, valid_until: data.valid_until || null, status: "DRAFT",
    });
    if (data.lines && data.lines.length) { await replaceLines(client, q.quotation_id, data.lines); await recompute(client, q.quotation_id); }
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(q.quotation_id), after: q });
    await client.query("COMMIT");
    return get(client, q.quotation_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function updateDraft(client, { id, patch = {}, lines = null, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quotation not found", 404);
  if (before.status !== "DRAFT") throw new AppError("LOCKED", "Only a DRAFT quotation can be edited", 422);
  await client.query("BEGIN");
  try {
    const fields = {};
    for (const k of ["client_id", "dossier_id", "costing_id", "opportunity_id", "currency", "quote_model", "margin_percent", "valid_until"]) if (patch[k] !== undefined) fields[k] = patch[k];
    if (Object.keys(fields).length) await repo.update(client, id, fields);
    if (Array.isArray(lines)) { await replaceLines(client, id, lines); await recompute(client, id); }
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function transition(client, { id, to, entityId = null, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quotation not found", 404);
  assertTransition(before.status, to);
  await client.query("BEGIN");
  try {
    const fields = { status: to };
    if (to === "SENT" && !before.doc_number) {
      const eid = entityId || before.entity_id;
      if (!eid) throw new AppError("ENTITY_REQUIRED", "entity_id required to number the quotation", 422);
      const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId: eid, date: new Date().toISOString().slice(0, 10) });
      fields.doc_number = number;
    }
    const row = await repo.update(client, id, fields);
    if (to === "SENT") await documents.capture(client, { entityRef: ref(id), docType: "QUOTATION", status: "VERIFIED" });
    await emitEvent(client, { eventTypeKey: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Accept a SENT quotation; optionally convert its lines into a final-invoice DRAFT. */
async function accept(client, { id, convert = false, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quotation not found", 404);
  assertTransition(before.status, "ACCEPTED");
  await client.query("BEGIN");
  try {
    await repo.update(client, id, { status: "ACCEPTED" });
    let invoiceId = null;
    if (convert) {
      const lines = await repo.listLines(client, id);
      const econLines = lines.map((l) => ({ dictionary_item_id: l.dictionary_item_id, amount: Number(l.qty) * Number(l.unit_price), is_debours: l.is_debours, label: l.label }));
      const inv = await finalInvoice.createDraft(client, { entityId: before.entity_id, clientId: before.client_id, dossierId: before.dossier_id, lines: econLines, actor });
      invoiceId = inv.invoice_id;
      await repo.update(client, id, { status: "CONVERTED" });
      await emitEvent(client, { eventTypeKey: events.CONVERTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    }
    await emitEvent(client, { eventTypeKey: events.ACCEPTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ACCEPTED, moduleKey: events.MODULE, entityRef: ref(id), after: { invoice_id: invoiceId } });
    await client.query("COMMIT");
    return { quotation: await get(client, id), invoice_id: invoiceId };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function get(client, id) {
  const q = await repo.get(client, id);
  if (!q) return null;
  q.lines = await repo.listLines(client, id);
  return q;
}
const list = (client, q) => repo.list(client, q);
module.exports = { createDraft, updateDraft, transition, accept, get, list };
