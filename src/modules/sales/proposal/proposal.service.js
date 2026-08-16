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
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const crypto = require("crypto");
const { config } = require("../../../config/env");
const pdf = require("../../../services/pdf.service");
const vault = require("../../vault/document_vault/document_vault.service");
const proposalDocument = require("./proposal.document");
const ref = (id) => "proposal:" + id;
const HEADER_FIELDS = [
  "lead_id", "client_id", "opportunity_id", "title", "language", "currency",
  "service_category", "incoterm", "origin_location", "destination_location",
  "cargo_description", "estimated_weight", "project_cargo_flag",
  "customs_clearance_target", "transit_time_target", "free_days_demurrage",
  "payment_conditions", "validity_days", "converted_client_id",
];
const headerFields = (data) => Object.fromEntries(
  HEADER_FIELDS.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]),
);

async function replaceChildren(client, id, lines, narratives) {
  if (Array.isArray(lines)) {
    await repo.deleteLines(client, id);
    for (const l of lines) {   await repo.insertLine(client, { proposal_id: id, dictionary_item_id: l.dictionary_item_id || null, label: l.label || "Line", qty: l.qty || 1, unit_price: l.unit_price || 0 }); }
  }
  if (Array.isArray(narratives)) {
    await repo.deleteNarratives(client, id);
    for (let i = 0; i < narratives.length; i += 1) { const n = narratives[i];   await repo.insertNarrative(client, { proposal_id: id, section: n.section, language: n.language || "EN", body: n.body || "", sort_order: n.sort_order ?? i, raw_client_operations: n.raw_client_operations || null, raw_pain_points: n.raw_pain_points || null, raw_proposed_strategy: n.raw_proposed_strategy || null, raw_tone: n.raw_tone || null }); }
  }
}
async function createDraft(client, { data, actor = {} }) {
  await client.query("BEGIN");
  try {
    const p = await repo.insert(client, { ...headerFields(data), status: "DRAFT", ai_generated: false });
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
    Object.assign(fields, headerFields(patch));
    if (Object.keys(fields).length) await repo.update(client, id, fields);
    await replaceChildren(client, id, lines, narratives);
    const after = await get(client, id);
    await audit(client, { actorUserId: actor.user_id || null, action: "proposal.updated", moduleKey: events.MODULE, entityRef: ref(id), before, after });
    await client.query("COMMIT");
    return after;
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
    if (to === "SENT") {
      const full = await get(client, id); const clientRow = full.client_id ? (await client.query("SELECT name, legal_name FROM client_master WHERE client_id=$1", [full.client_id])).rows[0] : null;
      await pdf.renderAndStore(client, { html: proposalDocument.html({ proposal: { ...full, ...fields }, lines: full.lines, narratives: full.narratives, client: clientRow }), key: `proposals/${id}.pdf`, entityRef: ref(id), docType: "PROPOSAL" });
      const captured = await vault.getByRef(client, ref(id));
      if (captured) await repo.update(client, id, { pdf_vault_id: captured.doc_id });
    }
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
      await repo.update(client, id, { converted_quote_id: quotationId });
    }
    await emitEvent(client, { eventTypeKey: events.ACCEPTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ACCEPTED, moduleKey: events.MODULE, entityRef: ref(id), after: { quotation_id: quotationId } });
    await client.query("COMMIT");
    return { proposal: row, quotation_id: quotationId };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

function signedToken(){const raw=crypto.randomBytes(32).toString("base64url");const sig=crypto.createHmac("sha256",config.JWT_SECRET).update(raw).digest("base64url");return `${raw}.${sig}`;}
async function share(client,{id,expiresInDays=30,actor={}}){const before=await repo.get(client,id);if(!before)throw new AppError("NOT_FOUND","Proposal not found",404);if(before.status!=="SENT")throw new AppError("NOT_SENT","Only a sent proposal can be shared",422);const token=signedToken();const expires=new Date(Date.now()+expiresInDays*86400000);await repo.update(client,id,{share_token_hash:crypto.createHash("sha256").update(token).digest("hex"),share_expires_at:expires,share_revoked_at:null});await audit(client,{actorUserId:actor.user_id||null,action:"proposal.shared",moduleKey:events.MODULE,entityRef:ref(id),after:{expires_at:expires}});return{token,expires_at:expires,path:`/public/proposals/${encodeURIComponent(token)}`};}
async function revokeShare(client,{id,actor={}}){const before=await repo.get(client,id);if(!before)throw new AppError("NOT_FOUND","Proposal not found",404);const row=await repo.update(client,id,{share_revoked_at:new Date()});await audit(client,{actorUserId:actor.user_id||null,action:"proposal.share_revoked",moduleKey:events.MODULE,entityRef:ref(id),after:{share_revoked_at:row.share_revoked_at}});return row;}
async function get(client, id) {
  const p = await repo.get(client, id);
  if (!p) return null;
  p.lines = await repo.listLines(client, id);
  p.narratives = await repo.listNarratives(client, id);
  return p;
}
const list = (client, q) => repo.list(client, q);
module.exports = { createDraft, updateDraft, transition, accept, share, revokeShare, get, list, signedToken };
