/**
 * Proposal generator (MOD-23). AI-assisted draft (lines + narrative sections),
 * human review before send. Lifecycle DRAFT→IN_REVIEW→SENT→ACCEPTED/REJECTED;
 * numbered + captured on send; accepting can spin a quotation from its lines.
 * All SQL is in the repo.
 */
"use strict";
const repo = require("./proposal.repo");
const events = require("./proposal.events");
const { assertTransition, totalHt } = require("./proposal.rules");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const ref = (id) => "proposal:" + id;

async function replaceChildren(client, id, lines, narratives) {
  if (Array.isArray(lines)) {
    await repo.deleteLines(client, id);
    for (const l of lines) { /* eslint-disable-next-line no-await-in-loop */ await repo.insertLine(client, { proposal_id: id, dictionary_item_id: l.dictionary_item_id || null, label: l.label || "Line", qty: l.qty || 1, unit_price: l.unit_price || 0 }); }
  }
  if (Array.isArray(narratives)) {
    await repo.deleteNarratives(client, id);
    for (let i = 0; i < narratives.length; i += 1) { const n = narratives[i]; /* eslint-disable-next-line no-await-in-loop */ await repo.insertNarrative(client, { proposal_id: id, section: n.section, body: n.body || "", sort_order: n.sort_order ?? i }); }
  }
}
async function createDraft(client, { data, actor = {} }) {
  await client.query("BEGIN");
  try {
    const p = await repo.insert(client, { lead_id: data.lead_id || null, client_id: data.client_id || null, opportunity_id: data.opportunity_id || null, title: data.title, status: "DRAFT", ai_generated: data.ai_generated === true });
    await replaceChildren(client, p.proposal_id, data.lines || [], data.narratives || []);
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(p.proposal_id), after: p });
    await client.query("COMMIT");
    return get(client, p.proposal_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}
async function updateDraft(client, { id, patch = {}, lines = null, narratives = null, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Proposal not found", 404);
  if (before.status !== "DRAFT") throw new AppError("LOCKED", "Only a DRAFT proposal can be edited", 422);
  await client.query("BEGIN");
  try {
    const fields = {};
    for (const k of ["title", "client_id", "opportunity_id"]) if (patch[k] !== undefined) fields[k] = patch[k];
    if (Object.keys(fields).length) await repo.update(client, id, fields);
    await replaceChildren(client, id, lines, narratives);
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}
async function transition(client, { id, to, entityId = null, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Proposal not found", 404);
  assertTransition(before.status, to);
  await client.query("BEGIN");
  try {
    const fields = { status: to };
    if (to === "SENT" && !before.doc_number) {
      if (!entityId) throw new AppError("ENTITY_REQUIRED", "entity_id required to number the proposal", 422);
      const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId, date: new Date().toISOString().slice(0, 10) });
      fields.doc_number = number;
    }
    if (to === "IN_REVIEW") fields.reviewed_by = actor.user_id || null;
    const row = await repo.update(client, id, fields);
    if (to === "SENT") await documents.capture(client, { entityRef: ref(id), docType: "PROPOSAL", status: "VERIFIED" });
    await emitEvent(client, { eventTypeKey: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}
/** Accept a SENT proposal; optionally create a quotation from its lines. */
async function accept(client, { id, createQuotation = false, entityId = null, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Proposal not found", 404);
  assertTransition(before.status, "ACCEPTED");
  await client.query("BEGIN");
  try {
    const row = await repo.update(client, id, { status: "ACCEPTED" });
    let quotationId = null;
    if (createQuotation) {
      if (!entityId) throw new AppError("ENTITY_REQUIRED", "entity_id required to create a quotation", 422);
      const lines = await repo.listLines(client, id);
      const { number } = await numbering.allocate(client, { moduleKey: "MOD-27", entityId, date: new Date().toISOString().slice(0, 10) });
      quotationId = await repo.createQuotation(client, { proposal: before, entityId, totalHt: totalHt(lines), docNumber: number });
    }
    await emitEvent(client, { eventTypeKey: events.ACCEPTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ACCEPTED, moduleKey: events.MODULE, entityRef: ref(id), after: { quotation_id: quotationId } });
    await client.query("COMMIT");
    return { proposal: row, quotation_id: quotationId };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}
async function get(client, id) {
  const p = await repo.get(client, id);
  if (!p) return null;
  p.lines = await repo.listLines(client, id);
  p.narratives = await repo.listNarratives(client, id);
  return p;
}
const list = (client, q) => repo.list(client, q);
module.exports = { createDraft, updateDraft, transition, accept, get, list };
