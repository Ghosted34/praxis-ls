/**
 * Reconciliation data access (MOD-09). Plain pg on the request's tenant client.
 *
 * The only file in the module with SQL, per doc/CONVENTIONS.md. Two things here
 * are worth knowing before reading:
 *
 * 1. THE LEDGER SIDE IS READ-ONLY. Every query that touches `journal_line` or
 *    `journal_entry` is a SELECT. Reconciliation never updates the ledger; the
 *    only writes are to this module's own tables (plus DRAFT entries created
 *    through the ordinary posting service, which is not this file's job).
 *
 * 2. "UNRECONCILED LEDGER LINE" IS A LEFT JOIN, NOT A FLAG. There is no
 *    `is_reconciled` column on journal_line by design (see the migration
 *    header), so a line is unreconciled when no CONFIRMED reconciliation_match
 *    references it. `ux_recon_match_journal_once` makes that join at most 1:1.
 */
"use strict";

const { insertOne, updateOne } = require("../../../shared/db/query-helpers");

/* ── treasury account context ─────────────────────────────────────────────── */

/**
 * The account plus the capability flags that decide HOW it reconciles.
 * `is_bank_identity` / `is_momo_identity` / `requires_custodian` come from
 * treasury_category (0520) and are what the service branches on, rather than
 * re-deriving behaviour from the legacy `kind` string.
 */
async function accountContext(client, id) {
  const { rows } = await client.query(
    `SELECT ta.treasury_account_id, ta.entity_id, ta.label, ta.kind, ta.currency, ta.coa_code,
            ta.opening_balance, ta.opening_date, ta.statement_day, ta.is_active,
            ta.momo_fee_account, ta.custodian_user_id, ta.float_limit, ta.category_id,
            tc.code AS category_code, tc.label AS category_label,
            COALESCE(tc.is_bank_identity, false)   AS is_bank_identity,
            COALESCE(tc.is_momo_identity, false)   AS is_momo_identity,
            COALESCE(tc.requires_custodian, false) AS requires_custodian
       FROM treasury_account ta
       LEFT JOIN treasury_category tc ON tc.treasury_category_id = ta.category_id
      WHERE ta.treasury_account_id = $1`,
    [id],
  );
  return rows[0] || null;
}

/* ── statement profiles ───────────────────────────────────────────────────── */

/** The confirmed, active profile for a header signature, if the entity has one. */
async function findProfile(client, { entityId, sourceKind, headerSignature }) {
  if (!headerSignature) return null;
  const { rows } = await client.query(
    `SELECT * FROM statement_profile
      WHERE entity_id = $1 AND source_kind = $2 AND header_signature = $3
        AND is_active = true AND confirmed_at IS NOT NULL
      LIMIT 1`,
    [entityId, sourceKind, headerSignature],
  );
  return rows[0] || null;
}

async function getProfile(client, id) {
  const { rows } = await client.query("SELECT * FROM statement_profile WHERE statement_profile_id = $1", [id]);
  return rows[0] || null;
}

async function listProfiles(client, { entityId } = {}) {
  const { rows } = await client.query(
    `SELECT p.*,
            (SELECT count(*) FROM bank_statement s WHERE s.statement_profile_id = p.statement_profile_id) AS use_count
       FROM statement_profile p
      WHERE ($1::uuid IS NULL OR p.entity_id = $1)
      ORDER BY p.is_active DESC, p.institution NULLS LAST, p.created_at DESC`,
    [entityId || null],
  );
  return rows;
}

const insertProfile = (client, data) =>
  insertOne(client, "statement_profile", data);

/**
 * Supersede rather than edit. A statement imported last year must keep pointing
 * at the map that actually parsed it, so a correction deactivates the old row
 * and inserts a new one carrying the next version number.
 */
async function supersedeProfile(client, { profileId, data, actor }) {
  const previous = await getProfile(client, profileId);
  if (!previous) return null;
  await client.query(
    "UPDATE statement_profile SET is_active = false, updated_at = now() WHERE statement_profile_id = $1",
    [profileId],
  );
  return insertProfile(client, {
    ...data,
    entity_id: previous.entity_id,
    source_kind: previous.source_kind,
    version: Number(previous.version || 1) + 1,
    created_by: actor && actor.user_id ? actor.user_id : null,
  });
}

/* ── statements ───────────────────────────────────────────────────────────── */

const insertStatement = (client, data) => insertOne(client, "bank_statement", data);

