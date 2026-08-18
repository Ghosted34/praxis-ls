"use strict";
const { insertOne, getById, updateOne } = require("../../../shared/db/query-helpers");

/**
 * Columns a caller may write on an advance. Everything else — the two cached
 * totals, the entry ids, doc_number — is SYSTEM-DERIVED and set by the service
 * from recomputed values, never taken from a request body. See the mass
 * assignment note in query-helpers.
 */
const ADVANCE_WRITABLE = new Set([
  "holder_user_id", "amount", "currency", "exchange_rate_to_xaf",
  "issued_on", "policy_window_days", "state", "doc_number",
  "issue_entry_id", "aged_entry_id", "entity_id", "closed_on",
  "justified_amount", "returned_amount",
]);

const RETIREMENT_WRITABLE = new Set([
  "regie_advance_id", "kind", "dossier_id", "amount",
  "proof_vault_id", "entry_id", "memo", "retired_on", "created_by",
]);

const insertAdvance = (client, data) => insertOne(client, "regie_advance", data, "*", ADVANCE_WRITABLE);
const get = (client, id) => getById(client, "regie_advance", "regie_advance_id", id);

/**
 * Lock one advance for update.
 *
 * REQUIRED before any retirement. The totals are recomputed from the child rows
 * rather than incremented, and that is only correct if the read and the write
 * are serialised — two receipts filed at the same instant would otherwise both
 * read the same pre-insert total and the second would overwrite the first.
 * `issue` and `ageOne` never needed this because they touch one row once.
 */
async function getForUpdate(client, id) {
  const { rows } = await client.query(
    "SELECT * FROM regie_advance WHERE regie_advance_id = $1 FOR UPDATE",
    [id],
  );
  return rows[0] || null;
}

async function list(client, q = {}) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  const params = [limit, offset];
  const wh = [];
  if (q.state) { params.push(q.state); wh.push("state = $" + params.length); }
  if (q.holder_user_id) { params.push(q.holder_user_id); wh.push("holder_user_id = $" + params.length); }
  // `open=true` — the watchlist / "my advances" filter. Expressed against the
  // stored totals so the database does the arithmetic, matching openBalance().
  if (q.open === "true" || q.open === true) {
    wh.push("(amount - justified_amount - returned_amount) > 0");
  }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    "SELECT * FROM regie_advance " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

async function listAgeable(client) {
  const { rows } = await client.query(
    "SELECT * FROM regie_advance WHERE state IN ('ISSUED','PARTIALLY_JUSTIFIED')",
  );
  return rows;
}

async function setState(client, id, patch) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and writable allow-list in query-helpers.
  return updateOne(client, "regie_advance", "regie_advance_id", id, patch, "*", ADVANCE_WRITABLE);
}

const insertRetirement = (client, data) =>
  insertOne(client, "regie_retirement", data, "*", RETIREMENT_WRITABLE);

/** Every retirement of one advance, oldest first — the detail view's ledger. */
async function listRetirements(client, advanceId) {
  const { rows } = await client.query(
    "SELECT * FROM regie_retirement WHERE regie_advance_id = $1 ORDER BY retired_on, created_at",
    [advanceId],
  );
  return rows;
}

module.exports = {
  insertAdvance, get, getForUpdate, list, listAgeable, setState,
  insertRetirement, listRetirements,
  ADVANCE_WRITABLE, RETIREMENT_WRITABLE,
};
