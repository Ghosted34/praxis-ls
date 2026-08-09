"use strict";
const repo = require("./financial_dictionary.repo");
const events = require("./financial_dictionary.events");
const rules = require("./financial_dictionary.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");

// The only columns a caller may write on dictionary_item. `code`, ids and the
// timestamps are server-owned; picking an explicit set (never spreading the
// whole row) is what keeps update from rewriting created_at or the PK.
const ITEM_COLS = [
  "label_fr", "label_en", "description", "category", "direction", "subcategory",
  "unit_of_measure", "applicability_mode", "is_debours", "is_billable",
  "default_price", "currency", "shipping_line", "provider_kind", "proof_source",
  "requires_justification", "receipt_requirement", "debours_vat_transparent",
  "is_active", "service_type_key",
];

const listItems = (c, q) => repo.listItems(c, q);

async function get(c, id) {
  const item = await repo.getItem(c, id);
  if (!item) return null;
  item.posting_rules = await repo.listRules(c, id);
  item.service_tiers = await repo.listTiers(c, id);
  return item;
}

/** Item + rules + tiers + usage + a compliance summary — the 360 payload. */
async function dossier(c, id) {
  const item = await get(c, id);
  if (!item) return null;
  const usage = await repo.usageCounts(c, id);
  const compliance = {
    requires_justification: !!item.requires_justification,
    receipt_requirement: item.receipt_requirement,
    proof_source: item.proof_source || null,
    is_debours: !!item.is_debours,
    debours_vat_transparent: !!item.debours_vat_transparent,
    // A billable item that always needs a receipt but names no valid source is
    // the onboarding gap the 360 should surface (not a hard failure).
    needs_attention: rules.needsAttention(item),
  };
  return { item, posting_rules: item.posting_rules, service_tiers: item.service_tiers, usage, compliance };
}

function pickItem(src) {
  const out = {};
  for (const k of ITEM_COLS) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

// A débours line always carries the débours flag; the code letter follows the
// direction — one source of truth for both (financial_dictionary.rules).
function normalise(data) {
  const direction = data.direction || "EXPENSE";
  const itemData = pickItem(data);
  itemData.direction = direction;
  itemData.is_debours = rules.resolveDebours(direction, data.is_debours);
  return { itemData, posting_rules: data.posting_rules || [], service_tiers: data.service_tiers || [] };
}

function withCreateDefaults(item) {
  return {
    applicability_mode: "ANY_OPERATIONS",
    receipt_requirement: "NOT_REQUIRED",
    currency: "XAF",
    is_billable: true,
    is_active: true,
    requires_justification: false,
    debours_vat_transparent: true,
    ...item,
  };
}

// Keep the legacy single-value service_type_key in step with the tiers so the
// Service-Type 360 (which still reads the column) stays correct until PR2 cuts
// it over to the join.
const primaryServiceKey = rules.primaryServiceKey;

function ruleRow(r, itemId, itemDebours) {
  return {
    dictionary_item_id: itemId,
    applies_context: r.applies_context,
    debit_account: r.debit_account || null,
    credit_account: r.credit_account || null,
    tax_code_id: r.tax_code_id || null,
    is_debours: r.is_debours ?? itemDebours,
  };
}

const isUniqueViolation = (err) => err && err.code === "23505";

async function create(c, { data, actor }) {
  const { itemData, posting_rules, service_tiers } = normalise(data);
  if (posting_rules.length === 0) { const e = new Error("a dictionary item requires at least one posting rule (KB §4)"); e.status = 422; throw e; }
  const base = withCreateDefaults(itemData);

  // Retry the whole transaction on the (rare) code collision — two creates for
  // the same direction can mint the same serial before either commits.
  for (let attempt = 0; attempt < 6; attempt++) {
    await c.query("BEGIN");
    try {
      const row = { ...base, code: await repo.nextCode(c, base.direction), service_type_key: primaryServiceKey(service_tiers) };
      const item = await repo.createItem(c, row);
      for (const r of posting_rules) await repo.createRule(c, ruleRow(r, item.dictionary_item_id, item.is_debours));
      if (service_tiers.length) await repo.replaceTiers(c, item.dictionary_item_id, service_tiers);
      await c.query("COMMIT");
      await emitEvent(c, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, actorUserId: actor.user_id });
      await audit(c, { actorUserId: actor.user_id, action: events.CREATED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, after: item });
      return get(c, item.dictionary_item_id);
    } catch (err) {
      await c.query("ROLLBACK");
      if (isUniqueViolation(err) && attempt < 5) continue; // remint and retry
      throw err;
    }
  }
  const e = new Error("could not allocate a unique code, please retry"); e.status = 409; throw e;
}

async function update(c, { id, patch, actor }) {
  const before = await repo.getItem(c, id);
  if (!before) return null;
  const merged = { ...before, ...patch };
  const { itemData, posting_rules, service_tiers } = normalise(merged);
  const rulesSent = Array.isArray(patch.posting_rules);
  const tiersSent = Array.isArray(patch.service_tiers);
  if (rulesSent && posting_rules.length === 0) { const e = new Error("a dictionary item requires at least one posting rule (KB §4)"); e.status = 422; throw e; }
  if (tiersSent) itemData.service_type_key = primaryServiceKey(service_tiers);

  await c.query("BEGIN");
  try {
    const row = await repo.updateItem(c, id, itemData);
    if (rulesSent) {
      await repo.deleteRules(c, id);
      for (const r of posting_rules) await repo.createRule(c, ruleRow(r, id, row ? row.is_debours : before.is_debours));
    }
    if (tiersSent) await repo.replaceTiers(c, id, service_tiers);
    await emitEvent(c, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: `dict:${before.code}`, actorUserId: actor.user_id });
    await audit(c, { actorUserId: actor.user_id, action: events.UPDATED, moduleKey: events.MODULE, entityRef: `dict:${before.code}`, before, after: row });
    await c.query("COMMIT");
    return get(c, id);
  } catch (err) { await c.query("ROLLBACK"); throw err; }
}

/* ── dictionary_ref registry (dropdown values, gear-modal editable) ─────────── */
const listRefs = (c, kind, includeInactive) => repo.listRefs(c, kind, includeInactive);

async function createRef(c, { data, actor }) {
  const row = await repo.createRef(c, { ...data, code: String(data.code).toUpperCase() });
  await audit(c, { actorUserId: actor.user_id, action: "dictionary_ref.created", moduleKey: events.MODULE, entityRef: `ref:${row.kind}:${row.code}`, after: row });
  return row;
}
async function updateRef(c, { id, patch, actor }) {
  const before = await repo.getRef(c, id);
  if (!before) return null;
  if (before.is_system && (patch.code || patch.kind)) { const e = new Error("a system reference's code/kind cannot be changed"); e.status = 422; throw e; }
  const row = await repo.updateRef(c, id, patch);
  await audit(c, { actorUserId: actor.user_id, action: "dictionary_ref.updated", moduleKey: events.MODULE, entityRef: `ref:${before.kind}:${before.code}`, before, after: row });
  return row;
}

module.exports = { listItems, get, dossier, create, update, listRefs, createRef, updateRef };
