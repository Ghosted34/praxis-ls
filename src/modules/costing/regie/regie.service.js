/**
 * Régie d'avance (MOD-49, KB §6.8).
 *
 * Issue posts Dr 581 / Cr <treasury>. Retirement — the part that did not exist
 * before 10717 — posts Dr 4731 (per dossier) / Cr 581 for a receipt, Dr 571 /
 * Cr 581 for returned cash, Dr 658 / Cr 581 for a write-off, and is what makes
 * 581 net to zero. Aging past the policy window reclassifies the OPEN balance
 * Dr 4211 / Cr 581 (a receivable from the holder) — never auto-allocated to
 * 4731 — and is reversible via `unage` when the holder finally produces
 * receipts.
 *
 * TWO RULES THIS FILE ENFORCES THAT ARE EASY TO GET WRONG
 *
 * 1. The advance's `justified_amount` / `returned_amount` are a CACHE. They are
 *    recomputed from `regie_retirement` on every change, never incremented. An
 *    increment drifts the moment a retirement is corrected, and those two
 *    columns are what `openBalance` — and therefore aging — depends on.
 *
 * 2. Every account and journal code comes from tenant settings
 *    (`finance.regie`, seed 9094). The JS fallbacks below are last-resort only.
 *    NOTE the treasury fallback is '5211', not '521': 521 is a non-postable
 *    grouping (9000:77) and the ledger trigger `assert_line_valid` (0640:150)
 *    rejects it outright.
 */
"use strict";

const repo = require("./regie.repo");
const events = require("./regie.events");
const rules = require("./regie.rules");
const journalEntry = require("../../finance/journal_entry/journal_entry.service");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");
// Reused rather than re-implemented: a failed statement inside a transaction
// poisons it, so the best-effort compliance flag in ageOne needs a savepoint.
const { withSavepoint } = require("../../../services/documents/operation-reference");
const { AppError } = require("../../../utils/errors");
const { getRule } = require("../../../shared/config/settings");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const executor = require("../../../services/workflow/executor");

const ref = (id) => "regie_advance:" + id;

/**
 * Last-resort account map. Every one of these is overridden by the
 * `finance.regie` setting that 9094 seeds; they exist only so an un-seeded
 * tenant still posts to something valid rather than crashing.
 */
const FALLBACK_ACCOUNTS = {
  regie: "581",
  treasury: "5211", // the POSTABLE leaf under 521 — see the file header
  cash: "571",
  holder_receivable: "4211",
  dossier_mandant: "4731",
  write_off: "658",
};
const FALLBACK_JOURNALS = { issue: "BQ", retire: "OD", age: "OD" };

/** Resolve the tenant's régie policy once per operation. */
async function policy(client) {
  const [accounts, journals, requireProof, allowPartial, warnDays] = await Promise.all([
    getRule(client, "finance", "regie", "accounts", null),
    getRule(client, "finance", "regie", "journals", null),
    getRule(client, "finance", "regie", "require_proof_for_receipt", true),
    getRule(client, "finance", "regie", "allow_partial_justification", false),
    getRule(client, "finance", "regie", "warn_before_window_days", 2),
  ]);
  return {
    accounts: { ...FALLBACK_ACCOUNTS, ...(accounts || {}) },
    journals: { ...FALLBACK_JOURNALS, ...(journals || {}) },
    // Both default to the STRICTER option: the KB states proof as a rule, and a
    // "justified" request over an open advance is the defect Landing A exists to
    // remove. A tenant may relax either; the default must not.
    requireProofForReceipt: requireProof !== false,
    allowPartialJustification: allowPartial === true,
    warnBeforeWindowDays: Number(warnDays) || 0,
  };
}

/**
 * The advance's amount expressed in XAF, for approval-threshold routing.
 * `workflow_step.min_amount_xaf` / `max_amount_xaf` compare against this, so an
 * EUR advance must be converted or every threshold would misfire.
 */
const amountXaf = (advance) =>
  Math.round(Number(advance.amount || 0) * Number(advance.exchange_rate_to_xaf || 1) * 100) / 100;

// ── Issue ───────────────────────────────────────────────────────────────────

