/**
 * Reconciliation service (MOD-09) — statement ingest, matching, and the
 * etat de rapprochement.
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP: nothing here writes to the ledger.
 *
 * Importing a statement, matching it, and signing off a reconciliation are all
 * operations on THIS module's tables. Where the reconciliation reveals a
 * posting that was never made — a bank charge, interest, a receipt nobody
 * recorded — the service produces a DRAFT journal entry through the ordinary
 * posting path and hands it to the ordinary approval chain. It does not post.
 * A treasurer running a reconciliation cannot, through this module, change the
 * books; they can only discover what the books are missing and propose it.
 *
 * THE IMPORT PIPELINE, and where a human stands in it:
 *
 *   upload → detect format → parse → find a confirmed profile by header
 *   signature
 *      ├── found     → apply it, dedupe, foot, store          (no questions)
 *      └── not found → propose a map, verify it against the data, and STOP,
 *                      returning a preview for confirmation   (one question,
 *                      once per institution, ever)
 *
 * Nothing is stored on the "not found" branch. `preview` is a pure read: it
 * parses in memory and returns what it would do. Only `importStatement` with a
 * confirmed profile writes.
 */
"use strict";

const crypto = require("crypto");
const repo = require("./reconciliation.repo");
const rules = require("./reconciliation.rules");
const mapping = require("./reconciliation.mapping");
const events = require("./reconciliation.events");
const statements = require("../../../services/statements");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const stRef = (id) => "bank_statement:" + id;
const reconRef = (id) => "reconciliation:" + id;
const countRef = (id) => "cash_count:" + id;

/** Uploads ride the same base64 data-URL convention as the rest of the product. */
function decodeUpload(file) {
  const s = String(file || "");
  const m = /^data:([^;]*);base64,(.+)$/s.exec(s);
  const b64 = m ? m[2] : s;
  if (!/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(b64.slice(0, 4096))) {
    throw new AppError("BAD_FILE", "Expected a base64-encoded statement file", 400);
  }
  const buffer = Buffer.from(b64, "base64");
  if (buffer.length === 0) throw new AppError("BAD_FILE", "The uploaded statement is empty", 400);
  return buffer;
}

/** The account, or a 404 — every entry point needs it and needs it to exist. */
async function requireAccount(client, treasuryAccountId) {
  const account = await repo.accountContext(client, treasuryAccountId);
  if (!account) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
  return account;
}

/**
 * Turn a stored profile row into the plain shape the mapping layer works with.
 * The two differ because the table stores snake_case columns and the mapping
 * layer predates (and is testable without) the table.
 */
const profileToSettings = (p) => ({
  column_map: p.column_map || {},
  sign_convention: p.sign_convention,
  date_format: p.date_format,
  decimal_separator: p.decimal_separator,
  thousands_separator: p.thousands_separator,
  debit_indicators: p.debit_indicators,
});

/**
 * Parse a buffer and canonicalise it, using a confirmed profile when the
 * account's entity already has one for this layout.
 *
 * Returns `{ parsed, profile, canonicalRows, rejected, needsMapping }`.
 * Self-describing sources (camt.053, MT940) skip the profile entirely — their
 * rows are already canonical, which is the whole argument for supporting them.
 */
async function canonicalise(client, { buffer, filename, account, overrideProfile = null }) {
  const parsed = await statements.parse(buffer, { filename });

  if (parsed.canonical) {
    const rows = parsed.rows.map((r) => ({ ...r, fee: Math.abs(Number(r.fee || 0)), raw: r }));
    return { parsed, profile: null, canonicalRows: rows, rejected: [], needsMapping: false };
  }

  const signature = rules.headerSignature(parsed.headers);
  const stored = overrideProfile
    || await repo.findProfile(client, {
      entityId: account.entity_id, sourceKind: parsed.source_kind, headerSignature: signature,
    });

  if (!stored) return { parsed, profile: null, canonicalRows: [], rejected: [], needsMapping: true, signature };

  const settings = profileToSettings(stored);
  const { rows, rejected } = mapping.applyMap(parsed.rows, settings);
  return { parsed, profile: stored, canonicalRows: rows, rejected, needsMapping: false, signature };
}

/**
 * Dry run. Parses in memory and reports exactly what an import would do —
 * including the mapping proposal when the layout is new — WITHOUT writing
 * anything.
 *
 * This is the screen the treasurer confirms. It deliberately returns the
 * footing result too: the most useful thing to know before importing is whether
 * the file adds up, and knowing it before the write means a mis-parsed
 * statement never reaches the database at all.
 */
