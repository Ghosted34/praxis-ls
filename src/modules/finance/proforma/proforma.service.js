/**
 * Proforma & customer advances (MOD-50, KB §7/§8.1). A proforma is NOT revenue;
 * a payment on it is a LIABILITY (customer advance, 4191): Dr <treasury> / Cr 4191,
 * cleared later by the final invoice. All SQL is in proforma.repo.
 */
"use strict";

const repo = require("./proforma.repo");
const events = require("./proforma.events");
const journalEntry = require("../journal_entry/journal_entry.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const { AppError } = require("../../../utils/errors");

async function recordPayment(client, opts) {
  const {
    entityId, clientId = null, dossierId = null, amount,
    treasuryCoa = "521", advanceAccount = "4191",
    entryDate, sourceDocRef, actor = {}, ip = null,
  } = opts;
  if (!(Number(amount) > 0)) throw new AppError("BAD_AMOUNT", "amount must be > 0", 422);

  await client.query("BEGIN");
  try {
    const { entry } = await journalEntry.buildAndInsert(client, {
      journalCode: "BQ", entityId, entryDate,
      description: "Customer advance received (proforma)", sourceDocRef, source: "SYSTEM_RULE",
      lines: [
        { account_code: treasuryCoa, debit: amount, credit: 0, dossier_id: dossierId },
        { account_code: advanceAccount, debit: 0, credit: amount, dossier_id: dossierId },
      ],
      validate: true, actor, ip,
    });
    const advance = await repo.insertAdvance(client, { client_id: clientId, dossier_id: dossierId, amount, entry_id: entry.entry_id });
    const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId, date: entryDate });
    await documents.capture(client, { entityRef: "advance:" + advance.advance_id, docType: "PROFORMA_ADVANCE", status: "VERIFIED" });
    advance.doc_number = number;
    await emitEvent(client, { eventTypeKey: events.PAID, moduleKey: events.MODULE, entityRef: "advance:" + advance.advance_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.PAID, moduleKey: events.MODULE, entityRef: "advance:" + advance.advance_id, after: advance, ip });
    await client.query("COMMIT");
    return { entry, advance };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

const get = (client, id) => repo.getAdvance(client, id);
/** One page of advances plus the filter total, for `X-Total-Count`. */
const listPaged = (client, q) => repo.listAdvances(client, q);

/** Bare array — kept for non-HTTP callers that expect a list, not an envelope. */
const list = async (client, q) => (await repo.listAdvances(client, q)).rows;

module.exports = { recordPayment, get, list, listPaged };
