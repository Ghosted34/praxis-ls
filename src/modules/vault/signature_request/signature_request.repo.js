/**
 * Signature-request repository (MOD-64) — the chain, its parties, and the OTP
 * challenges they clear. doc/SIGNATURE_ENGINEERING_GUIDE.md §6.2.
 *
 * The only place with SQL for `signature_request`, `signature_party` and
 * `signature_otp`, per doc/CONVENTIONS.md. The three live in one repo because
 * they are one aggregate: a party without its request is meaningless, and a
 * challenge without its party has nothing to prove.
 *
 * Every constraint this file relies on is declared in 10781–10783. Where a rule
 * could be enforced here OR in the database, it is in the database — the Q7
 * one-override cap especially, because a validator is a thing a future import
 * path forgets to call.
 */
"use strict";

const { insertOne, updateOne } = require("../../../shared/db/query-helpers");

const REQ_COLS = `request_id, entity_ref, doc_type, document_vault_id, payload_version,
  content_hash, allowed_presets, status, message, expires_at, completed_at,
  certificate_doc_id, last_reminder_at, reminder_count, created_by, created_at, updated_at`;

const PARTY_COLS = `party_id, request_id, sequence_no, party_kind, source, source_ref,
  override_by_user_id, override_reason, full_name, party_role, email, language,
  allowed_presets, status, decline_reason, sign_token_hmac, sign_expires_at,
  sent_at, viewed_at, settled_at, created_at`;

const OTP_COLS = `otp_id, party_id, user_id, entity_ref, content_hash, sent_to,
  code_hash, attempts, resends, expires_at, cooldown_until, verified_at, created_at`;

// ── requests ───────────────────────────────────────────────────────────────

const insertRequest = (client, data) => insertOne(client, "signature_request", data);

async function getRequest(client, id) {
  const { rows } = await client.query(
    `SELECT ${REQ_COLS} FROM signature_request WHERE request_id = $1`, [id],
  );
  return rows[0] || null;
}

