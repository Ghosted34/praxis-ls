/**
 * Tax Jurisdiction + tax-code rate cards (MOD-07, KB §9/§10). Owns the
 * jurisdictions and their effective-dated tax codes (TVA, WHT, IS, minimum tax)
 * that account-determination and the Tax Center read. Codes are versioned by
 * effective date — you never edit a historical rate, you supersede it (a new row
 * whose effective_from opens where the prior one is expired). All SQL is in the
 * repo; validation is in the rules; event keys come from events.js.
 */
"use strict";

const repo = require("./tax_jurisdiction.repo");
const { atomically } = require("../../../shared/db/tx");
const events = require("./tax_jurisdiction.events");
const { assertRate, assertEffectiveWindow, pickEffective } = require("./tax_jurisdiction.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const jref = (id) => "tax_jurisdiction:" + id;
const cref = (id) => "tax_code:" + id;

async function createJurisdiction(client, { countryCode = "CM", name, currency = "XAF", actor = {} }) {
  await client.query("BEGIN");
  try {
    const row = await repo.insertJur(client, { country_code: countryCode, name, currency });
    await emitEvent(client, { eventTypeKey: events.JURISDICTION_CREATED, moduleKey: events.MODULE, entityRef: jref(row.jurisdiction_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.JURISDICTION_CREATED, moduleKey: events.MODULE, entityRef: jref(row.jurisdiction_id), after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function updateJurisdiction(client, { id, patch = {}, actor = {} }) {
  const before = await repo.getJur(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Jurisdiction not found", 404);
  const fields = {};
  for (const k of ["name", "currency", "country_code"]) if (patch[k] !== undefined) fields[k] = patch[k];
  const row = await repo.updateJur(client, id, fields);
  await emitEvent(client, { eventTypeKey: events.JURISDICTION_UPDATED, moduleKey: events.MODULE, entityRef: jref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.JURISDICTION_UPDATED, moduleKey: events.MODULE, entityRef: jref(id), before, after: row });
  return row;
}

async function setActive(client, { id, active, actor = {} }) {
  const before = await repo.getJur(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Jurisdiction not found", 404);
  if (!active) {
    const n = await repo.codeCount(client, id);
    if (n > 0) throw new AppError("IN_USE", "Cannot deactivate a jurisdiction that still has " + n + " tax code(s)", 409);
  }
  const row = await repo.updateJur(client, id, { is_active: active === true });
  await emitEvent(client, { eventTypeKey: events.JURISDICTION_DEACTIVATED, moduleKey: events.MODULE, entityRef: jref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: active ? "tax_jurisdiction.activated" : events.JURISDICTION_DEACTIVATED, moduleKey: events.MODULE, entityRef: jref(id), after: row });
  return row;
}

async function addCode(client, { jurisdictionId, code, kind, ratePercent = null, baseRule = null, appliesTo = null, recoverable = null, postsDebitAccount = null, postsCreditAccount = null, brackets = null, effectiveFrom = null, effectiveTo = null, legalReference = null, actor = {} }) {
  const jur = await repo.getJur(client, jurisdictionId);
  if (!jur) throw new AppError("NOT_FOUND", "Jurisdiction not found", 404);
  assertRate({ kind, ratePercent, brackets });
  assertEffectiveWindow({ effectiveFrom, effectiveTo });
  // atomically() joins an open transaction instead of opening a second one, so
  // supersedeCode can wrap expire+add as a single unit (DATA 5.4).
  return atomically(client, async () => {
    const row = await repo.insertCode(client, {
      jurisdiction_id: jurisdictionId, code, kind, rate_percent: ratePercent, base_rule: baseRule, applies_to: appliesTo,
      recoverable, posts_debit_account: postsDebitAccount, posts_credit_account: postsCreditAccount,
      brackets: brackets ? JSON.stringify(brackets) : null, effective_from: effectiveFrom || new Date().toISOString().slice(0, 10), effective_to: effectiveTo, legal_reference: legalReference,
    });
    await emitEvent(client, { eventTypeKey: events.CODE_CREATED, moduleKey: events.MODULE, entityRef: cref(row.tax_code_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CODE_CREATED, moduleKey: events.MODULE, entityRef: cref(row.tax_code_id), after: row });
    return row;
  });
}

/** Supersede a code: expire the current effective row and open a new one (never edit history). */
async function supersedeCode(client, { jurisdictionId, code, effectiveFrom, newRow, actor = {} }) {
  // DATA 5.4 (High). This used to COMMIT the expiry and only then call addCode,
  // which opened its own transaction. addCode runs assertRate BEFORE its BEGIN
  // and throws on a bad rate; it can also fail on insert. Either way the old
  // rate was already expired and the new one did not exist.
  //
  // The consequence is not subtle: for that (jurisdiction, code) there is then
  // NO row effective from that date, pickEffective throws NO_EFFECTIVE_CODE,
  // and EVERY INVOICE FROM THAT DATE FORWARD FAILS TO POST until someone
  // notices and inserts the row by hand. A tax-rate change is exactly the
  // operation performed under time pressure at a Finance Law boundary.
  //
  // Expire and replace are now one transaction: either the series is
  // continuous, or nothing changed.
  return atomically(client, async () => {
    const rows = await repo.codesByKey(client, jurisdictionId, code);
    const current = rows.find((r) => !r.effective_to);
    if (current) {
      const dayBefore = new Date(Date.parse(effectiveFrom) - 86400000).toISOString().slice(0, 10);
      await repo.updateCode(client, current.tax_code_id, { effective_to: dayBefore });
      await emitEvent(client, { eventTypeKey: events.CODE_EXPIRED, moduleKey: events.MODULE, entityRef: cref(current.tax_code_id), actorUserId: actor.user_id || null });
    }
    // Nested: joins this transaction rather than opening its own.
    return addCode(client, { jurisdictionId, code, effectiveFrom, ...newRow, actor });
  });
}

/** Read the tax code effective at a date (mirrors determination.effectiveTax). */
async function effectiveCode(client, { jurisdictionId, code, date = null }) {
  const rows = await repo.codesByKey(client, jurisdictionId, code);
  if (rows.length === 0) throw new AppError("NOT_FOUND", "No tax code " + code + " in this jurisdiction", 404);
  return pickEffective(rows, date || new Date().toISOString().slice(0, 10));
}

async function get(client, id) {
  const jur = await repo.getJur(client, id);
  if (!jur) return null;
  jur.tax_codes = await repo.listCodes(client, id);
  return jur;
}
const list = (client, q) => repo.listJur(client, q);
const listCodes = (client, jurisdictionId) => repo.listCodes(client, jurisdictionId);

module.exports = { createJurisdiction, updateJurisdiction, setActive, addCode, supersedeCode, effectiveCode, get, list, listCodes };