async function getStatement(client, id) {
  const { rows } = await client.query(
    `SELECT s.*, ta.label AS account_label, ta.coa_code, ta.currency AS account_currency
       FROM bank_statement s
       JOIN treasury_account ta ON ta.treasury_account_id = s.treasury_account_id
      WHERE s.statement_id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** Does this account already hold these exact bytes? The file-level guard. */
async function findStatementByHash(client, { treasuryAccountId, fileHash }) {
  const { rows } = await client.query(
    "SELECT statement_id, file_name, imported_at, status FROM bank_statement WHERE treasury_account_id = $1 AND file_hash = $2",
    [treasuryAccountId, fileHash],
  );
  return rows[0] || null;
}

async function listStatements(client, { treasuryAccountId, status, limit = 50, offset = 0 } = {}) {
  const { rows } = await client.query(
    `SELECT s.statement_id, s.file_name, s.source_kind, s.period_start, s.period_end,
            s.opening_balance_declared, s.closing_balance_declared, s.currency,
            s.line_count, s.duplicate_count, s.foots, s.footing_difference, s.status,
            s.imported_at, s.imported_by,
            (SELECT count(*) FROM bank_statement_line l
              WHERE l.statement_id = s.statement_id AND l.match_status = 'UNMATCHED'
                AND l.duplicate_of IS NULL) AS unmatched_count
       FROM bank_statement s
      WHERE s.treasury_account_id = $1
        AND ($2::text IS NULL OR s.status = $2)
      ORDER BY s.period_end DESC NULLS LAST, s.imported_at DESC
      LIMIT $3 OFFSET $4`,
    [treasuryAccountId, status || null, limit, offset],
  );
  return rows;
}

const updateStatement = (client, id, patch) =>
  updateOne(client, "bank_statement", "statement_id", id, patch);

/* ── statement lines ──────────────────────────────────────────────────────── */

/**
 * Bulk-insert parsed lines in ONE round trip.
 *
 * A 400-row statement inserted row by row is 400 round trips inside a
 * transaction holding a tenant connection; as a single multi-row VALUES it is
 * one. The parameter list is built positionally from a fixed column list, so
 * no identifier ever comes from data.
 */
async function insertLines(client, lines) {
  if (!lines.length) return [];
  const columns = [
    "statement_id", "treasury_account_id", "row_index", "raw", "booking_date", "value_date",
    "amount", "currency", "fee_amount", "description", "counterparty", "external_ref",
    "cheque_no", "running_balance", "row_hash", "match_status", "duplicate_of", "ignored_reason",
  ];
  const params = [];
  const tuples = lines.map((line, i) => {
    const base = i * columns.length;
    columns.forEach((c) => params.push(line[c] === undefined ? null : line[c]));
    return `(${columns.map((_, j) => `$${base + j + 1}`).join(",")})`;
  });
  const { rows } = await client.query(
    `INSERT INTO bank_statement_line (${columns.join(",")}) VALUES ${tuples.join(",")} RETURNING *`,
    params,
  );
  return rows;
}

/** Which of these row hashes does the account already carry? The row-level guard. */
async function existingRowHashes(client, { treasuryAccountId, hashes }) {
  if (!hashes.length) return new Map();
  const { rows } = await client.query(
    `SELECT row_hash, statement_line_id, statement_id
       FROM bank_statement_line
      WHERE treasury_account_id = $1 AND duplicate_of IS NULL AND row_hash = ANY($2::text[])`,
    [treasuryAccountId, hashes],
  );
  return new Map(rows.map((r) => [r.row_hash, r]));
}

async function listLines(client, { statementId, matchStatus, includeDuplicates = false, limit = 500, offset = 0 }) {
  const { rows } = await client.query(
    `SELECT l.*,
            (SELECT count(*) FROM reconciliation_match m
              WHERE m.statement_line_id = l.statement_line_id AND m.status = 'SUGGESTED') AS suggestion_count
       FROM bank_statement_line l
      WHERE l.statement_id = $1
        AND ($2::text IS NULL OR l.match_status = $2)
        AND ($3::boolean OR l.duplicate_of IS NULL)
      ORDER BY l.row_index
      LIMIT $4 OFFSET $5`,
    [statementId, matchStatus || null, includeDuplicates, limit, offset],
  );
  return rows;
}

async function getLine(client, id) {
  const { rows } = await client.query("SELECT * FROM bank_statement_line WHERE statement_line_id = $1", [id]);
  return rows[0] || null;
}

const updateLine = (client, id, patch) =>
  updateOne(client, "bank_statement_line", "statement_line_id", id, patch);

/* ── the ledger side (READ ONLY) ──────────────────────────────────────────── */

/**
 * Candidate journal lines for matching: postings on this account's CoA leaf,
 * inside a date window, that no CONFIRMED match has already claimed.
 *
 * `je.status = 'validated'` matches treasury-360.service.js - a draft entry is
 * not yet part of the books and must not be offered as an explanation for a
 * bank movement.
 *
 * The window is generated from the statement's own period plus the matcher's
 * far-day tolerance, so a payment we booked on the 28th and the bank cleared on
 * the 2nd is still in scope.
 */
async function candidateLines(client, { accountCode, from, to, limit = 4000 }) {
  const { rows } = await client.query(
    `SELECT jl.line_id, jl.entry_id, jl.debit, jl.credit, jl.currency, jl.dossier_id,
            je.entry_date, je.description, je.source_doc_ref, je.entry_no, je.status,
            j.code AS journal_code
       FROM journal_line jl
       JOIN journal_entry je ON je.entry_id = jl.entry_id
       JOIN journal j        ON j.journal_id = je.journal_id
       LEFT JOIN reconciliation_match m
              ON m.journal_line_id = jl.line_id AND m.status = 'CONFIRMED'
      WHERE jl.account_code = $1
        AND je.status = 'validated'
        AND je.entry_date BETWEEN $2::date AND $3::date
        AND m.match_id IS NULL
      ORDER BY je.entry_date, je.entry_no
      LIMIT $4`,
    [accountCode, from, to, limit],
  );
  return rows;
}

/** Validated ledger balance on the leaf as at a date - the reconciliation's left-hand side. */
async function ledgerBalanceAsAt(client, { accountCode, asAt }) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(jl.debit), 0)::numeric - COALESCE(SUM(jl.credit), 0)::numeric AS balance
       FROM journal_line jl
       JOIN journal_entry je ON je.entry_id = jl.entry_id
      WHERE jl.account_code = $1 AND je.status = 'validated' AND je.entry_date <= $2::date`,
    [accountCode, asAt],
  );
  return Number(rows[0] ? rows[0].balance : 0);
}

