/**
 * Régie d'avance (MOD-49, KB §6.8). Issue posts Dr 581 / Cr 521. Aging past the
 * policy window reclassifies the OPEN balance Dr 4211 / Cr 581 (a receivable from
 * the holder) — never auto-allocated to 4731. Aging is idempotent and safe to run
 * repeatedly (the worker / an admin trigger calls ageDue).
 */
"use strict";

const repo = require("./regie.repo");
const events = require("./regie.events");
const { openBalance, isAged } = require("./regie.rules");
const journalEntry = require("../../finance/journal_entry/journal_entry.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { getRule } = require("../../../shared/config/settings");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");

async function issue(client, opts) {
  const {
    holderUserId = null, amount, entityId, entryDate, sourceDocRef,
    treasuryCoa = "521", regieCoa = "581", policyWindowDays = null, actor = {}, ip = null,
  } = opts;
  if (!(Number(amount) > 0)) throw new AppError("BAD_AMOUNT", "amount must be > 0", 422);
  // Business rule read from tenant settings (finance.regie.policy_window_days), fallback 7.
  const windowDays = typeof policyWindowDays === "number" ? policyWindowDays : await getRule(client, "finance", "regie", "policy_window_days", 7);

  await client.query("BEGIN");
  try {
    const { entry } = await journalEntry.buildAndInsert(client, {
      journalCode: "BQ", entityId, entryDate,
      description: "Régie d'avance issued", sourceDocRef, source: "SYSTEM_RULE",
      lines: [
        { account_code: regieCoa, debit: amount, credit: 0 },
        { account_code: treasuryCoa, debit: 0, credit: amount },
      ],
      validate: true, actor, ip,
    });
    // Allocate the number BEFORE insert so it persists on the row (doc_number),
    // rather than being computed and thrown away.
    const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId, date: entryDate });
    const advance = await repo.insertAdvance(client, {
      holder_user_id: holderUserId, amount, issued_on: entryDate,
      policy_window_days: windowDays, issue_entry_id: entry.entry_id, state: "ISSUED",
      doc_number: number,
    });
    await documents.capture(client, { entityRef: "regie_advance:" + advance.regie_advance_id, docType: "REGIE_ADVANCE", status: "VERIFIED" });
    await emitEvent(client, { eventTypeKey: events.ISSUED, moduleKey: events.MODULE, entityRef: "regie_advance:" + advance.regie_advance_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ISSUED, moduleKey: events.MODULE, entityRef: "regie_advance:" + advance.regie_advance_id, after: advance, ip });
    await client.query("COMMIT");
    return { entry, advance };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/** Reclassify one advance's open balance 581 -> 4211. Idempotent per advance. */
async function ageOne(client, advance, opts) {
  const { entityId, entryDate, sourceDocRef, holderReceivableCoa = "4211", regieCoa = "581", actor = {}, ip = null } = opts;
  const open = openBalance(advance);
  if (open <= 0) return null;

  await client.query("BEGIN");
  try {
    await journalEntry.buildAndInsert(client, {
      journalCode: "OD", entityId, entryDate,
      description: "Régie d'avance aged — reclassified to holder receivable", sourceDocRef, source: "SYSTEM_RULE",
      lines: [
        { account_code: holderReceivableCoa, debit: open, credit: 0 },
        { account_code: regieCoa, debit: 0, credit: open },
      ],
      validate: true, actor, ip,
    });
    const updated = await repo.setState(client, advance.regie_advance_id, { state: "AGED_UNJUSTIFIED" });
    await emitEvent(client, { eventTypeKey: events.AGED, moduleKey: events.MODULE, entityRef: "regie_advance:" + advance.regie_advance_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.AGED, moduleKey: events.MODULE, entityRef: "regie_advance:" + advance.regie_advance_id, after: updated, ip });
    await client.query("COMMIT");
    return updated;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/** Age every advance past its window. `today` defaults to now (YYYY-MM-DD). */
async function ageDue(client, opts) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const candidates = await repo.listAgeable(client);
  const aged = [];
  for (const adv of candidates) {
    if (!isAged(adv, today)) continue;
    /// eslint-disable-next-line no-await-in-loop
    const res = await ageOne(client, adv, { ...opts, entryDate: opts.entryDate || today });
    if (res) aged.push(adv.regie_advance_id);
  }
  return { aged, count: aged.length };
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);

module.exports = { issue, ageOne, ageDue, get, list };