async function issue(client, opts) {
  const {
    holderUserId = null, amount, entityId, entryDate, sourceDocRef,
    currency = "XAF", exchangeRateToXaf = 1,
    treasuryCoa = null, regieCoa = null, policyWindowDays = null,
    actor = {}, ip = null,
  } = opts;
  if (!(Number(amount) > 0)) throw new AppError("BAD_AMOUNT", "amount must be > 0", 422);

  const pol = await policy(client);
  const treasury = treasuryCoa || pol.accounts.treasury;
  const regieAccount = regieCoa || pol.accounts.regie;
  // Business rule read from tenant settings (finance.regie.policy_window_days),
  // fallback 7. Frozen onto the row so a later change to the tenant default
  // cannot retroactively age advances already in flight.
  const windowDays = typeof policyWindowDays === "number"
    ? policyWindowDays
    : await getRule(client, "finance", "regie", "policy_window_days", 7);

  await client.query("BEGIN");
  try {
    const { entry } = await journalEntry.buildAndInsert(client, {
      journalCode: pol.journals.issue, entityId, entryDate,
      description: "Régie d'avance issued", sourceDocRef, source: "SYSTEM_RULE",
      lines: [
        { account_code: regieAccount, debit: amount, credit: 0 },
        { account_code: treasury, debit: 0, credit: amount },
      ],
      validate: true, actor, ip,
    });
    // Allocate the number BEFORE insert so it persists on the row (doc_number),
    // rather than being computed and thrown away.
    const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId, date: entryDate });
    const advance = await repo.insertAdvance(client, {
      holder_user_id: holderUserId, amount, issued_on: entryDate,
      currency, exchange_rate_to_xaf: exchangeRateToXaf,
      policy_window_days: windowDays, issue_entry_id: entry.entry_id, state: "ISSUED",
      entity_id: entityId, doc_number: number,
    });
    await documents.capture(client, { entityRef: ref(advance.regie_advance_id), docType: "REGIE_ADVANCE", status: "VERIFIED" });

    // Open the tenant's approval chain if one is bound to regie.issued (seeded
    // as approvable by 9094). No workflow bound → { autoApproved: true }, which
    // is the default shipped state: the money has already left the bank, so the
    // advance is recorded either way. This is what makes the gate CONFIGURABLE
    // rather than hardcoded — see the note in 9094.
    const chain = await executor.start(client, {
      eventTypeKey: events.ISSUED,
      entityRef: ref(advance.regie_advance_id),
      amountXaf: amountXaf(advance),
      actorUserId: actor.user_id || null,
    });

    await emitEvent(client, { eventTypeKey: events.ISSUED, moduleKey: events.MODULE, entityRef: ref(advance.regie_advance_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ISSUED, moduleKey: events.MODULE, entityRef: ref(advance.regie_advance_id), after: advance, ip });
    await client.query("COMMIT");
    return { entry, advance, approval: chain };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

// ── Retirement — KB §6.8 steps 2, 3 and 5 ───────────────────────────────────

/**
 * Record one retirement and re-derive the advance from ALL of its children.
 *
 * The recompute (rather than an increment) is the whole point of the child
 * table; see rule 1 in the file header. `getForUpdate` serialises concurrent
 * retirements — without the row lock two simultaneous receipts would both read
 * the same pre-insert totals and the second would clobber the first.
 */
/**
 * The retirement itself, WITHOUT transaction management.
 *
 * Split from `retire` for the same reason `journalEntry.buildAndInsert` is split
 * from `journalEntry.post`: a caller that is already inside a transaction —
 * `cash_request.justify` closing a request and its advance together — must be
 * able to compose this without nesting a second BEGIN. Postgres has no nested
 * transactions, so an inner COMMIT would commit the OUTER caller's work early
 * and leave the rest unprotected.
 */
async function retireCore(client, opts) {
  const {
    advanceId, kind, dossierId = null, amount, proofVaultId = null, memo = null,
    entityId = null, entryDate = null, sourceDocRef = null, actor = {}, ip = null,
    policy: pol,
  } = opts;

  const advance = await repo.getForUpdate(client, advanceId);
  if (!advance) throw new AppError("NOT_FOUND", "Régie advance not found", 404);

  rules.assertRetirable(
    advance,
    { kind, amount, dossierId, proofVaultId },
    { requireProofForReceipt: pol.requireProofForReceipt },
  );

  const postingEntity = entityId || advance.entity_id;
  if (!postingEntity) {
    throw new AppError("ENTITY_REQUIRED", "entityId is required (this advance predates 10717 and has none stored)", 422);
  }
  const date = entryDate || new Date().toISOString().slice(0, 10);

  const { entry } = await journalEntry.buildAndInsert(client, {
    journalCode: pol.journals.retire, entityId: postingEntity, entryDate: date,
    description: "Régie d'avance retired — " + kind,
    sourceDocRef: sourceDocRef || ref(advanceId), source: "SYSTEM_RULE",
    lines: rules.retirementLines({ kind, amount, dossierId }, pol.accounts),
    validate: true, actor, ip,
  });

  const retirement = await repo.insertRetirement(client, {
    regie_advance_id: advanceId, kind, dossier_id: dossierId,
    amount, proof_vault_id: proofVaultId, entry_id: entry.entry_id,
    memo, retired_on: date,
    // DATA 2.4 — see the note in cash_request.service.disburse. The journal
    // entry above is already written at this point, so a 23503 here would roll
    // back a retirement that had otherwise fully succeeded.
    created_by: await resolveActorId(client, actor.user_id),
  });

  // Re-derive from every child, including the one just inserted.
  const totals = rules.totalsFrom(await repo.listRetirements(client, advanceId));
  const nextState = rules.recomputeState(advance, totals);
  rules.assertTransition(advance.state, nextState);

  const patch = { ...totals, state: nextState };
  if (nextState === "JUSTIFIED") patch.closed_on = date;
  const updated = await repo.setState(client, advanceId, patch);

  await emitEvent(client, { eventTypeKey: events.RETIRED, moduleKey: events.MODULE, entityRef: ref(advanceId), actorUserId: actor.user_id || null });
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.RETIRED, moduleKey: events.MODULE,
    entityRef: ref(advanceId), before: advance, after: updated, ip,
  });
  return { advance: updated, retirement, entry };
}

