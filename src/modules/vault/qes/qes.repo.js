/**
 * QES repository (MOD-64) — the envelope and the usage ledger.
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §7.3.
 *
 * The only place with SQL for `qes_envelope` and `signature_usage_ledger`,
 * per doc/CONVENTIONS.md. The two live in one repo because they are one
 * transaction: the ledger row is written in the same transaction as the
 * envelope's provider_ref (charge on issue, §7.4 step 3), and a repo split
 * would split the transaction's owner.
 *
 * An envelope is UPDATED as the provider moves it along (that is the point
 * of mirroring a state we do not own) — unlike document_signature, which is
 * insert-only. The ledger row, by contrast, is never updated except to stamp
 * billed_at/invoice_ref when it lands on an invoice: a meter reading is a
 * fact, not a draft.
 */
"use strict";

const { insertOne, updateOne, ident } = require("../../../shared/db/query-helpers");

const ENVELOPE_COLS = `envelope_id, request_id, party_id, provider_key, provider_ref,
  status, audit_vault_id, signed_vault_id, last_error, created_at, updated_at`;

const LEDGER_COLS = `usage_id, envelope_id, request_id, entity_ref, provider_key,
  provider_ref, unit_fee, currency, billed_at, invoice_ref, created_at`;

// ── envelopes ──────────────────────────────────────────────────────────────

const insertEnvelope = (client, data) => insertOne(client, "qes_envelope", data);

async function getEnvelope(client, id) {
  const { rows } = await client.query(
    `SELECT ${ENVELOPE_COLS} FROM qes_envelope WHERE envelope_id = $1`, [id],
  );
  return rows[0] || null;
}

/** The webhook's lookup: by the provider's own document id. */
async function getEnvelopeByProviderRef(client, providerKey, providerRef) {
  const { rows } = await client.query(
    `SELECT ${ENVELOPE_COLS} FROM qes_envelope WHERE provider_key = $1 AND provider_ref = $2`,
    [providerKey, providerRef],
  );
  return rows[0] || null;
}

/**
 * An in-flight envelope for a party, if any. The friendly half of the
 * "one at a time" rule: a second /complete with CERTIFIED reads this and
 * answers 409 instead of relying on the index to shout.
 */
async function getActiveForParty(client, partyId) {
  const { rows } = await client.query(
    `SELECT ${ENVELOPE_COLS} FROM qes_envelope
      WHERE party_id = $1 AND status IN ('CREATING','SENT')
      ORDER BY created_at DESC LIMIT 1`,
    [partyId],
  );
  return rows[0] || null;
}

/** Every in-flight envelope on a request — the void path cancels these. */
async function listActiveForRequest(client, requestId) {
  const { rows } = await client.query(
    `SELECT ${ENVELOPE_COLS} FROM qes_envelope
      WHERE request_id = $1 AND status IN ('CREATING','SENT')
      ORDER BY created_at`,
    [requestId],
  );
  return rows;
}

/**
 * The poll backstop's working set (§7.4 step 6): non-terminal and older than
 * the given age, so a webhook that has merely not arrived yet is not polled
 * mid-handshake. `CREATING` rows with no provider_ref are the create call
 * whose answer was lost — the poll marks those FAILED.
 */
async function listStaleOpen(client, olderThanHours) {
  const { rows } = await client.query(
    `SELECT ${ENVELOPE_COLS} FROM qes_envelope
      WHERE status IN ('CREATING','SENT')
        AND created_at < now() - ($1::int * interval '1 hour')
      ORDER BY created_at
      LIMIT 100`,
    [olderThanHours],
  );
  return rows;
}

const updateEnvelope = (client, id, patch) =>
  updateOne(client, "qes_envelope", "envelope_id", id, patch, ENVELOPE_COLS);

/**
 * Move an envelope to a status, but only from one it is allowed to leave.
 *
 * The same reasoning as signature_request.transitionRequest: the webhook and
 * the poll can arrive at the same instant for the same envelope, and without
 * the guard both would write COMPLETED, both would fetch the PDF, and both
 * would write a signature row. The UPDATE ... WHERE status = ANY($3) makes
 * the second a no-op that returns no row.
 */
async function transitionEnvelope(client, id, status, expected, extra = {}) {
  const sets = ["status = $2"];
  const params = [id, status];
  for (const [col, value] of Object.entries(extra)) {
    params.push(value);
    sets.push(`${ident(col)} = $${params.length}`);
  }
  params.push(expected);
  const { rows } = await client.query(
    `UPDATE qes_envelope SET ${sets.join(", ")}
      WHERE envelope_id = $1 AND status = ANY($${params.length})
      RETURNING ${ENVELOPE_COLS}`,
    params,
  );
  return rows[0] || null;
}

/** Serialise completion for one envelope. Advisory, transaction-scoped. */
function lockEnvelope(client, envelopeId) {
  return client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["qes:envelope:" + envelopeId]);
}

// ── usage ledger ───────────────────────────────────────────────────────────

const insertLedgerRow = (client, data) => insertOne(client, "signature_usage_ledger", data);

/**
 * One ledger row per issued envelope, in the CALLER's transaction.
 *
 * The caller runs this in the same transaction that sets provider_ref, and
 * that pairing is the whole of §7.4 step 3: `provider_ref NOT NULL` makes
 * "charged without an envelope" unrepresentable, so a provider failure (no
 * ref, rollback) leaves zero rows rather than a row that must be remembered
 * to delete.
 */
async function chargeForEnvelope(client, { envelopeId, requestId, entityRef, providerKey, providerRef, unitFee, currency }) {
  if (!providerRef) {
    // Defense in depth for the NOT NULL column: a caller that tried to
    // charge without an envelope ref is a bug this function exists to make
    // impossible, and it should fail here, in a named error, not at the
    // constraint with a 23502.
    throw new Error("chargeForEnvelope requires a provider_ref — charge on issue, and only on issue");
  }
  return insertLedgerRow(client, {
    envelope_id: envelopeId,
    request_id: requestId,
    entity_ref: entityRef,
    provider_key: providerKey,
    provider_ref: providerRef,
    unit_fee: unitFee,
    currency,
  });
}

/** This tenant's envelopes issued in a calendar month — the usage panel and the quota sweep. */
async function countForMonth(client, { year, month }) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n, coalesce(sum(unit_fee), 0) AS total_fee, max(currency) AS currency
       FROM signature_usage_ledger
      WHERE date_trunc('month', created_at) = make_date($1, $2, 1)`,
    [year, month],
  );
  return rows[0];
}

/** The envelope's ledger row, if any. Null until the envelope was issued. */
async function ledgerForEnvelope(client, envelopeId) {
  const { rows } = await client.query(
    `SELECT ${LEDGER_COLS} FROM signature_usage_ledger WHERE envelope_id = $1`, [envelopeId],
  );
  return rows[0] || null;
}

module.exports = {
  insertEnvelope, getEnvelope, getEnvelopeByProviderRef, getActiveForParty,
  listActiveForRequest, listStaleOpen, updateEnvelope, transitionEnvelope, lockEnvelope,
  insertLedgerRow, chargeForEnvelope, countForMonth, ledgerForEnvelope,
};