async function listRequests(client, { entityRef = null, status = null, limit = 200 }) {
  const where = [];
  const params = [];
  if (entityRef) { params.push(entityRef); where.push(`entity_ref = $${params.length}`); }
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  params.push(Math.min(Number(limit) || 200, 1000));
  const { rows } = await client.query(
    `SELECT ${REQ_COLS} FROM signature_request
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows;
}

const updateRequest = (client, id, patch) =>
  updateOne(client, "signature_request", "request_id", id, patch, REQ_COLS);

/**
 * Move a request to a status, but only from one it is allowed to leave.
 *
 * `expected` is the guard: two concurrent completions would otherwise both see
 * PARTIALLY_SIGNED, both write COMPLETED, and both enqueue a certificate. The
 * UPDATE ... WHERE status = ANY($3) makes the second one a no-op that returns
 * no row, which the caller reads as "somebody else got there first".
 */
async function transitionRequest(client, id, status, expected, extra = {}) {
  const sets = ["status = $2"];
  const params = [id, status];
  for (const [col, value] of Object.entries(extra)) {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  }
  params.push(expected);
  const { rows } = await client.query(
    `UPDATE signature_request SET ${sets.join(", ")}
      WHERE request_id = $1 AND status = ANY($${params.length})
      RETURNING ${REQ_COLS}`,
    params,
  );
  return rows[0] || null;
}

/**
 * Serialise the chain-advance side effects for one request.
 *
 * Two parties completing at the same instant would each read "nobody is
 * pending" and each enqueue a certificate. A transaction-scoped advisory lock
 * (the idiom journal_entry.repo and document_signature.repo both use) makes the
 * second wait and then see the first's work.
 */
function lockRequest(client, requestId) {
  return client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["signature:request:" + requestId]);
}

// ── parties ────────────────────────────────────────────────────────────────

const insertParty = (client, data) => insertOne(client, "signature_party", data);

async function listParties(client, requestId) {
  const { rows } = await client.query(
    `SELECT ${PARTY_COLS} FROM signature_party WHERE request_id = $1 ORDER BY sequence_no`,
    [requestId],
  );
  return rows;
}

async function getParty(client, id) {
  const { rows } = await client.query(
    `SELECT ${PARTY_COLS} FROM signature_party WHERE party_id = $1`, [id],
  );
  return rows[0] || null;
}

/**
 * Resolve a presented signing token.
 *
 * By HMAC, over the candidate set the pepper rotation produces — one query
 * with `= ANY($1)` rather than two round-trips. The plaintext token is never
 * stored, so this is the only way in.
 */
async function getPartyByTokenHmac(client, candidates) {
  const { rows } = await client.query(
    `SELECT ${PARTY_COLS} FROM signature_party WHERE sign_token_hmac = ANY($1)`,
    [candidates],
  );
  return rows[0] || null;
}

/** The next party owed a link: lowest unsettled sequence_no. */
async function nextPendingParty(client, requestId) {
  const { rows } = await client.query(
    `SELECT ${PARTY_COLS} FROM signature_party
      WHERE request_id = $1 AND status IN ('PENDING','SENT','VIEWED')
      ORDER BY sequence_no LIMIT 1`,
    [requestId],
  );
  return rows[0] || null;
}

const updateParty = (client, id, patch) =>
  updateOne(client, "signature_party", "party_id", id, patch, PARTY_COLS);

/**
 * Settle a party, from an unsettled state only.
 *
 * Same reasoning as transitionRequest: a double-submitted signing form must
 * write one signature, not two. The second call returns no row.
 */
async function settleParty(client, id, status, extra = {}) {
  const sets = ["status = $2", "settled_at = now()"];
  const params = [id, status];
  for (const [col, value] of Object.entries(extra)) {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  }
  const { rows } = await client.query(
    `UPDATE signature_party SET ${sets.join(", ")}
      WHERE party_id = $1 AND status IN ('PENDING','SENT','VIEWED')
      RETURNING ${PARTY_COLS}`,
    params,
  );
  return rows[0] || null;
}

/** Parties still owed a nudge. Feeds the reminder scheduler (§6.8). */
async function partiesDueReminder(client, days) {
  const { rows } = await client.query(
    `SELECT p.${PARTY_COLS.split(", ").join(", p.")}, r.request_id AS req_id, r.doc_type, r.entity_ref, r.reminder_count
       FROM signature_party p
       JOIN signature_request r ON r.request_id = p.request_id
      WHERE p.status IN ('SENT','VIEWED')
        AND r.status IN ('SENT','PARTIALLY_SIGNED')
        AND (r.expires_at IS NULL OR r.expires_at > now())
        AND p.sent_at < now() - ($1::int * interval '1 day')
        AND r.reminder_count < 2
        AND (r.last_reminder_at IS NULL OR r.last_reminder_at < now() - interval '1 day')
      ORDER BY p.sent_at
      LIMIT 500`,
    [days],
  );
  return rows;
}

// ── OTP challenges ─────────────────────────────────────────────────────────

const insertOtp = (client, data) => insertOne(client, "signature_otp", data);

/** The most recent challenge for a subject. `services/signatures/otp.js` decides if it is live. */
async function latestOtp(client, { partyId = null, userId = null }) {
  const column = partyId ? "party_id" : "user_id";
  const { rows } = await client.query(
    `SELECT ${OTP_COLS} FROM signature_otp WHERE ${column} = $1 ORDER BY created_at DESC LIMIT 1`,
    [partyId || userId],
  );
  return rows[0] || null;
}

/**
 * Count an attempt, atomically.
 *
 * `attempts = attempts + 1` in SQL rather than read-modify-write in JS: two
 * concurrent guesses against the same challenge would otherwise both read 4,
 * both write 5, and buy the attacker a free guess. The CHECK constraint caps
 * it at 5, so a race that would exceed the cap fails loudly instead.
 */
async function bumpOtpAttempt(client, otpId) {
  const { rows } = await client.query(
    `UPDATE signature_otp SET attempts = LEAST(attempts + 1, 5)
      WHERE otp_id = $1 RETURNING ${OTP_COLS}`,
    [otpId],
  );
  return rows[0] || null;
}

async function resendOtp(client, { otpId, codeHash, expiresAt }) {
  const { rows } = await client.query(
    `UPDATE signature_otp
        SET code_hash = $2, expires_at = $3, resends = LEAST(resends + 1, 3)
      WHERE otp_id = $1 RETURNING ${OTP_COLS}`,
    [otpId, codeHash, expiresAt],
  );
  return rows[0] || null;
}

async function setOtpCooldown(client, otpId, until) {
  const { rows } = await client.query(
    `UPDATE signature_otp SET cooldown_until = $2 WHERE otp_id = $1 RETURNING ${OTP_COLS}`,
    [otpId, until],
  );
  return rows[0] || null;
}

/** Verify once. The WHERE clause makes a replayed verification a no-op. */
async function markOtpVerified(client, otpId) {
  const { rows } = await client.query(
    `UPDATE signature_otp SET verified_at = now()
      WHERE otp_id = $1 AND verified_at IS NULL RETURNING ${OTP_COLS}`,
    [otpId],
  );
  return rows[0] || null;
}

/** Every challenge behind a request's signatures. The certificate prints these. */
async function otpsForRequest(client, requestId) {
  const { rows } = await client.query(
    `SELECT o.${OTP_COLS.split(", ").join(", o.")}, p.full_name, p.sequence_no
       FROM signature_otp o
       JOIN signature_party p ON p.party_id = o.party_id
      WHERE p.request_id = $1
      ORDER BY p.sequence_no, o.created_at`,
    [requestId],
  );
  return rows;
}

/** The ledger trail for a request, for §6.7 item 5. */
async function ledgerForRequest(client, entityRef) {
  const { rows } = await client.query(
    `SELECT action, actor_name_snapshot, entity_ref, created_at, request_id, after_json
       FROM immutable_ledger
      WHERE entity_ref = $1 AND action LIKE 'document_signature.%'
      ORDER BY created_at
      LIMIT 500`,
    [entityRef],
  );
  return rows;
}

module.exports = {
  insertRequest, getRequest, listRequests, updateRequest, transitionRequest, lockRequest,
  insertParty, listParties, getParty, getPartyByTokenHmac, nextPendingParty, updateParty,
  settleParty, partiesDueReminder,
  insertOtp, latestOtp, bumpOtpAttempt, resendOtp, setOtpCooldown, markOtpVerified,
  otpsForRequest, ledgerForRequest,
};