/**
 * Record one retirement and re-derive the advance from ALL of its children.
 *
 * The recompute (rather than an increment) is the whole point of the child
 * table; see rule 1 in the file header. `getForUpdate` serialises concurrent
 * retirements — without the row lock two simultaneous receipts would both read
 * the same pre-insert totals and the second would clobber the first.
 */
async function retire(client, opts) {
  const pol = opts.policy || (await policy(client));
  await client.query("BEGIN");
  try {
    const result = await retireCore(client, { ...opts, policy: pol });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * Hold an advance as a query (KB §6.8 step 5). No posting — the money has not
 * moved; this records that its justification is disputed. Reachable from any
 * open state, which is why it is the pressure valve that keeps
 * `require_proof_for_receipt` strict: a holder with no receipt is queried, not
 * waved through with an undocumented 4731 line.
 */
async function query(client, { advanceId, reason = null, actor = {}, ip = null }) {
  await client.query("BEGIN");
  try {
    const advance = await repo.getForUpdate(client, advanceId);
    if (!advance) throw new AppError("NOT_FOUND", "Régie advance not found", 404);
    rules.assertTransition(advance.state, "QUERIED");

    const updated = await repo.setState(client, advanceId, { state: "QUERIED" });
    await emitEvent(client, { eventTypeKey: events.QUERIED, moduleKey: events.MODULE, entityRef: ref(advanceId), actorUserId: actor.user_id || null });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.QUERIED, moduleKey: events.MODULE,
      entityRef: ref(advanceId), before: advance, after: { ...updated, reason }, ip,
    });
    await client.query("COMMIT");
    return updated;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * Write the open balance off to sundry charges (KB §6.8 step 5).
 *
 * Only from QUERIED — `assertRetirable` enforces it — because a write-off is
 * the end of a dispute, not a shortcut around one. Routed through the approval
 * chain when the tenant has bound one to `regie.write_off`: this is the
 * highest-stakes act in the module and the one most worth an amount threshold.
 */
async function writeOff(client, opts) {
  const { advanceId, amount = null, actor = {} } = opts;
  const advance = await repo.get(client, advanceId);
  if (!advance) throw new AppError("NOT_FOUND", "Régie advance not found", 404);

  const chain = await executor.start(client, {
    eventTypeKey: events.WRITE_OFF,
    entityRef: ref(advanceId),
    amountXaf: Math.round(Number(amount ?? rules.openBalance(advance)) * Number(advance.exchange_rate_to_xaf || 1) * 100) / 100,
    actorUserId: actor.user_id || null,
  });
  // A chain was opened: the write-off is pending a decision, so nothing posts
  // yet. The Approvals surface completes it via the on-approved hook.
  if (chain && chain.autoApproved === false) return { advance, approval: chain, posted: false };

  const result = await retire(client, {
    ...opts,
    kind: "WRITE_OFF",
    amount: amount ?? rules.openBalance(advance),
  });
  return { ...result, approval: chain, posted: true };
}

/**
 * Reverse an aging reclassification (Dr 581 / Cr 4211) so a late-justifying
 * holder can retire normally.
 *
 * Without this, aging is a one-way door: the balance sits in 4211 and a receipt
 * cannot post against 581 because 581 is already flat. `journalEntry.reverse`
 * writes the linked contra entry and enforces one-reversal-per-entry via
 * `ux_one_reversal_per_entry` (0464:59), so this cannot double-unage.
 *
 * NOTE `reverse` manages its own BEGIN/COMMIT, so this function deliberately
 * does NOT wrap it in an outer transaction — nesting would commit the reversal
 * early and leave the state update unprotected. The state write follows it and
 * is a single statement.
 */
async function unage(client, { advanceId, entryDate = null, reason = null, actor = {}, ip = null }) {
  const advance = await repo.get(client, advanceId);
  if (!advance) throw new AppError("NOT_FOUND", "Régie advance not found", 404);
  if (advance.state !== "AGED_UNJUSTIFIED") {
    throw new AppError("NOT_AGED", "Only an aged advance can be un-aged", 422);
  }
  if (!advance.aged_entry_id) {
    // Advances aged before 10717 have no stored entry reference, so the
    // reclassification cannot be reversed automatically. Say so plainly rather
    // than posting a second, unlinked entry that would break the
    // one-reversal-per-entry invariant's intent.
    throw new AppError(
      "NO_AGING_ENTRY",
      "This advance was aged before its reclassification entry was recorded; reverse it manually from the ledger",
      422,
    );
  }

  await journalEntry.reverse(client, {
    entryId: advance.aged_entry_id,
    reason: reason || "Régie advance justified after aging",
    entryDate, actor, ip,
  });

  // Back to whatever the retirements say it is — ISSUED if untouched, or
  // PARTIALLY_JUSTIFIED if some receipts had already been filed.
  const totals = rules.totalsFrom(await repo.listRetirements(client, advanceId));
  const consumed = Number(totals.justified_amount) + Number(totals.returned_amount);
  const restored = consumed > 0 ? "PARTIALLY_JUSTIFIED" : "ISSUED";
  rules.assertTransition(advance.state, restored);

  const updated = await repo.setState(client, advanceId, {
    ...totals, state: restored, aged_entry_id: null,
  });
  await emitEvent(client, { eventTypeKey: events.UNAGED, moduleKey: events.MODULE, entityRef: ref(advanceId), actorUserId: actor.user_id || null });
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.UNAGED, moduleKey: events.MODULE,
    entityRef: ref(advanceId), before: advance, after: updated, ip,
  });
  return updated;
}

