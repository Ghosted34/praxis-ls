/**
 * Ledger posting engine — the real domain service (KB §22/§23).
 * Public surface:
 *   post(client, input)      build + (optionally) validate one balanced entry
 *   reverse(client, opts)    linked contra entry for a validated entry (#23.16)
 *   get(client, entryId)     entry + its lines
 *   list(client, query)      recent entries (journal_id/period_id/status filters)
 * buildAndInsert is the reusable primitive (assumes an open transaction) so
 * Phase-1 invoicing posts through the same path. The DB triggers in
 * 0220_ledger.sql are the final authority on balance/immutability.
 */
"use strict";

const repo = require("./journal_entry.repo");
const events = require("./journal_entry.events");
const { assertBalanced, assertNoCompensation } = require("./journal_entry.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const money = (v) => Number(v || 0).toFixed(2);

async function buildAndInsert(client, input) {
  const {
    journalId = null, journalCode = null, entityId, entryDate,
    description = null, sourceDocRef = null, source = "SYSTEM_AUTO",
    correctsEntryId = null, reversalReason = null, lines,
    validate = true, actor = {}, ip = null,
  } = input;

  if (!entityId) throw new AppError("ENTITY_REQUIRED", "entityId is required", 422);
  if (!entryDate) throw new AppError("DATE_REQUIRED", "entryDate is required", 422);
  assertBalanced(lines);
  assertNoCompensation(lines);

  const journal = await repo.getJournal(client, { journalId, journalCode, entityId });
  if (!journal) throw new AppError("UNKNOWN_JOURNAL", "No journal for " + (journalCode || journalId), 422);

  const period = await repo.getPeriodForDate(client, { entityId, date: entryDate });
  if (!period) throw new AppError("NO_PERIOD", "No accounting period covers " + entryDate, 422);
  if (period.status !== "OPEN") throw new AppError("PERIOD_NOT_OPEN", "Period " + period.code + " is " + period.status, 422);

  if (validate && !sourceDocRef) throw new AppError("SOURCE_DOC_REQUIRED", "A validated entry requires source_doc_ref", 422);

  await repo.lockSequence(client, journal.journal_id, period.period_id);
  const entryNo = await repo.nextEntryNo(client, journal.journal_id, period.period_id);

  const entry = await repo.insertEntry(client, {
    journal_id: journal.journal_id,
    entity_id: entityId,
    period_id: period.period_id,
    entry_no: entryNo,
    entry_date: entryDate,
    description,
    source_doc_ref: sourceDocRef,
    status: "draft",
    source,
    corrects_entry_id: correctsEntryId,
    reversal_reason: reversalReason,
    created_by: actor.user_id || null,
    ip,
  });

  const lineRows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    /// eslint-disable-next-line no-await-in-loop
    const row = await repo.insertLine(client, {
      entry_id: entry.entry_id,
      account_code: String(ln.account_code).trim(),
      debit: money(ln.debit),
      credit: money(ln.credit),
      dossier_id: ln.dossier_id || null,
      dictionary_item_id: ln.dictionary_item_id || null,
      is_debours: ln.is_debours === true,
      tax_code_id: ln.tax_code_id || null,
      currency: ln.currency || "XAF",
      fx_rate: ln.fx_rate || 1,
      line_no: i + 1,
    });
    lineRows.push(row);
  }

  let finalEntry = entry;
  if (validate) {
    finalEntry = await repo.setStatus(client, entry.entry_id, {
      status: "validated",
      validated_at: new Date().toISOString(),
    });
  }

  const eventKey = correctsEntryId ? events.REVERSED : events.POSTED;
  await emitEvent(client, {
    eventTypeKey: eventKey, moduleKey: events.MODULE,
    entityRef: "journal_entry:" + entry.entry_id, actorUserId: actor.user_id || null,
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: eventKey, moduleKey: events.MODULE,
    entityRef: "journal_entry:" + entry.entry_id, after: finalEntry, ip,
  });

  return { entry: finalEntry, lines: lineRows };
}

async function post(client, input) {
  await client.query("BEGIN");
  try {
    const result = await buildAndInsert(client, input);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function reverse(client, { entryId, reason = null, entryDate = null, actor = {}, ip = null }) {
  await client.query("BEGIN");
  try {
    const original = await repo.getEntry(client, entryId);
    if (!original) throw new AppError("NOT_FOUND", "Entry not found", 404);
    if (original.status !== "validated") throw new AppError("NOT_REVERSIBLE", "Only a validated entry can be reversed", 422);
    // #23.16 one reversal per entry — never over-reverse. (The DB unique index
    // ux_one_reversal_per_entry is the final authority; this is the friendly 409.)
    const existing = await client.query(
      "SELECT 1 FROM journal_entry WHERE corrects_entry_id = $1 AND status = 'validated' LIMIT 1",
      [entryId],
    );
    if (existing.rows.length) throw new AppError("ALREADY_REVERSED", "Entry has already been reversed", 409);
    const origLines = await repo.listLines(client, entryId);
    const contra = origLines.map((l) => ({
      account_code: l.account_code,
      debit: Number(l.credit),
      credit: Number(l.debit),
      dossier_id: l.dossier_id,
      dictionary_item_id: l.dictionary_item_id,
      is_debours: l.is_debours,
      tax_code_id: l.tax_code_id,
      currency: l.currency,
      fx_rate: l.fx_rate,
    }));
    const result = await buildAndInsert(client, {
      journalId: original.journal_id,
      entityId: original.entity_id,
      entryDate: entryDate || new Date().toISOString().slice(0, 10),
      description: "Reversal of entry " + original.entry_no + (reason ? ": " + reason : ""),
      sourceDocRef: original.source_doc_ref,
      source: "HUMAN_CORRECTION",
      correctsEntryId: original.entry_id,
      reversalReason: reason,
      lines: contra,
      validate: true,
      actor,
      ip,
    });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function get(client, entryId) {
  const entry = await repo.getEntry(client, entryId);
  if (!entry) return null;
  entry.lines = await repo.listLines(client, entryId);
  return entry;
}

/** One page of entries plus the filter total, for `X-Total-Count`. */
const listPaged = (client, query) => repo.listEntries(client, query);

/** Bare array — kept for non-HTTP callers that expect a list, not an envelope. */
const list = async (client, query) => (await repo.listEntries(client, query)).rows;

module.exports = { post, reverse, get, list, listPaged, buildAndInsert };