/**
 * Ledger lines in the period that nothing on the statement explains - the
 * "outstanding items" half of the etat de rapprochement: cheques we issued that
 * have not been presented, deposits the bank has not yet credited.
 */
async function unmatchedLedgerLines(client, { accountCode, from, to }) {
  const { rows } = await client.query(
    `SELECT jl.line_id, jl.debit, jl.credit, je.entry_date, je.description,
            je.source_doc_ref, je.entry_no, j.code AS journal_code
       FROM journal_line jl
       JOIN journal_entry je ON je.entry_id = jl.entry_id
       JOIN journal j        ON j.journal_id = je.journal_id
       LEFT JOIN reconciliation_match m
              ON m.journal_line_id = jl.line_id AND m.status = 'CONFIRMED'
      WHERE jl.account_code = $1
        AND je.status = 'validated'
        AND je.entry_date BETWEEN $2::date AND $3::date
        AND m.match_id IS NULL
      ORDER BY je.entry_date, je.entry_no`,
    [accountCode, from, to],
  );
  return rows;
}

/* ── matches ──────────────────────────────────────────────────────────────── */

/**
 * Upsert a suggestion. Re-running the matcher must REFRESH a suggestion rather
 * than stack duplicates of it (ux_recon_match_pair), and must never quietly
 * overwrite a decision a human already made - hence the WHERE on status.
 */
async function upsertMatch(client, m) {
  const { rows } = await client.query(
    `INSERT INTO reconciliation_match
       (statement_line_id, journal_line_id, treasury_account_id, amount, tier, confidence, method, reasons, status,
        confirmed_by, confirmed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
     ON CONFLICT (statement_line_id, journal_line_id) DO UPDATE
        SET amount = EXCLUDED.amount, tier = EXCLUDED.tier, confidence = EXCLUDED.confidence,
            method = EXCLUDED.method, reasons = EXCLUDED.reasons, updated_at = now()
      WHERE reconciliation_match.status = 'SUGGESTED'
     RETURNING *`,
    [m.statement_line_id, m.journal_line_id, m.treasury_account_id, m.amount, m.tier, m.confidence,
      m.method, JSON.stringify(m.reasons || []), m.status || "SUGGESTED",
      m.confirmed_by || null, m.confirmed_at || null],
  );
  return rows[0] || null;
}

async function getMatch(client, id) {
  const { rows } = await client.query("SELECT * FROM reconciliation_match WHERE match_id = $1", [id]);
  return rows[0] || null;
}

const updateMatch = (client, id, patch) =>
  updateOne(client, "reconciliation_match", "match_id", id, patch);

/** Every suggestion for one statement line, with the ledger line it points at. */
async function matchesForLine(client, statementLineId) {
  const { rows } = await client.query(
    `SELECT m.*, jl.debit, jl.credit, je.entry_date, je.description, je.entry_no,
            je.source_doc_ref, j.code AS journal_code
       FROM reconciliation_match m
       JOIN journal_line jl  ON jl.line_id = m.journal_line_id
       JOIN journal_entry je ON je.entry_id = jl.entry_id
       JOIN journal j        ON j.journal_id = je.journal_id
      WHERE m.statement_line_id = $1 AND m.status <> 'REJECTED'
      ORDER BY m.status DESC, m.confidence DESC`,
    [statementLineId],
  );
  return rows;
}