async function preview(client, { treasuryAccountId, file, filename }) {
  const account = await requireAccount(client, treasuryAccountId);
  const buffer = decodeUpload(file);
  const fileHash = rules.fileHash(buffer);

  const duplicate = await repo.findStatementByHash(client, { treasuryAccountId, fileHash });
  const ctx = await canonicalise(client, { buffer, filename, account });

  const base = {
    account: {
      treasury_account_id: account.treasury_account_id,
      label: account.label,
      currency: account.currency,
      category_code: account.category_code,
      is_momo: account.is_momo_identity,
      is_bank: account.is_bank_identity,
    },
    file: { name: filename || null, hash: fileHash, size: buffer.length, source_kind: ctx.parsed.source_kind },
    // Not an error: re-uploading is how a user checks whether the first upload
    // worked. The screen says "you already have this file" and offers the
    // existing statement rather than refusing.
    already_imported: duplicate || null,
    source_meta: ctx.parsed.meta,
  };

  if (ctx.needsMapping) {
    const proposal = await mapping.proposeProfile(client, {
      headers: ctx.parsed.headers, rows: ctx.parsed.rows,
    });
    return {
      ...base,
      status: "NEEDS_MAPPING",
      headers: ctx.parsed.headers,
      sample: ctx.parsed.rows.slice(0, mapping.SAMPLE_ROWS),
      proposal,
      message: "This layout has not been seen before. Confirm the column mapping once and every future statement from this institution will import without asking.",
    };
  }

  const footing = rules.checkFooting({
    openingBalance: ctx.parsed.meta ? ctx.parsed.meta.opening_balance : null,
    closingBalance: ctx.parsed.meta ? ctx.parsed.meta.closing_balance : null,
    lines: ctx.canonicalRows,
  });
  const hashes = ctx.canonicalRows.map((r) => rules.rowHash({
    treasuryAccountId, bookingDate: r.booking_date, amount: r.amount,
    description: r.description, externalRef: r.external_ref,
  }));
  const existing = await repo.existingRowHashes(client, { treasuryAccountId, hashes });

  return {
    ...base,
    status: "READY",
    profile: ctx.profile ? { statement_profile_id: ctx.profile.statement_profile_id, label: ctx.profile.label, institution: ctx.profile.institution } : null,
    line_count: ctx.canonicalRows.length,
    duplicate_count: hashes.filter((h) => existing.has(h)).length,
    rejected: ctx.rejected,
    footing,
    preview: ctx.canonicalRows.slice(0, 25),
  };
}

/**
 * Confirm a proposed mapping and store it as a reusable profile.
 *
 * `confirmed_by` is the whole point of the row: it records that a person took
 * responsibility for this interpretation of the file. A profile without it is
 * never used for an import (chk_profile_confirmed, and the WHERE in findProfile).
 */