// ── Aging ───────────────────────────────────────────────────────────────────

/** Reclassify one advance's open balance 581 -> 4211. Idempotent per advance. */
async function ageOne(client, advance, opts) {
  const { entityId, entryDate, sourceDocRef, holderReceivableCoa = null, regieCoa = null, actor = {}, ip = null } = opts;
  const open = rules.openBalance(advance);
  if (open <= 0) return null;

  const pol = opts.policy || (await policy(client));
  const receivable = holderReceivableCoa || pol.accounts.holder_receivable;
  const regieAccount = regieCoa || pol.accounts.regie;
  const postingEntity = entityId || advance.entity_id;
  if (!postingEntity) throw new AppError("ENTITY_REQUIRED", "entityId is required", 422);

  await client.query("BEGIN");
  try {
    const { entry } = await journalEntry.buildAndInsert(client, {
      journalCode: pol.journals.age, entityId: postingEntity, entryDate,
      description: "Régie d'avance aged — reclassified to holder receivable", sourceDocRef, source: "SYSTEM_RULE",
      lines: [
        { account_code: receivable, debit: open, credit: 0 },
        { account_code: regieAccount, debit: 0, credit: open },
      ],
      validate: true, actor, ip,
    });
    // Store the entry so the reclassification can be reversed. Before 10717 this
    // was posted and forgotten, which made aging irreversible.
    const updated = await repo.setState(client, advance.regie_advance_id, {
      state: "AGED_UNJUSTIFIED", aged_entry_id: entry.entry_id,
    });

    // MOD-65 half of KB §6.8's closing sentence: "MOD-49 owns issuance and
    // retirement; MOD-65 raises the aging flag." The event was emitted but the
    // flag never was, and `compliance_flag`'s own DDL comment (0340:29) names
    // 'advance.aged_unjustified' as an intended rule_key.
    //
    // THE SAVEPOINT IS LOAD-BEARING, and this catch was a real bug before it.
    // The intent is best-effort — a failure to raise the flag must not roll
    // back a correct reclassification — but a bare try/catch does NOT buy that
    // inside a transaction. We are between BEGIN and COMMIT, and Postgres
    // aborts the whole transaction on any statement error: after a failed
    // INSERT every later statement answers 25P02 "current transaction is
    // aborted", so the emitEvent, the audit and the COMMIT below would all
    // fail and the reclassification would be lost — the exact outcome the
    // comment promised to prevent. withSavepoint scopes the failure so only
    // the flag is rolled back.
    try {
      await withSavepoint(client, "regie_aging_flag", () =>
        client.query(
          "INSERT INTO compliance_flag (rule_key, entity_ref, severity, message) VALUES ($1,$2,$3,$4)",
          [
            events.AGED,
            ref(advance.regie_advance_id),
            "WARN",
            `Advance ${advance.doc_number || advance.regie_advance_id} unjustified ${rules.daysBetween(advance.issued_on, entryDate)} days after issue; ${open} reclassified to holder receivable`,
          ],
        ),
      );
    } catch (flagErr) {
      /* @silent:storage — the advisory flag is a secondary record; the
         savepoint above already undid it, and the reclassification it
         annotates is the operation that must survive. */
      logger.warn({ err: flagErr, advance: advance.regie_advance_id }, "regie aging flag not raised");
    }

    await emitEvent(client, { eventTypeKey: events.AGED, moduleKey: events.MODULE, entityRef: ref(advance.regie_advance_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.AGED, moduleKey: events.MODULE, entityRef: ref(advance.regie_advance_id), after: updated, ip });
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
  const pol = await policy(client);
  const candidates = await repo.listAgeable(client);
  const aged = [];
  for (const adv of candidates) {
    if (!rules.isAged(adv, today)) continue;
    /// eslint-disable-next-line no-await-in-loop
    const res = await ageOne(client, adv, { ...opts, policy: pol, entryDate: opts.entryDate || today });
    if (res) aged.push(adv.regie_advance_id);
  }
  return { aged, count: aged.length };
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * One advance, with everything the detail view needs: its retirement ledger,
 * the derived balance, and the transitions the SERVER says are available.
 *
 * `next` ships from here so the client renders the actions the state machine
 * allows rather than keeping a second copy of `NEXT` in TSX — two copies drift.
 */
async function get(client, id) {
  const advance = await repo.get(client, id);
  if (!advance) return null;
  const today = new Date().toISOString().slice(0, 10);
  const pol = await policy(client);
  advance.retirements = await repo.listRetirements(client, id);
  advance.open_balance = rules.openBalance(advance);
  advance.amount_xaf = amountXaf(advance);
  advance.days_to_window = rules.daysToWindow(advance, today);
  advance.is_aged = rules.isAged(advance, today);
  advance.is_due_soon = rules.isDueSoon(advance, today, pol.warnBeforeWindowDays);
  advance.next = rules.NEXT[advance.state] || [];
  return advance;
}

const list = (client, q) => repo.list(client, q);

/**
 * "My advances" — what THIS holder still owes justification for.
 *
 * Every other surface in this module is finance-facing, but the person who owes
 * the receipts is the holder, and nothing told them so. An advance nobody is
 * asked about ages by default, which turns the 4211 reclassification into
 * routine bookkeeping instead of the exception it is meant to be.
 *
 * Self-scoped: the caller's own user id is passed by the controller from
 * req.user, never from the query string, so this cannot be pointed at someone
 * else's float. That is why the route carries no MOD-49 grant — the same
 * pattern as hr_query's /mine.
 */
async function mine(client, holderUserId, q = {}) {
  if (!holderUserId) return [];
  const today = q.today || new Date().toISOString().slice(0, 10);
  const pol = await policy(client);
  const rows = await repo.list(client, {
    holder_user_id: holderUserId,
    open: "true",
    limit: q.limit,
    offset: q.offset,
  });
  return rows
    .map((r) => ({
      ...r,
      open_balance: rules.openBalance(r),
      days_to_window: rules.daysToWindow(r, today),
      is_aged: rules.isAged(r, today),
      is_due_soon: rules.isDueSoon(r, today, pol.warnBeforeWindowDays),
    }))
    .sort((a, b) => a.days_to_window - b.days_to_window);
}

/** The aging watchlist: open advances at or past their own window. */
async function watchlist(client, q = {}) {
  const today = q.today || new Date().toISOString().slice(0, 10);
  const pol = await policy(client);
  const rows = await repo.listAgeable(client);
  return rows
    .filter((r) => rules.isAged(r, today) || rules.isDueSoon(r, today, pol.warnBeforeWindowDays))
    .map((r) => ({
      ...r,
      open_balance: rules.openBalance(r),
      days_to_window: rules.daysToWindow(r, today),
      is_aged: rules.isAged(r, today),
    }))
    .sort((a, b) => a.days_to_window - b.days_to_window);
}

module.exports = {
  issue, retire, retireCore, query, writeOff, unage, ageOne, ageDue,
  get, list, watchlist, mine, policy,
};