/** Clear stale SUGGESTED rows before a re-run. Decisions are never touched. */
async function clearSuggestions(client, statementId) {
  const { rowCount } = await client.query(
    `DELETE FROM reconciliation_match m
       USING bank_statement_line l
      WHERE m.statement_line_id = l.statement_line_id
        AND l.statement_id = $1 AND m.status = 'SUGGESTED'`,
    [statementId],
  );
  return rowCount;
}

/** Recompute a line's matched total + status from its CONFIRMED matches. */
async function refreshLineMatchState(client, statementLineId) {
  const { rows } = await client.query(
    `UPDATE bank_statement_line l
        SET matched_amount = COALESCE(agg.total, 0),
            match_status = CASE
              WHEN l.match_status IN ('IGNORED', 'POSTED') THEN l.match_status
              WHEN COALESCE(agg.total, 0) = 0 AND COALESCE(sug.n, 0) > 0 THEN 'SUGGESTED'
              WHEN COALESCE(agg.total, 0) = 0 THEN 'UNMATCHED'
              WHEN abs(COALESCE(agg.total, 0)) >= abs(l.amount) THEN 'MATCHED'
              ELSE 'PARTIAL' END,
            updated_at = now()
       FROM (SELECT $1::uuid AS id) k
       LEFT JOIN LATERAL (
         SELECT SUM(amount) AS total FROM reconciliation_match
          WHERE statement_line_id = k.id AND status = 'CONFIRMED') agg ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS n FROM reconciliation_match
          WHERE statement_line_id = k.id AND status = 'SUGGESTED') sug ON true
      WHERE l.statement_line_id = k.id
      RETURNING l.*`,
    [statementLineId],
  );
  return rows[0] || null;
}

/* ── reconciliation statements + cash counts ──────────────────────────────── */

const insertReconciliation = (client, data) => insertOne(client, "reconciliation", data);

async function getReconciliation(client, id) {
  const { rows } = await client.query(
    `SELECT r.*, ta.label AS account_label, ta.coa_code
       FROM reconciliation r
       JOIN treasury_account ta ON ta.treasury_account_id = r.treasury_account_id
      WHERE r.reconciliation_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function findOpenReconciliation(client, { treasuryAccountId, periodEnd }) {
  const { rows } = await client.query(
    `SELECT * FROM reconciliation
      WHERE treasury_account_id = $1 AND period_end = $2::date AND status <> 'CANCELLED'`,
    [treasuryAccountId, periodEnd],
  );
  return rows[0] || null;
}

async function listReconciliations(client, { treasuryAccountId, limit = 24 }) {
  const { rows } = await client.query(
    `SELECT reconciliation_id, period_start, period_end, currency, ledger_balance, statement_balance,
            unexplained_difference, matched_count, unmatched_statement_count, unmatched_ledger_count,
            status, doc_number, approved_at
       FROM reconciliation
      WHERE treasury_account_id = $1
      ORDER BY period_end DESC
      LIMIT $2`,
    [treasuryAccountId, limit],
  );
  return rows;
}

const updateReconciliation = (client, id, patch) =>
  updateOne(client, "reconciliation", "reconciliation_id", id, patch);

const insertCashCount = (client, data) => insertOne(client, "cash_count", data);

async function getCashCount(client, id) {
  const { rows } = await client.query("SELECT * FROM cash_count WHERE cash_count_id = $1", [id]);
  return rows[0] || null;
}

async function listCashCounts(client, { treasuryAccountId, limit = 24 }) {
  const { rows } = await client.query(
    `SELECT * FROM cash_count WHERE treasury_account_id = $1 ORDER BY counted_on DESC LIMIT $2`,
    [treasuryAccountId, limit],
  );
  return rows;
}

const updateCashCount = (client, id, patch) =>
  updateOne(client, "cash_count", "cash_count_id", id, patch);

module.exports = {
  candidateLines, ledgerBalanceAsAt, unmatchedLedgerLines,
  upsertMatch, getMatch, updateMatch, matchesForLine, clearSuggestions, refreshLineMatchState,
  insertReconciliation, getReconciliation, findOpenReconciliation, listReconciliations, updateReconciliation,
  insertCashCount, getCashCount, listCashCounts, updateCashCount,
  accountContext,
  findProfile, getProfile, listProfiles, insertProfile, supersedeProfile,
  insertStatement, getStatement, findStatementByHash, listStatements, updateStatement,
  insertLines, existingRowHashes, listLines, getLine, updateLine,
};