async function confirmProfile(client, { entityId, sourceKind, data, actor }) {
  const map = data.column_map || {};
  if (!map.booking_date && !map.value_date) {
    throw new AppError("VALIDATION_ERROR", "A date column must be mapped", 422);
  }
  if (!map.amount && !map.debit && !map.credit) {
    throw new AppError("VALIDATION_ERROR", "Map either a single Amount column or a Debit/Credit pair", 422);
  }

  const actorId = await resolveActorId(client, actor && actor.user_id);
  await client.query("BEGIN");
  try {
    // Supersede any existing active profile for this signature rather than
    // updating it, so statements already imported keep pointing at the map that
    // actually parsed them.
    if (data.header_signature) {
      await client.query(
        `UPDATE statement_profile SET is_active = false, updated_at = now()
          WHERE entity_id = $1 AND source_kind = $2 AND header_signature = $3 AND is_active = true`,
        [entityId, sourceKind, data.header_signature],
      );
    }

    const row = await repo.insertProfile(client, {
      entity_id: entityId,
      source_kind: sourceKind,
      institution: data.institution || null,
      label: data.label || data.institution || `${sourceKind} layout`,
      header_signature: data.header_signature || null,
      column_map: JSON.stringify(map),
      sign_convention: data.sign_convention || mapping.inferSignConvention(map),
      debit_indicators: data.debit_indicators || null,
      date_format: data.date_format || "DD/MM/YYYY",
      decimal_separator: data.decimal_separator || ",",
      thousands_separator: data.thousands_separator ?? " ",
      encoding: data.encoding || "utf-8",
      delimiter: data.delimiter || null,
      header_row_index: data.header_row_index || 1,
      data_start_row: data.data_start_row || null,
      proposed_by_ai: data.proposed_by_ai === true,
      ai_confidence: data.ai_confidence ?? null,
      confirmed_by: actorId,
      confirmed_at: new Date(),
      created_by: actorId,
    });

    await emitEvent(client, {
      eventTypeKey: events.PROFILE_CONFIRMED, moduleKey: events.MODULE,
      entityRef: "statement_profile:" + row.statement_profile_id, actorUserId: actor && actor.user_id ? actor.user_id : null,
    });
    await audit(client, {
      actorUserId: actor && actor.user_id ? actor.user_id : null, action: events.PROFILE_CONFIRMED,
      moduleKey: events.MODULE, entityRef: "statement_profile:" + row.statement_profile_id, after: row,
    });
    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * Import a statement for real.
 *
 * The write path, and the four gates it passes through:
 *   1. FILE duplicate  — same bytes, same account → refused outright.
 *   2. MAPPING         — no confirmed profile → refused, with the preview
 *                        endpoint named as the next step.
 *   3. ROW duplicates  — rows already present from an overlapping period are
 *                        stored but flagged, never matched, never counted.
 *   4. FOOTING         — recorded on the statement. A statement that does not
 *                        foot lands in PARSED and cannot be advanced (the
 *                        chk_statement_foots constraint enforces the rest).
 */
async function importStatement(client, { treasuryAccountId, file, filename, profileId, actor }) {
  const account = await requireAccount(client, treasuryAccountId);
  const buffer = decodeUpload(file);
  const fileHash = rules.fileHash(buffer);

  // Gate 1.
  const existingStatement = await repo.findStatementByHash(client, { treasuryAccountId, fileHash });
  if (existingStatement) {
    throw new AppError(
      "DUPLICATE_STATEMENT",
      `This exact file was already imported on ${new Date(existingStatement.imported_at).toISOString().slice(0, 10)}.`,
      409,
      { statement_id: existingStatement.statement_id },
    );
  }

  const overrideProfile = profileId ? await repo.getProfile(client, profileId) : null;
  if (profileId && !overrideProfile) throw new AppError("NOT_FOUND", "Statement profile not found", 404);

  const ctx = await canonicalise(client, { buffer, filename, account, overrideProfile });

  // Gate 2.
  if (ctx.needsMapping) {
    throw new AppError(
      "NEEDS_MAPPING",
      "This statement layout has not been mapped yet. Preview the file and confirm its column mapping first.",
      409,
      { header_signature: ctx.signature, source_kind: ctx.parsed.source_kind },
    );
  }
  if (!ctx.canonicalRows.length) {
    throw new AppError("EMPTY_STATEMENT", "No usable transaction rows could be read from this file", 422);
  }

  // Gate 3.
  const withHashes = ctx.canonicalRows.map((r) => ({
    ...r,
    row_hash: rules.rowHash({
      treasuryAccountId, bookingDate: r.booking_date, amount: r.amount,
      description: r.description, externalRef: r.external_ref,
    }),
  }));
  const existing = await repo.existingRowHashes(client, {
    treasuryAccountId, hashes: withHashes.map((r) => r.row_hash),
  });
  // Also guard against the same row appearing twice INSIDE one file, which the
  // unique index would otherwise reject as a whole-transaction failure.
  const seenInFile = new Set();

  // Gate 4.
  const meta = ctx.parsed.meta || {};
  const footing = rules.checkFooting({
    openingBalance: meta.opening_balance, closingBalance: meta.closing_balance, lines: ctx.canonicalRows,
  });

  const dates = withHashes.map((r) => r.booking_date).filter(Boolean).sort();
  const actorId = await resolveActorId(client, actor && actor.user_id);

  await client.query("BEGIN");
  try {
    const statement = await repo.insertStatement(client, {
      treasury_account_id: treasuryAccountId,
      entity_id: account.entity_id,
      statement_profile_id: ctx.profile ? ctx.profile.statement_profile_id : null,
      source_kind: ctx.parsed.source_kind,
      file_name: filename || null,
      file_hash: fileHash,
      file_size: buffer.length,
      period_start: meta.period_start || dates[0] || null,
      period_end: meta.period_end || dates[dates.length - 1] || null,
      currency: meta.currency || account.currency || "XAF",
      opening_balance_declared: meta.opening_balance ?? null,
      closing_balance_declared: meta.closing_balance ?? null,
      line_count: withHashes.length,
      duplicate_count: 0,
      foots: footing.foots,
      footing_difference: footing.difference,
      status: "PARSED",
      imported_by: actorId,
    });

    let duplicateCount = 0;
    const lines = withHashes.map((r, i) => {
      const dupe = existing.get(r.row_hash) || seenInFile.has(r.row_hash);
      if (dupe) duplicateCount += 1;
      else seenInFile.add(r.row_hash);
      const zero = Number(r.amount) === 0;
      return {
        statement_id: statement.statement_id,
        treasury_account_id: treasuryAccountId,
        row_index: (r.__row === null || r.__row === undefined) ? i + 1 : r.__row,
        raw: JSON.stringify(r.raw || {}),
        booking_date: r.booking_date,
        value_date: r.value_date || null,
        amount: r.amount,
        currency: r.currency || statement.currency,
        fee_amount: Math.abs(Number(r.fee || 0)),
        description: r.description || null,
        counterparty: r.counterparty || null,
        external_ref: r.external_ref || null,
        cheque_no: r.cheque_no || null,
        running_balance: r.running_balance ?? null,
        row_hash: r.row_hash,
        // A duplicate or a zero-amount advice is stored (so the file's line
        // count still reconciles) but excluded from matching.
        match_status: dupe || zero ? "IGNORED" : "UNMATCHED",
        duplicate_of: existing.has(r.row_hash) ? existing.get(r.row_hash).statement_line_id : null,
        ignored_reason: dupe
          ? "already present from an earlier statement covering this date"
          : (zero ? "zero-amount advice, not a movement" : null),
      };
    });

    const inserted = await repo.insertLines(client, lines);
    const updated = await repo.updateStatement(client, statement.statement_id, {
      duplicate_count: duplicateCount,
      status: footing.foots === false ? "PARSED" : "VALIDATED",
      validated_by: footing.foots === false ? null : actorId,
      validated_at: footing.foots === false ? null : new Date(),
    });

    await emitEvent(client, {
      eventTypeKey: events.STATEMENT_IMPORTED, moduleKey: events.MODULE,
      entityRef: stRef(statement.statement_id), actorUserId: actor && actor.user_id ? actor.user_id : null,
    });
    await audit(client, {
      actorUserId: actor && actor.user_id ? actor.user_id : null, action: events.STATEMENT_IMPORTED,
      moduleKey: events.MODULE, entityRef: stRef(statement.statement_id),
      after: { ...updated, line_count: inserted.length, duplicate_count: duplicateCount },
      metadata: { file_name: filename || null, source_kind: ctx.parsed.source_kind, foots: footing.foots },
    });
    await client.query("COMMIT");

    return {
      statement: updated,
      imported: inserted.length,
      duplicates: duplicateCount,
      rejected: ctx.rejected,
      footing,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/* ══ Matching ══════════════════════════════════════════════════════════════ */

/**
 * Run the matcher across a statement.
 *
 * SHAPE OF THE WORK. One query pulls every candidate ledger line for the whole
 * statement period (widened by the far-day tolerance), and the scoring runs in
 * memory. The alternative — a query per statement line — is 400 round trips for
 * a month of transactions, on a pooled tenant connection, to compare against
 * substantially the same candidate set every time.
 *
 * TOLERANCE IS PER ACCOUNT TYPE, and this is where mobile money genuinely
 * differs rather than cosmetically. A MoMo line's fee may or may not already be
 * inside the figure the export shows, so the fee is allowed as the amount
 * tolerance for those accounts. A bank account gets zero tolerance: bank
 * reconciliation is exact arithmetic and a default tolerance would paper over
 * real differences.
 *
 * AUTO-CONFIRMATION is limited to tier 1 — an exact institution-reference hit
 * with an agreeing amount. That identifies an instrument, not a coincidence.
 * Everything else is SUGGESTED and waits for a person. Note that confirming a
 * match still writes nothing to the ledger; it records that two existing
 * records describe one event.
 */
async function runMatcher(client, { statementId, actor, options = {} }) {
  const statement = await repo.getStatement(client, statementId);
  if (!statement) throw new AppError("NOT_FOUND", "Statement not found", 404);
  if (statement.status === "PARSED" && statement.foots === false) {
    throw new AppError(
      "STATEMENT_DOES_NOT_FOOT",
      "This statement does not add up — its declared balances disagree with the sum of its lines. Matching it would reconcile against a mis-parse. Re-import it or correct the column mapping first.",
      409,
      { footing_difference: statement.footing_difference },
    );
  }

  const account = await requireAccount(client, statement.treasury_account_id);
  const farDays = options.far_days ?? rules.DEFAULT_FAR_DAYS;
  const nearDays = options.near_days ?? rules.DEFAULT_NEAR_DAYS;

  const lines = await repo.listLines(client, { statementId, matchStatus: null, limit: 5000 });
  const open = lines.filter((l) => l.duplicate_of === null && ["UNMATCHED", "SUGGESTED"].includes(l.match_status));
  if (!open.length) return { suggested: 0, auto_confirmed: 0, unmatched: 0, considered: 0 };

  const dates = open.map((l) => l.booking_date).filter(Boolean).sort();
  const pad = (d, days) => {
    const t = new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + days);
    return t.toISOString().slice(0, 10);
  };
  const candidates = await repo.candidateLines(client, {
    accountCode: account.coa_code,
    from: pad(dates[0], -farDays - 1),
    to: pad(dates[dates.length - 1], farDays + 1),
  });

  const actorId = await resolveActorId(client, actor && actor.user_id);
  let suggested = 0;
  let autoConfirmed = 0;

  await client.query("BEGIN");
  try {
    // Stale suggestions go first so a re-run reflects the current ledger rather
    // than accumulating candidates that have since been posted or reversed.
    await repo.clearSuggestions(client, statementId);

    // A ledger line auto-confirmed against one statement line must not then be
    // auto-confirmed against another in the same sweep — the unique index would
    // reject it and take the whole transaction with it.
    const claimed = new Set();

    for (const line of open) {
      const tolerance = account.is_momo_identity ? Math.abs(Number(line.fee_amount || 0)) : 0;
      const ranked = rules.rankCandidates(
        {
          amount: Number(line.amount),
          booking_date: line.booking_date,
          value_date: line.value_date,
          description: line.description,
          counterparty: line.counterparty,
          external_ref: line.external_ref,
          cheque_no: line.cheque_no,
        },
        candidates.filter((c) => !claimed.has(c.line_id)),
        { nearDays, farDays, tolerance },
      ).slice(0, 5);

      for (const [rank, hit] of ranked.entries()) {
        const auto = rank === 0 && hit.tier <= rules.AUTO_CONFIRM_TIER && options.auto_confirm !== false;
        if (auto) claimed.add(hit.candidate.line_id);
        const row = await repo.upsertMatch(client, {
          statement_line_id: line.statement_line_id,
          journal_line_id: hit.candidate.line_id,
          treasury_account_id: statement.treasury_account_id,
          amount: Number(line.amount),
          tier: hit.tier,
          confidence: Number(hit.confidence.toFixed(4)),
          method: hit.method,
          reasons: hit.reasons,
          status: auto ? "CONFIRMED" : "SUGGESTED",
          confirmed_by: auto ? actorId : null,
          confirmed_at: auto ? new Date() : null,
        });
        if (row) { if (auto) autoConfirmed += 1; else suggested += 1; }
      }
      await repo.refreshLineMatchState(client, line.statement_line_id);
    }

    await repo.updateStatement(client, statementId, { status: "RECONCILING" });
    await emitEvent(client, {
      eventTypeKey: events.MATCHER_RUN, moduleKey: events.MODULE,
      entityRef: stRef(statementId), actorUserId: actor && actor.user_id ? actor.user_id : null,
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }

  const after = await repo.listLines(client, { statementId, limit: 5000 });
  return {
    considered: open.length,
    candidates: candidates.length,
    suggested,
    auto_confirmed: autoConfirmed,
    unmatched: after.filter((l) => l.match_status === "UNMATCHED").length,
  };
}

/**
 * Confirm one suggestion.
 *
 * The unique partial index `ux_recon_match_journal_once` is what actually
 * guarantees a ledger line is used once; the pre-check here exists to turn its
 * 23505 into a sentence a treasurer can act on.
 */
async function confirmMatch(client, { matchId, actor }) {
  const match = await repo.getMatch(client, matchId);
  if (!match) throw new AppError("NOT_FOUND", "Match not found", 404);
  if (match.status === "CONFIRMED") return match;

  const actorId = await resolveActorId(client, actor && actor.user_id);
  await client.query("BEGIN");
  try {
    const { rows: clash } = await client.query(
      `SELECT match_id, statement_line_id FROM reconciliation_match
        WHERE journal_line_id = $1 AND status = 'CONFIRMED' AND match_id <> $2`,
      [match.journal_line_id, matchId],
    );
    if (clash.length) {
      throw new AppError(
        "LEDGER_LINE_ALREADY_MATCHED",
        "That ledger posting is already reconciled against a different statement line. Un-match it first if this is the correct pairing.",
        409,
        { existing_match_id: clash[0].match_id, statement_line_id: clash[0].statement_line_id },
      );
    }

    const updated = await repo.updateMatch(client, matchId, {
      status: "CONFIRMED", confirmed_by: actorId, confirmed_at: new Date(),
    });
    // Every other suggestion on the same statement line is now moot.
    await client.query(
      `DELETE FROM reconciliation_match
        WHERE statement_line_id = $1 AND match_id <> $2 AND status = 'SUGGESTED'`,
      [match.statement_line_id, matchId],
    );
    const line = await repo.refreshLineMatchState(client, match.statement_line_id);

    await audit(client, {
      actorUserId: actor && actor.user_id ? actor.user_id : null, action: events.MATCH_CONFIRMED,
      moduleKey: events.MODULE, entityRef: "reconciliation_match:" + matchId, after: updated,
    });
    await client.query("COMMIT");
    return { match: updated, line };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/** Reject a suggestion (or undo a confirmation). The pairing is kept, marked. */
async function rejectMatch(client, { matchId, reason, actor }) {
  const match = await repo.getMatch(client, matchId);
  if (!match) throw new AppError("NOT_FOUND", "Match not found", 404);

  const actorId = await resolveActorId(client, actor && actor.user_id);
  await client.query("BEGIN");
  try {
    const updated = await repo.updateMatch(client, matchId, {
      status: "REJECTED", rejected_by: actorId, rejected_at: new Date(), reject_reason: reason || null,
    });
    const line = await repo.refreshLineMatchState(client, match.statement_line_id);
    await audit(client, {
      actorUserId: actor && actor.user_id ? actor.user_id : null, action: events.MATCH_REJECTED,
      moduleKey: events.MODULE, entityRef: "reconciliation_match:" + matchId, after: updated,
    });
    await client.query("COMMIT");
    return { match: updated, line };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * Pair a statement line with a ledger line by hand.
 *
 * Recorded at tier 9 with confidence 1: a human said so, which is the strongest
 * evidence available and also the reason it sits outside the scored ladder.
 */
async function manualMatch(client, { statementLineId, journalLineId, actor }) {
  const line = await repo.getLine(client, statementLineId);
  if (!line) throw new AppError("NOT_FOUND", "Statement line not found", 404);

  const actorId = await resolveActorId(client, actor && actor.user_id);
  await client.query("BEGIN");
  try {
    const { rows: clash } = await client.query(
      "SELECT match_id FROM reconciliation_match WHERE journal_line_id = $1 AND status = 'CONFIRMED'",
      [journalLineId],
    );
    if (clash.length) {
      throw new AppError("LEDGER_LINE_ALREADY_MATCHED", "That ledger posting is already reconciled against another statement line.", 409);
    }
    const match = await repo.upsertMatch(client, {
      statement_line_id: statementLineId,
      journal_line_id: journalLineId,
      treasury_account_id: line.treasury_account_id,
      amount: Number(line.amount),
      tier: 9,
      confidence: 1,
      method: "MANUAL",
      reasons: ["matched by hand"],
      status: "CONFIRMED",
      confirmed_by: actorId,
      confirmed_at: new Date(),
    });
    await client.query(
      "DELETE FROM reconciliation_match WHERE statement_line_id = $1 AND status = 'SUGGESTED'",
      [statementLineId],
    );
    const refreshed = await repo.refreshLineMatchState(client, statementLineId);
    await audit(client, {
      actorUserId: actor && actor.user_id ? actor.user_id : null, action: events.MATCH_CONFIRMED,
      moduleKey: events.MODULE, entityRef: "reconciliation_match:" + (match && match.match_id),
      after: match, metadata: { manual: true },
    });
    await client.query("COMMIT");
    return { match, line: refreshed };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/** Set a line aside (a transfer between our own accounts, an advice, a known duplicate). */
async function ignoreLine(client, { statementLineId, reason, actor }) {
  const line = await repo.getLine(client, statementLineId);
  if (!line) throw new AppError("NOT_FOUND", "Statement line not found", 404);
  const updated = await repo.updateLine(client, statementLineId, {
    match_status: "IGNORED", ignored_reason: reason || "set aside by the treasurer",
  });
  await audit(client, {
    actorUserId: actor && actor.user_id ? actor.user_id : null, action: events.LINE_IGNORED,
    moduleKey: events.MODULE, entityRef: "bank_statement_line:" + statementLineId,
    before: line, after: updated,
  });
  return updated;
}

/* ══ The etat de rapprochement ═════════════════════════════════════════════ */

/**
 * Build (or refresh) the reconciliation statement for a period.
 *
 * This is the deliverable — the document an auditor asks for and the DSF file
 * keeps — not the matching screen's internal state. It reconciles two balances
 * through the outstanding items that explain their difference:
 *
 *   ledger + deposits in transit − outstanding payments
 *          + unrecorded credits  − unrecorded debits    = statement
 *
 * The four middle terms are computed, not typed:
 *
 *   deposits in transit / outstanding payments — ledger lines in the period
 *     that NO confirmed match explains. We booked them; the bank has not shown
 *     them yet. Split by direction: money in is a deposit in transit, money out
 *     is an unpresented payment.
 *
 *   unrecorded credits / debits — statement lines that no ledger line explains.
 *     The bank has them; we have not booked them. These are the ones that
 *     become proposed DRAFT entries.
 *
 * `unexplained_difference` is what the identity fails to close, and
 * `chk_recon_approved_balances` refuses to let a reconciliation be approved
 * while it is non-zero. Everything above is arithmetic; the only judgement is
 * which pairings a human confirmed.
 *
 * Idempotent: re-running for the same period refreshes the open draft
 * (`ux_recon_open_period`) rather than breeding drafts.
 */
async function buildReconciliation(client, { treasuryAccountId, statementId, periodStart, periodEnd, actor }) {
  const account = await requireAccount(client, treasuryAccountId);

  let statement = null;
  if (statementId) {
    statement = await repo.getStatement(client, statementId);
    if (!statement) throw new AppError("NOT_FOUND", "Statement not found", 404);
    if (String(statement.treasury_account_id) !== String(treasuryAccountId)) {
      throw new AppError("VALIDATION_ERROR", "That statement belongs to a different treasury account", 422);
    }
  }

  const from = periodStart || (statement && statement.period_start);
  const to = periodEnd || (statement && statement.period_end);
  if (!from || !to) {
    throw new AppError("VALIDATION_ERROR", "A period is required — pass period_start and period_end, or a statement that declares them", 422);
  }

  const ledgerBalance = await repo.ledgerBalanceAsAt(client, { accountCode: account.coa_code, asAt: to });

  // Statement side. The closing balance the bank declared is authoritative
  // where it gave one; otherwise it is derived from opening + movements.
  const lines = statement
    ? await repo.listLines(client, { statementId: statement.statement_id, limit: 5000 })
    : [];
  const live = lines.filter((l) => l.duplicate_of === null && l.match_status !== "IGNORED");
  const movement = live.reduce((sum, l) => sum + Number(l.amount), 0);
  const statementBalance = statement && (statement.closing_balance_declared !== null && statement.closing_balance_declared !== undefined)
    ? Number(statement.closing_balance_declared)
    : (statement && (statement.opening_balance_declared !== null && statement.opening_balance_declared !== undefined)
      ? Number(statement.opening_balance_declared) + movement
      : ledgerBalance + movement);

  // Outstanding items — ours, not yet theirs.
  const unmatchedLedger = await repo.unmatchedLedgerLines(client, { accountCode: account.coa_code, from, to });
  let depositsInTransit = 0;
  let outstandingPayments = 0;
  for (const l of unmatchedLedger) {
    const signed = Number(l.debit || 0) - Number(l.credit || 0);
    if (signed > 0) depositsInTransit += signed;
    else outstandingPayments += Math.abs(signed);
  }

  // Unrecorded items — theirs, not yet ours.
  const unmatchedStatement = live.filter((l) => l.match_status === "UNMATCHED" || l.match_status === "SUGGESTED");
  let unrecordedCredits = 0;
  let unrecordedDebits = 0;
  for (const l of unmatchedStatement) {
    const amount = Number(l.amount);
    if (amount > 0) unrecordedCredits += amount;
    else unrecordedDebits += Math.abs(amount);
  }

  const unexplained = rules.reconciliationDifference({
    ledgerBalance, statementBalance,
    depositsInTransit, outstandingPayments,
    unrecordedCredits, unrecordedDebits,
  });

  const payload = {
    treasury_account_id: treasuryAccountId,
    entity_id: account.entity_id,
    statement_id: statement ? statement.statement_id : null,
    period_start: from,
    period_end: to,
    currency: account.currency || "XAF",
    ledger_balance: ledgerBalance,
    statement_balance: statementBalance,
    deposits_in_transit: depositsInTransit,
    outstanding_payments: outstandingPayments,
    unrecorded_credits: unrecordedCredits,
    unrecorded_debits: unrecordedDebits,
    unexplained_difference: unexplained,
    matched_count: live.filter((l) => l.match_status === "MATCHED").length,
    unmatched_statement_count: unmatchedStatement.length,
    unmatched_ledger_count: unmatchedLedger.length,
  };

  const actorId = await resolveActorId(client, actor && actor.user_id);
  await client.query("BEGIN");
  try {
    const open = await repo.findOpenReconciliation(client, { treasuryAccountId, periodEnd: to });
    if (open && open.status !== "DRAFT") {
      throw new AppError(
        "RECONCILIATION_LOCKED",
        `The reconciliation for the period ending ${to} is already ${open.status} and cannot be rebuilt.`,
        409,
        { reconciliation_id: open.reconciliation_id },
      );
    }

    const row = open
      ? await repo.updateReconciliation(client, open.reconciliation_id, payload)
      : await repo.insertReconciliation(client, {
        ...payload, status: "DRAFT", prepared_by: actorId, prepared_at: new Date(),
      });

    await emitEvent(client, {
      eventTypeKey: events.RECONCILIATION_BUILT, moduleKey: events.MODULE,
      entityRef: reconRef(row.reconciliation_id), actorUserId: actor && actor.user_id ? actor.user_id : null,
    });
    await client.query("COMMIT");

    return {
      reconciliation: row,
      // The working papers behind the numbers, so the screen can show WHY the
      // difference is what it is rather than only that it exists.
      outstanding: {
        deposits_in_transit: unmatchedLedger.filter((l) => Number(l.debit || 0) > 0),
        outstanding_payments: unmatchedLedger.filter((l) => Number(l.credit || 0) > 0),
        unrecorded: unmatchedStatement,
      },
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * Sign off a reconciliation.
 *
 * The database refuses a non-zero unexplained difference
 * (`chk_recon_approved_balances`); this raises that refusal as a sentence
 * before the constraint has to, and records who took responsibility.
 */
async function approveReconciliation(client, { reconciliationId, actor }) {
  const row = await repo.getReconciliation(client, reconciliationId);
  if (!row) throw new AppError("NOT_FOUND", "Reconciliation not found", 404);
  if (row.status === "APPROVED_LOCKED") return row;
  if (Number(row.unexplained_difference) !== 0) {
    throw new AppError(
      "RECONCILIATION_DOES_NOT_BALANCE",
      `This reconciliation still has an unexplained difference of ${Number(row.unexplained_difference).toFixed(2)} ${row.currency}. Every difference must be matched, explained as an outstanding item, or posted before it can be approved.`,
      409,
      { unexplained_difference: row.unexplained_difference },
    );
  }

  const actorId = await resolveActorId(client, actor && actor.user_id);
  await client.query("BEGIN");
  try {
    const updated = await repo.updateReconciliation(client, reconciliationId, {
      status: "APPROVED_LOCKED", approved_by: actorId, approved_at: new Date(),
      content_hash: crypto.createHash("sha256")
        .update(JSON.stringify({
          a: row.treasury_account_id, p: row.period_end,
          l: row.ledger_balance, s: row.statement_balance,
        }), "utf8").digest("hex"),
    });
    if (row.statement_id) await repo.updateStatement(client, row.statement_id, { status: "RECONCILED" });

    await emitEvent(client, {
      eventTypeKey: events.RECONCILIATION_APPROVED, moduleKey: events.MODULE,
      entityRef: reconRef(reconciliationId), actorUserId: actor && actor.user_id ? actor.user_id : null,
    });
    await audit(client, {
      actorUserId: actor && actor.user_id ? actor.user_id : null, action: events.RECONCILIATION_APPROVED,
      moduleKey: events.MODULE, entityRef: reconRef(reconciliationId), before: row, after: updated,
    });
    await client.query("COMMIT");
    return updated;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/* ══ Cash census — reconciliation where no statement exists ════════════════ */

/**
 * Record a physical cash count.
 *
 * Petty cash reconciles the same way as everything else — declared external
 * truth against the ledger — but nobody issues a statement for the tin in the
 * drawer, so the external truth is a count sheet attested by the custodian.
 *
 * `counted_total` is DERIVED from the denominations when they are supplied,
 * never taken on trust beside them: a count sheet whose arithmetic is written
 * by the person being counted is not a control. The `difference` column is
 * generated in the database for the same reason.
 */
async function recordCashCount(client, { treasuryAccountId, countedOn, denominations, countedTotal, witnessUserId, varianceReason, actor }) {
  const account = await requireAccount(client, treasuryAccountId);
  if (!account.requires_custodian && !account.category_code) {
    throw new AppError("VALIDATION_ERROR", "Cash counts apply to cash and petty-cash accounts", 422);
  }

  const denoms = Array.isArray(denominations) ? denominations : [];
  const fromDenoms = denoms.reduce((sum, d) => sum + (Number(d.note || d.denomination || 0) * Number(d.qty || d.quantity || 0)), 0);
  const total = denoms.length ? fromDenoms : Number(countedTotal || 0);
  if (denoms.length && (countedTotal !== null && countedTotal !== undefined) && Math.round(fromDenoms * 100) !== Math.round(Number(countedTotal) * 100)) {
    throw new AppError(
      "COUNT_SHEET_DISAGREES",
      `The denominations add up to ${fromDenoms.toFixed(2)} but the stated total is ${Number(countedTotal).toFixed(2)}. Correct one of them.`,
      422,
    );
  }

  const asAt = countedOn || new Date().toISOString().slice(0, 10);
  const ledgerBalance = await repo.ledgerBalanceAsAt(client, { accountCode: account.coa_code, asAt });
  const limit = (account.float_limit === null || account.float_limit === undefined) ? null : Number(account.float_limit);
  const actorId = await resolveActorId(client, actor && actor.user_id);

  await client.query("BEGIN");
  try {
    const row = await repo.insertCashCount(client, {
      treasury_account_id: treasuryAccountId,
      entity_id: account.entity_id,
      counted_on: asAt,
      currency: account.currency || "XAF",
      denominations: JSON.stringify(denoms),
      counted_total: total,
      ledger_balance: ledgerBalance,
      over_float_limit: (limit !== null && limit !== undefined) && total > limit,
      custodian_user_id: account.custodian_user_id || null,
      witness_user_id: witnessUserId || null,
      variance_reason: varianceReason || null,
      status: "DRAFT",
      counted_by: actorId,
    });
    await emitEvent(client, {
      eventTypeKey: events.CASH_COUNT_RECORDED, moduleKey: events.MODULE,
      entityRef: countRef(row.cash_count_id), actorUserId: actor && actor.user_id ? actor.user_id : null,
    });
    await audit(client, {
      actorUserId: actor && actor.user_id ? actor.user_id : null, action: events.CASH_COUNT_RECORDED,
      moduleKey: events.MODULE, entityRef: countRef(row.cash_count_id), after: row,
    });
    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * The custodian attests the count.
 *
 * Separated from recording it because they are different acts by (potentially)
 * different people: a treasurer may key the sheet, but only the custodian can
 * say the money was there. `chk_cash_count_attested` enforces that an attested
 * count names its custodian.
 */
async function attestCashCount(client, { cashCountId, varianceReason, actor }) {
  const row = await repo.getCashCount(client, cashCountId);
  if (!row) throw new AppError("NOT_FOUND", "Cash count not found", 404);
  if (row.status !== "DRAFT") return row;

  const difference = Number(row.counted_total) - Number(row.ledger_balance);
  const reason = varianceReason || row.variance_reason;
  if (difference !== 0 && !reason) {
    throw new AppError(
      "VARIANCE_UNEXPLAINED",
      `The count is ${difference > 0 ? "over" : "short"} by ${Math.abs(difference).toFixed(2)} ${row.currency}. A variance must carry an explanation before it is attested.`,
      422,
      { difference },
    );
  }

  const actorId = await resolveActorId(client, actor && actor.user_id);
  await client.query("BEGIN");
  try {
    const updated = await repo.updateCashCount(client, cashCountId, {
      status: "ATTESTED",
      attested_at: new Date(),
      custodian_user_id: row.custodian_user_id || actorId,
      variance_reason: reason || null,
    });
    await emitEvent(client, {
      eventTypeKey: events.CASH_COUNT_ATTESTED, moduleKey: events.MODULE,
      entityRef: countRef(cashCountId), actorUserId: actor && actor.user_id ? actor.user_id : null,
    });
    await audit(client, {
      actorUserId: actor && actor.user_id ? actor.user_id : null, action: events.CASH_COUNT_ATTESTED,
      moduleKey: events.MODULE, entityRef: countRef(cashCountId), before: row, after: updated,
      isSensitive: difference !== 0,
    });
    await client.query("COMMIT");
    return updated;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/* ══ Reads ════════════════════════════════════════════════════════════════ */

const listStatements = (client, query = {}) => repo.listStatements(client, {
  treasuryAccountId: query.treasury_account_id,
  status: query.status,
  limit: Math.min(Number(query.limit) || 50, 200),
  offset: Number(query.offset) || 0,
});

async function getStatement(client, statementId, query = {}) {
  const statement = await repo.getStatement(client, statementId);
  if (!statement) return null;
  const lines = await repo.listLines(client, {
    statementId,
    matchStatus: query.match_status || null,
    includeDuplicates: query.include_duplicates === "true" || query.include_duplicates === true,
    limit: Math.min(Number(query.limit) || 500, 2000),
    offset: Number(query.offset) || 0,
  });
  return { statement, lines };
}

const lineMatches = (client, statementLineId) => repo.matchesForLine(client, statementLineId);
const listProfiles = (client, query = {}) => repo.listProfiles(client, { entityId: query.entity_id });
const listReconciliations = (client, query = {}) => repo.listReconciliations(client, {
  treasuryAccountId: query.treasury_account_id, limit: Math.min(Number(query.limit) || 24, 100),
});
const getReconciliation = (client, id) => repo.getReconciliation(client, id);
const listCashCounts = (client, query = {}) => repo.listCashCounts(client, {
  treasuryAccountId: query.treasury_account_id, limit: Math.min(Number(query.limit) || 24, 100),
});

module.exports = {
  preview, confirmProfile, importStatement,
  runMatcher, confirmMatch, rejectMatch, manualMatch, ignoreLine,
  buildReconciliation, approveReconciliation,
  recordCashCount, attestCashCount,
  listStatements, getStatement, lineMatches, listProfiles,
  listReconciliations, getReconciliation, listCashCounts,
  decodeUpload,
};
