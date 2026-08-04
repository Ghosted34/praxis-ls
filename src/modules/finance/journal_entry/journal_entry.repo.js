/**
 * Journal-entry repository — the real SQL for the ledger posting engine.
 * (Replaces the generic makeRepo, which could not build a valid multi-line
 * balanced entry or assign entry_no. See doc/PHASE1_ACCOUNTING_AUDIT.md.)
 * All functions take an already-open tenant client so the service can run the
 * whole post inside one transaction.
 */
"use strict";

const { insertOne, getById, page, TOTAL_COL, splitTotal } = require("../../../shared/db/query-helpers");

async function getJournal(client, { journalId, journalCode, entityId }) {
  if (journalId) {
    const { rows } = await client.query("SELECT * FROM journal WHERE journal_id = $1", [journalId]);
    return rows[0] || null;
  }
  const { rows } = await client.query(
    "SELECT * FROM journal WHERE code = $1 AND (entity_id = $2 OR entity_id IS NULL) ORDER BY entity_id NULLS LAST LIMIT 1",
    [journalCode, entityId],
  );
  return rows[0] || null;
}

async function getPeriodForDate(client, { entityId, date }) {
  const { rows } = await client.query(
    "SELECT * FROM accounting_period WHERE entity_id = $1 AND $2::date BETWEEN starts_on AND ends_on ORDER BY starts_on DESC LIMIT 1",
    [entityId, date],
  );
  return rows[0] || null;
}

async function lockSequence(client, journalId, periodId) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [journalId + ":" + periodId]);
}

async function nextEntryNo(client, journalId, periodId) {
  const { rows } = await client.query(
    "SELECT COALESCE(MAX(entry_no), 0) + 1 AS n FROM journal_entry WHERE journal_id = $1 AND period_id = $2",
    [journalId, periodId],
  );
  return rows[0].n;
}

function insertEntry(client, data) {
  return insertOne(client, "journal_entry", data);
}

function insertLine(client, data) {
  return insertOne(client, "journal_line", data);
}

async function setStatus(client, entryId, patch) {
  const keys = Object.keys(patch);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE journal_entry SET " + set + " WHERE entry_id = $1 RETURNING *",
    [entryId, ...keys.map((k) => patch[k])],
  );
  return rows[0] || null;
}

const getEntry = (client, id) => getById(client, "journal_entry", "entry_id", id);

async function listLines(client, entryId) {
  const { rows } = await client.query(
    "SELECT * FROM journal_line WHERE entry_id = $1 ORDER BY line_no ASC",
    [entryId],
  );
  return rows;
}

/**
 * One page of journal entries, plus how many match the filter in total.
 *
 * `q` searches source_doc_ref and source — the two fields the Finance hub's
 * Journals tab filters on, previously done in the browser over a set already
 * clamped to 50.
 *
 * The limit/offset clamp now comes from the shared `page()` rather than a
 * hand-copied pair of Math.min/Math.max lines that had drifted here.
 *
 * @returns {Promise<{rows: Array<object>, total: number}>}
 */
async function listEntries(client, q = {}) {
  const { limit, offset } = page(q);
  const wh = [];
  const params = [limit, offset];
  if (q.journal_id) { params.push(q.journal_id); wh.push("journal_id = $" + params.length); }
  if (q.period_id) { params.push(q.period_id); wh.push("period_id = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.q) {
    params.push("%" + q.q + "%");
    const p = "$" + params.length;
    wh.push(`(source_doc_ref ILIKE ${p} OR source ILIKE ${p})`);
  }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT *, ${TOTAL_COL} FROM journal_entry ` + where +
      " ORDER BY entry_date DESC, entry_no DESC LIMIT $1 OFFSET $2",
    params,
  );
  return splitTotal(rows);
}

module.exports = {
  getJournal, getPeriodForDate, lockSequence, nextEntryNo,
  insertEntry, insertLine, setStatus, getEntry, listLines, listEntries,
};
