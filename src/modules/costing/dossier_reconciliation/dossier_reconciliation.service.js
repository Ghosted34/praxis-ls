/**
 * Budget Reconciliation (MOD-76) — what an operations file actually cost, per
 * budget line, evidenced, and the cash returned to the vault.
 *
 * The third leg of budget → cash → actual. The costing is the budget
 * (12766–12774), the cash request draws it down (12771), and this says what was
 * really spent against each drawn line.
 *
 *   OPEN ──submit──> SUBMITTED ──settle──> SETTLED
 *     ↑                   │                   │
 *     └──── reject ───────┘                   │
 *     └──── the costing was amended, or more cash went out (reopen) ──┘
 *
 * ONE ROW PER FILE, FOR EVER (owner decision Q6). It does not close; it settles,
 * and re-opens when the facts move. Prepared by Operations, settled by Finance,
 * and the MD is told rather than asked.
 *
 * ── READS NEVER WRITE ───────────────────────────────────────────────────────
 *
 * There is no "draft it" step and no create endpoint. `sheetFor` renders every
 * budget line on the file's approved costing whether or not this module has ever
 * stored anything, and the header row is created lazily by the first WRITE. So a
 * person with only `view` never causes an insert, a GET stays idempotent, and
 * the header is exactly as sparse as the lines are.
 */
"use strict";

const repo = require("./dossier_reconciliation.repo");
const rules = require("./dossier_reconciliation.rules");
const events = require("./dossier_reconciliation.events");
const costRepo = require("../cost_tracking/cost_tracking.repo");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { getSetting } = require("../../../shared/config/settings");
const { AppError } = require("../../../utils/errors");
const { accountFor } = require("../../../shared/config/finance-accounts");
const costTracking = require("../cost_tracking/cost_tracking.service");
const regie = require("../regie/regie.service");
const journalEntry = require("../../finance/journal_entry/journal_entry.service");
const crypto = require("crypto");

const MODULE = events.MODULE;
const ref = (id) => "dossier_reconciliation:" + id;

/* ═══════════════════════════ Reading the sheet ═══════════════════════════ */

/**
 * The sheet for an operations file: header, grid, totals, grades, documents.
 *
 * The grid comes from `costing_line` (see the repo's header), so a costing
 * amended five minutes ago is already reflected and a line nobody has touched
 * still renders. Nothing here writes.
 */
async function sheetFor(client, { dossierId }) {
  if (!dossierId) throw new AppError("VALIDATION_ERROR", "dossier_id is required", 422);

  const [header, costing, setting] = await Promise.all([
    repo.forDossier(client, dossierId),
    repo.approvedCosting(client, dossierId),
    getSetting(client, "finance", "reconciliation", null),
  ]);
  const allowance = rules.allowanceFrom(setting || {});

  // No approved costing means no budget, and owner decision Q11 is that no
  // spend happens on an operations file without one. So the sheet does not
  // improvise a grid — it says what is missing and points at the costing.
  if (!costing || costing.status !== "APPROVED_LOCKED") {
    return {
      dossier_id: dossierId,
      reconciliation_id: header ? header.reconciliation_id : null,
      status: header ? header.status : "OPEN",
      costing: costing || null,
      can_reconcile: false,
      blocked_reason: costing
        ? `The file's costing (${costing.doc_number || costing.costing_id}) is ${costing.status} — a budget has to be approved before what was spent against it can be reconciled.`
        : "This file has no costing yet. The costing is the budget, so there is nothing to reconcile against.",
      lines: [],
      documents: [],
      allowance,
      ...rules.summarise([]),
    };
  }

  const rows = await repo.gridFor(client, {
    dossierId,
    reconciliationId: header ? header.reconciliation_id : null,
  });
  const lines = rows.map((r) => rules.lineView(r, allowance));

  const [documents, settlements] = header
    ? await Promise.all([repo.documentsFor(client, header.reconciliation_id), repo.settlements(client, header.reconciliation_id)])
    : [[], []];

  // Group the documents onto their lines so the grid, the line modal and the
  // file's 360 all read one shape.
  const byLine = new Map();
  for (const d of documents) {
    if (!byLine.has(d.costing_line_id)) byLine.set(d.costing_line_id, []);
    byLine.get(d.costing_line_id).push(d);
  }
  for (const l of lines) l.documents = byLine.get(l.costing_line_id) || [];

  const summary = rules.summarise(lines, { quotedHt: header ? header.quoted_ht : null });

  return {
    dossier_id: dossierId,
    reconciliation_id: header ? header.reconciliation_id : null,
    status: header ? header.status : "OPEN",
    revision: header ? header.revision : 1,
    currency: header ? header.currency : costing.currency,
    exchange_rate_to_xaf: header ? Number(header.exchange_rate_to_xaf) : Number(costing.exchange_rate_to_xaf),
    submitted_by: header ? header.submitted_by : null,
    submitted_at: header ? header.submitted_at : null,
    settled_by: header ? header.settled_by : null,
    settled_at: header ? header.settled_at : null,
    returned_total: header ? Number(header.returned_total) : 0,
    reject_reason: header ? header.reject_reason : null,
    reopened_reason: header ? header.reopened_reason : null,
    costing,
    can_reconcile: true,
    blocked_reason: null,
    lines,
    documents,
    settlements,
    allowance,
    blockers: rules.submissionBlockers(lines),
    ...summary,
  };
}

const get = (client, id) => repo.get(client, id).then((row) => {
  if (!row) throw new AppError("NOT_FOUND", "Reconciliation not found", 404);
  return sheetFor(client, { dossierId: row.dossier_id });
});

/* ═════════════════════════ Writing a line ════════════════════════════════ */

/**
 * The header, created on demand by the first write. `open` upserts against
 * `uq_reconciliation_one_per_dossier`, so two people typing at once get the
 * same row rather than one of them getting a 23505.
 */
async function ensureOpen(client, { dossierId, actor = {} }) {
  const existing = await repo.forDossier(client, dossierId);
  if (existing) return existing;
  const costing = await repo.approvedCosting(client, dossierId);
  if (!costing || costing.status !== "APPROVED_LOCKED") {
    throw new AppError(
      "NO_APPROVED_COSTING",
      "This file has no approved costing, so there is no budget to reconcile against. Approve the costing first — owner decision Q11: no spend on an operations file without one.",
      422,
      { dossier_id: dossierId, costing_id: costing ? costing.costing_id : null, costing_status: costing ? costing.status : null },
    );
  }
  const opened = await repo.open(client, {
    dossierId,
    actorUserId: actor.user_id || null,
    currency: costing.currency,
    rate: costing.exchange_rate_to_xaf,
  });
  // Belt and braces. `open` inserts ON CONFLICT DO NOTHING and falls back to a
  // SELECT, so the only way here is a row that was deleted between the two —
  // and every caller downstream reads `.status` off this.
  if (!opened) throw new AppError("CONFLICT", "The reconciliation could not be opened — try again", 409);
  return opened;
}

/** A sheet may only be edited while it is OPEN. SUBMITTED is on Finance's desk
 *  and SETTLED is accounted for; in both cases the figures must not shift under
 *  the person looking at them. */
function assertEditable(header) {
  if (header.status !== "OPEN") {
    throw new AppError(
      "BAD_STATE",
      header.status === "SUBMITTED"
        ? "This reconciliation is with Finance. Ask them to send it back before changing it."
        : "This reconciliation has been settled. It re-opens on its own when the costing changes or more cash goes out.",
      422,
      { status: header.status },
    );
  }
}

/**
 * Record what was actually spent against one budget line (Q2, Q7).
 *
 * `fields` distinguishes ABSENT from NULL: a payload that omits `spent_on` is
 * not a payload that clears it, and the repo's COALESCE upsert cannot express
 * the difference on its own — so explicit nulls are collected and cleared in a
 * second statement.
 *
 * `actual_source` is decided here rather than trusted from the caller. Typing
 * the same number the grid already showed is CONFIRMED; typing a different one
 * is OVERRIDDEN. Both are a real act, and neither is the same as DERIVED, which
 * means nobody has looked yet.
 */
async function patchLine(client, { dossierId, costingLineId, fields = {}, actor = {}, ip = null }) {
  const header = await ensureOpen(client, { dossierId, actor });
  assertEditable(header);

  const onFile = await repo.costingLineOnDossier(client, { dossierId, costingLineId });
  if (!onFile) {
    throw new AppError("NOT_FOUND", "That budget line is not on this file's approved costing", 404);
  }

  const write = {};
  const clear = [];
  for (const key of ["actual_ttc", "spent_on", "variance_reason", "returned_amount"]) {
    if (!(key in fields)) continue;
    if (fields[key] === null || fields[key] === "") clear.push(key);
    else write[key] = fields[key];
  }
  if (!Object.keys(write).length && !clear.length) {
    throw new AppError("VALIDATION_ERROR", "Nothing to change", 422);
  }

  if ("actual_ttc" in write) {
    // What the grid was showing before this edit — the derived pre-fill, or
    // whatever was stored. Comparing against it is what makes "I agree" and
    // "no, it was this" different facts.
    const rows = await repo.gridFor(client, { dossierId, reconciliationId: header.reconciliation_id });
    const before = rows.find((r) => r.costing_line_id === costingLineId);
    const shown = before ? rules.lineView(before).actual_ttc : 0;
    write.actual_source = rules.round2(Number(write.actual_ttc)) === shown ? "CONFIRMED" : "OVERRIDDEN";
  }

  // A reason typed straight onto one line leaves any group it was part of: it
  // is now this line's own sentence, not the shared one. This has to go through
  // `clear` — the upsert COALESCEs, so passing null there means "keep", which
  // is the opposite of what is meant.
  if ("variance_reason" in write && !clear.includes("reason_group_id")) clear.push("reason_group_id");

  await client.query("BEGIN");
  try {
    if (Object.keys(write).length) {
      await repo.upsertLine(client, {
        reconciliationId: header.reconciliation_id,
        costingLineId,
        fields: {
          actual_ttc: write.actual_ttc ?? null,
          actual_source: write.actual_source ?? null,
          spent_on: write.spent_on ?? null,
          variance_reason: write.variance_reason ?? null,
          reason_group_id: null,
          returned_amount: write.returned_amount ?? null,
        },
        actorUserId: actor.user_id || null,
      });
    }
    if (clear.length) {
      await repo.clearLineFields(client, {
        reconciliationId: header.reconciliation_id,
        costingLineId,
        fields: clear,
      });
    }
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.LINE_RECORDED, moduleKey: MODULE,
      entityRef: ref(header.reconciliation_id),
      after: { costing_line_id: costingLineId, ...write, cleared: clear }, ip,
    });
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); throw err; }

  return sheetFor(client, { dossierId });
}

/**
 * One reason, several lines (Q12).
 *
 * "If there was a delay in customs due to network and the containers stayed in
 * the port one more day we can have four lines affected — demurrage, port
 * storage, probably yard occupancy and probably another line. So we pick these
 * lines from a UI and it applies at once."
 *
 * The shared `reason_group_id` is what makes this honest: the statement and the
 * audit can say "one reason, four lines" rather than printing four identical
 * sentences and implying four independent judgements.
 */
async function applyReason(client, { dossierId, reason, costingLineIds = [], actor = {}, ip = null }) {
  const text = String(reason || "").trim();
  if (text.length < 3) throw new AppError("VALIDATION_ERROR", "A reason needs some words in it", 422);
  if (!costingLineIds.length) throw new AppError("VALIDATION_ERROR", "Pick at least one line", 422);

  const header = await ensureOpen(client, { dossierId, actor });
  assertEditable(header);

  for (const id of costingLineIds) {
    if (!(await repo.costingLineOnDossier(client, { dossierId, costingLineId: id }))) {
      throw new AppError("NOT_FOUND", "One of those budget lines is not on this file's approved costing", 404, { costing_line_id: id });
    }
  }

  const groupId = crypto.randomUUID();
  await client.query("BEGIN");
  try {
    await repo.applyReasonToLines(client, {
      reconciliationId: header.reconciliation_id,
      costingLineIds, reason: text.slice(0, 2000), groupId,
      actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.LINE_RECORDED, moduleKey: MODULE,
      entityRef: ref(header.reconciliation_id),
      after: { reason_group_id: groupId, lines: costingLineIds.length, reason: text.slice(0, 2000) }, ip,
    });
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); throw err; }

  return sheetFor(client, { dossierId });
}

/* ═══════════════════════════ Documents ═══════════════════════════════════ */

/**
 * Attach a vault document as proof for one budget line (Q8).
 *
 * MANY per line, deliberately: evidence arrives in rounds. The document itself
 * is uploaded through the vault first (so it is hashed, typed and findable from
 * the file's 360), and this records that it proves THIS line.
 */
async function attachDocument(client, { dossierId, costingLineId, docId, note = null, actor = {}, ip = null }) {
  const header = await ensureOpen(client, { dossierId, actor });
  assertEditable(header);
  if (!(await repo.costingLineOnDossier(client, { dossierId, costingLineId }))) {
    throw new AppError("NOT_FOUND", "That budget line is not on this file's approved costing", 404);
  }

  await client.query("BEGIN");
  try {
    // The line row may not exist yet — a person can attach the receipt before
    // typing the amount, and that order is not wrong.
    let line = await repo.lineFor(client, { reconciliationId: header.reconciliation_id, costingLineId });
    if (!line) {
      line = await repo.upsertLine(client, {
        reconciliationId: header.reconciliation_id, costingLineId,
        fields: { actual_ttc: null, actual_source: null, spent_on: null, variance_reason: null, reason_group_id: null, returned_amount: null },
        actorUserId: actor.user_id || null,
      });
    }
    await repo.attachDocument(client, { lineId: line.line_id, docId, note, actorUserId: actor.user_id || null });
    await emitEvent(client, {
      eventTypeKey: events.PROOF_ATTACHED, moduleKey: MODULE,
      entityRef: ref(header.reconciliation_id), actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.PROOF_ATTACHED, moduleKey: MODULE,
      entityRef: ref(header.reconciliation_id), after: { costing_line_id: costingLineId, doc_id: docId }, ip,
    });
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); throw err; }

  return sheetFor(client, { dossierId });
}

/** Detach a document from a line. The vault row survives — evidence is not
 *  destroyed because somebody filed it against the wrong line. */
async function detachDocument(client, { dossierId, costingLineId, docId, actor = {}, ip = null }) {
  const header = await repo.forDossier(client, dossierId);
  if (!header) throw new AppError("NOT_FOUND", "Reconciliation not found", 404);
  assertEditable(header);
  const line = await repo.lineFor(client, { reconciliationId: header.reconciliation_id, costingLineId });
  if (!line) throw new AppError("NOT_FOUND", "Nothing is attached to that line", 404);
  const removed = await repo.detachDocument(client, { lineId: line.line_id, docId });
  if (!removed) throw new AppError("NOT_FOUND", "That document is not attached to this line", 404);
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.PROOF_ATTACHED, moduleKey: MODULE,
    entityRef: ref(header.reconciliation_id), before: { costing_line_id: costingLineId, doc_id: docId }, ip,
  });
  return sheetFor(client, { dossierId });
}

/* ═══════════════════════════ The chain ═══════════════════════════════════ */

/**
 * Operations hands the sheet to Finance.
 *
 * BOTH gates fire here and report TOGETHER (Q10, Q12). A person missing three
 * receipts and two reasons is told that once — handing them a 422 five times in
 * a row is how a control becomes something people learn to click through.
 */
async function submit(client, { dossierId, note = null, actor = {}, ip = null }) {
  const header = await repo.forDossier(client, dossierId);
  if (!header) throw new AppError("NOT_FOUND", "Nothing has been recorded on this file yet", 404);
  assertEditable(header);

  const sheet = await sheetFor(client, { dossierId });
  if (!sheet.lines.length) {
    throw new AppError("EMPTY_RECONCILIATION", "This file's costing has no lines to reconcile", 422);
  }
  if (sheet.blockers.length) {
    const reasons = sheet.blockers.filter((b) => b.kind === "REASON").length;
    const proofs = sheet.blockers.filter((b) => b.kind === "PROOF").length;
    const parts = [];
    if (reasons) parts.push(`${reasons} line(s) are over budget and need a reason`);
    if (proofs) parts.push(`${proofs} line(s) need a supporting document`);
    throw new AppError("SUBMISSION_BLOCKED", parts.join("; "), 422, { blockers: sheet.blockers });
  }

  const out = await repo.setStatus(client, header.reconciliation_id, {
    sql: "status = 'SUBMITTED', submitted_by = $2, submitted_at = now(), submitted_note = $3, reject_reason = NULL",
    params: [actor.user_id || null, note ? String(note).slice(0, 2000) : null],
  });
  await emitEvent(client, {
    eventTypeKey: events.SUBMITTED, moduleKey: MODULE,
    entityRef: ref(header.reconciliation_id), actorUserId: actor.user_id || null,
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.SUBMITTED, moduleKey: MODULE,
    entityRef: ref(header.reconciliation_id),
    before: { status: header.status }, after: { status: out.status, actual_ttc: sheet.totals.actual_ttc }, ip,
  });
  return sheetFor(client, { dossierId });
}

/** Finance sends it back. Straight to OPEN with the reason on it — a living
 *  sheet has no REJECTED state to rest in, and 12771's Q15 made the same call
 *  for the cash request. */
async function reject(client, { dossierId, reason, actor = {}, ip = null }) {
  const text = String(reason || "").trim();
  if (text.length < 3) throw new AppError("REASON_REQUIRED", "Say what is wrong with the figures — the preparer gets this verbatim", 422);
  const header = await repo.forDossier(client, dossierId);
  if (!header) throw new AppError("NOT_FOUND", "Reconciliation not found", 404);
  if (header.status !== "SUBMITTED") throw new AppError("BAD_STATE", `Cannot send back a ${header.status} reconciliation`, 422);

  const out = await repo.setStatus(client, header.reconciliation_id, {
    sql: "status = 'OPEN', rejected_by = $2, rejected_at = now(), reject_reason = $3",
    params: [actor.user_id || null, text.slice(0, 2000)],
  });
  await emitEvent(client, {
    eventTypeKey: events.REJECTED, moduleKey: MODULE,
    entityRef: ref(header.reconciliation_id), actorUserId: actor.user_id || null,
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.REJECTED, moduleKey: MODULE,
    entityRef: ref(header.reconciliation_id), before: { status: header.status }, after: { status: out.status, reason: text }, ip,
  });
  return sheetFor(client, { dossierId });
}

/**
 * Finance settles: posts the actuals, returns the cash, stamps the file, and
 * tells the MD (owner decisions Q3, Q6, Q14, Q18).
 *
 * ── WHAT HAPPENS INSIDE THIS TRANSACTION ────────────────────────────────────
 *
 *  1. Returned amounts are written onto the lines they name.
 *  2. For each line where the settled actual_ttc differs from what the ledger
 *     already holds (posted_ttc), one cost_entry is written for the DELTA —
 *     never the gross — dated spent_on. Negative deltas post as REVERSING
 *     entries (positive amount, Cr expense / Dr treasury) because
 *     chk_cost_entry_amount_nonneg (0497) forbids negatives.
 *  3. Per funding régie advance: RECEIPT retirement for the actual spend and
 *     CASH_RETURN for the returned cash, through regie.retireCore (which does
 *     NOT open its own transaction — the point is that a refused retirement
 *     rolls the whole settlement back). Deltas against the advance's CURRENT
 *     justified_amount / returned_amount: a holder may have handed cash back
 *     at the window already (owner safeguard 1), and a second settlement after
 *     re-open must not double-retire (owner safeguard 2).
 *  4. DISBURSED cash requests whose advances are now fully retired flip to
 *     JUSTIFIED.
 *  5. Stamp the file, record the settlement history, emit settled + audit.
 *
 * The MD is informed, not asked (Q6, Q18). No second approval.
 */
async function settle(client, { dossierId, returned = {}, actor = {}, ip = null }) {
  const header = await repo.forDossier(client, dossierId);
  if (!header) throw new AppError("NOT_FOUND", "Reconciliation not found", 404);
  if (header.status !== "SUBMITTED") throw new AppError("BAD_STATE", `Cannot settle a ${header.status} reconciliation`, 422);
  // Maker-checker. The previous implementation refused self-validation and it
  // was right to; the legacy allowed Operations to validate its own submission
  // (`api/ocr/validate.php` granted OPERATIONS) and that is the hole.
    if (header.submitted_by && actor.user_id && header.submitted_by === actor.user_id) {
    throw new AppError("SELF_SETTLE", "The person who submitted cannot settle — maker-checker", 422);
  }

  const lineReturns = Object.entries(returned || {});
  const regiePol = await regie.policy(client);
  const entityId = await repo.dossierEntityId(client, { dossierId });

  await client.query("BEGIN");
  try {
    // ── 1. Write returned amounts onto the lines they name ────────────────
    for (const [costingLineId, amount] of lineReturns) {
      if (!(await repo.costingLineOnDossier(client, { dossierId, costingLineId }))) {
        throw new AppError("NOT_FOUND", "A returned amount names a budget line that is not on this file", 404, { costing_line_id: costingLineId });
      }
      await repo.upsertLine(client, {
        reconciliationId: header.reconciliation_id, costingLineId,
        fields: {
          actual_ttc: null, actual_source: null, spent_on: null,
          variance_reason: null, reason_group_id: null,
          returned_amount: Number(amount) || 0,
        },
        actorUserId: actor.user_id || null,
      });
    }

    const sheet = await sheetFor(client, { dossierId });

    // ── 2. Post the actuals — DELTA, never gross (Q3, guide §4.4 step 2) ──
    //
    // Walk every line. For each, decide the TTC delta the sheet implies, strip
    // it to HT using the line's own VAT ratio, and post a forward or reversing
    // entry through recordCostInner. If spent_on is in a closed period we
    // refuse with PERIOD_CLOSED, naming the period, the line and the earliest
    // open date (guide §4.3).
    for (const l of sheet.lines) {
      // actual_ttc is TTC (the grid); cost_entry.amount is HT (the ledger).
      // Ratio = net/(net+vat) strips the line's own VAT — works for both
      // service lines (rate_percent) and débours (upstream_vat_amount is folded
      // into the `vat` figure). If net+vat is 0 there is nothing to convert.
      const grossTtc = Number(l.budget_ttc) || 0;
      const net = Number(l.net) || 0;
      const ratio = grossTtc > 0 && net > 0 ? net / grossTtc : 1;
      const actualTtc = Number(l.actual_ttc) || 0;
      const postedTtc = Number(l.posted_ttc) || 0;
      const deltaTtc = rules.round2(actualTtc - postedTtc);
      const spentOn = l.spent_on || null;

      // The line's already-posted HT, taken from the grid.
      const postedHt = Number(l.posted_ht) || 0;
      const targetHt = rules.round2(actualTtc * ratio);
      const deltaHt = rules.round2(targetHt - postedHt);

      if (Math.abs(deltaHt) < 0.005) continue; // no-op: the ledger already agrees

      if (!spentOn) {
        throw new AppError("SPENT_ON_REQUIRED", `Line "${l.label}" needs a spent date — say when the money left`, 422, { costing_line_id: l.costing_line_id, label: l.label });
      }

      // Check the period BEFORE posting: offer the user a concrete alternative
      // (earliest open date) rather than surfacing a raw journal-entry error.
      // We preflight here because journal_entry.buildAndInsert throws
      // PERIOD_NOT_OPEN and cannot name the offending line by itself (guide §4.3).
      // eslint-disable-next-line no-await-in-loop
      const period = await journalEntry.getPeriodForDate(client, { entityId, date: spentOn });
      if (!period) {
        throw new AppError("NO_PERIOD", `No accounting period covers ${spentOn} (line "${l.label}")`, 422, { costing_line_id: l.costing_line_id, label: l.label, spent_on: spentOn });
      }
      if (period.status !== "OPEN") {
        // eslint-disable-next-line no-await-in-loop
        const earliest = await journalEntry.earliestOpenPeriod(client, { entityId, onOrAfter: spentOn });
        throw new AppError("PERIOD_CLOSED",
          `Period ${period.code} (${period.status}) covers ${spentOn} on line "${l.label}". Pick the next open date or ask Finance to reopen.`,
          422,
          {
            costing_line_id: l.costing_line_id, label: l.label,
            spent_on: spentOn, period_code: period.code, period_status: period.status,
            earliest_open_date: earliest ? earliest.starts_on : null,
          });
      }

      // Forward or reversing entry. chk_cost_entry_amount_nonneg (0497) forbids
      // negative amounts, so a negative delta is posted as a credit against the
      // line's expense account and a debit back to treasury.
      if (deltaHt > 0) {
        // Forward posting: Dr expense/débours, Cr treasury.
        // eslint-disable-next-line no-await-in-loop
        await costTracking.recordCostInner(client, {
          dossierId,
          dictionaryItemId: l.dictionary_item_id || null,
          amount: deltaHt,
          category: "reconciliation",
          isDisbursement: l.is_disbursement === true,
          entityId,
          entryDate: spentOn,
          sourceDocRef: ref(header.reconciliation_id) + ":settle",
          proofVaultId: null, // proofs live on the line documents
          costingLineId: l.costing_line_id,
          spentOn,
          actor, ip,
        });
      } else {
        // Reversing entry: negative delta → credit the expense, debit treasury.
        // recordCostInner always posts Dr expense / Cr treasury and refuses
        // amount <= 0, so for a negative delta we post the mirror directly
        // through journalEntry. The cost_entry still gets a POSITIVE amount
        // (ch_cost_entry_amount_nonneg, 0497) and the SUM in posted_ht stays
        // correct because this entry's journal lines move money the other way.
        const reversalAmount = rules.round2(-deltaHt);
        // eslint-disable-next-line no-await-in-loop
        const treasury = await accountFor(client, "treasury");
        // eslint-disable-next-line no-await-in-loop
        const disb = await accountFor(client, "disbursement");
        let debitAccount;
        if (l.is_disbursement) {
          debitAccount = disb;
        } else {
          // eslint-disable-next-line no-await-in-loop
          debitAccount = await costRepo.purchaseRuleAccount(client, l.dictionary_item_id);
        }
        if (!debitAccount) {
          throw new AppError("NO_EXPENSE_ACCOUNT", `No expense account maps to "${l.label}"`, 500, { costing_line_id: l.costing_line_id });
        }
        // eslint-disable-next-line no-await-in-loop
        const { entry } = await journalEntry.buildAndInsert(client, {
          journalCode: "OD", entityId, entryDate: spentOn,
          description: `Operations file cost reversed — ${l.label} (settlement correction)`,
          sourceDocRef: ref(header.reconciliation_id) + ":settle:reverse", source: "SYSTEM_RULE",
          lines: [
            { account_code: treasury, debit: reversalAmount, credit: 0, dossier_id: dossierId },
            { account_code: debitAccount, debit: 0, credit: reversalAmount, dossier_id: dossierId, dictionary_item_id: l.dictionary_item_id || null, is_disbursement: l.is_disbursement === true },
          ],
          validate: true, actor, ip,
        });
        // eslint-disable-next-line no-await-in-loop
        await costRepo.insertCostEntry(client, {
          dossier_id: dossierId, dictionary_item_id: l.dictionary_item_id || null,
          category: "reconciliation_reversal",
          amount: reversalAmount,
          entry_id: entry.entry_id,
          proof_vault_id: null,
          costing_line_id: l.costing_line_id,
          spent_on: spentOn,
        });
      }
    }

    // ── 3. Régie retirements (Q6, Q14, guide §7.2) ────────────────────────
    //
    // DELTA, NEVER GROSS (owner safeguards 1 & 2). Read each advance's CURRENT
    // justified_amount / returned_amount and post only the difference between
    // those and what the sheet now accounts for. Two cases this guards:
    //   1. the holder already returned cash at the window (CASH_RETURN leg
    //      exists), so we must not post a second one;
    //   2. the sheet was re-opened after settlement and is being settled
    //      again — previously-posted retirements must not double-post.
    //
    // The sheet is one reconciliation per file (Q6), but there may be MULTIPLE
    // funding advances against it if cash went out in tranches. Apportionment
    // rule: total actual_ttc retires receipts pro-rata to how much each advance
    // issued; total returned_ttc retires cash-returns pro-rata. Any remainder
    // after rounding goes onto the last advance — the same discipline
    // cash_request.closeBalance uses for settled_amount.
    //
    // If retireCore refuses (OVER_RETIRED, PROOF_REQUIRED, …) the whole
    // settlement rolls back rather than leaving a settled sheet over an open
    // advance.

    const advances = await repo.fundingAdvancesForDossier(client, { dossierId });
    if (advances.length) {
      const totalActual = sheet.totals.actual_ttc;
      const totalReturned = sheet.totals.returned;
      const totalIssued = advances.reduce((s, a) => s + (Number(a.amount) || 0), 0);

      // Per-advance share. Array parallel to `advances`. Last advance absorbs
      // rounding to make shares sum to exactly totalActual/totalReturned.
      function apportion(total) {
        if (totalIssued <= 0) return advances.map(() => 0);
        const shares = [];
        let running = 0;
        for (let i = 0; i < advances.length; i += 1) {
          if (i === advances.length - 1) {
            shares.push(rules.round2(total - running));
          } else {
            const s = rules.round2(total * (Number(advances[i].amount) || 0) / totalIssued);
            shares.push(s);
            running += s;
          }
        }
        return shares;
      }
      const receiptShares = apportion(totalActual);
      const returnShares = apportion(totalReturned);

      // First proof for RECEIPT retirements that demand one: any document on
      // the sheet (policy.requireProofForReceipt).
      const anyDoc = sheet.documents && sheet.documents.length ? sheet.documents[0].doc_id : null;
      // Use the earliest spent_on as the accounting date for régie legs when
      // the retirement covers the whole file; that date is when money left the
      // holder's hands.
      const advanceEntryDate = await repo.earliestSpentOn(client, { dossierId, reconciliationId: header.reconciliation_id }) || new Date().toISOString().slice(0, 10);

      for (let i = 0; i < advances.length; i += 1) {
        const adv = advances[i];
        const openAmount = rules.round2(Number(adv.amount) - Number(adv.justified_amount) - Number(adv.returned_amount));
        // Receipt delta for this advance.
        const receiptTarget = Math.max(0, receiptShares[i]);
        const receiptDelta = rules.round2(Math.min(receiptTarget - Number(adv.justified_amount), openAmount));
        // Cash-return delta.
        const returnTarget = Math.max(0, returnShares[i]);
        const returnDelta = rules.round2(Math.min(returnTarget - Number(adv.returned_amount), openAmount - receiptDelta));

        // RECEIPT leg (Dr 4731 / Cr 581) — per dossier, per KB §8.2.
        if (receiptDelta > 0.005) {
          // enforce proof on the régie policy only if the sheet has a doc — if
          // the submit gates already enforced proof on every line that needed
          // it, this will exist; if the policy allows no-proof receipts we
          // pass null and retireCore accepts it.
          // eslint-disable-next-line no-await-in-loop
          await regie.retireCore(client, {
            advanceId: adv.regie_advance_id,
            kind: "RECEIPT",
            dossierId,
            amount: receiptDelta,
            proofVaultId: anyDoc,
            memo: `Settlement of reconciliation ${header.reconciliation_id} (${adv.cash_request_ref || adv.cash_request_id})`,
            entityId, entryDate: advanceEntryDate,
            sourceDocRef: ref(header.reconciliation_id),
            actor, ip, policy: regiePol,
          });
        }
        // CASH_RETURN leg (Dr 571 / Cr 581) — cash back to the vault.
        if (returnDelta > 0.005) {
          // eslint-disable-next-line no-await-in-loop
          await regie.retireCore(client, {
            advanceId: adv.regie_advance_id,
            kind: "CASH_RETURN",
            dossierId: null, // cash return is not analytical per KB
            amount: returnDelta,
            proofVaultId: null,
            memo: `Cash returned at settlement of ${header.reconciliation_id} (${adv.cash_request_ref || adv.cash_request_id})`,
            entityId, entryDate: advanceEntryDate,
            sourceDocRef: ref(header.reconciliation_id),
            actor, ip, policy: regiePol,
          });
        }
      }
    }

    // ── 4. Flip funding cash requests whose advances are now JUSTIFIED ────
    const crs = await repo.disbursedCashRequests(client, { dossierId });
    for (const cr of crs) {
      if (!cr.regie_advance_id) {
        // No linked advance (bank, MoMo, cheque); mark JUSTIFIED outright —
        // there is no régie balance holding them open. Guard on status so we
        // do not touch requests already past this state.
        // eslint-disable-next-line no-await-in-loop
        await client.query(
          "UPDATE cash_request SET status = 'JUSTIFIED' WHERE cash_request_id = $1 AND status IN ('DISBURSED','PARTIALLY_DISBURSED')",
          [cr.cash_request_id],
        );
        continue;
      }
      // Read the advance fresh (after retirements above) and flip only when
      // its open balance is zero.
      // eslint-disable-next-line no-await-in-loop
      const { rows: [advNow] } = await client.query(
        "SELECT amount, justified_amount, returned_amount FROM regie_advance WHERE regie_advance_id = $1",
        [cr.regie_advance_id],
      );
      if (advNow) {
        const open = rules.round2(Number(advNow.amount) - Number(advNow.justified_amount) - Number(advNow.returned_amount));
        if (open <= 0.005) {
          // eslint-disable-next-line no-await-in-loop
          await client.query(
            "UPDATE cash_request SET status = 'JUSTIFIED' WHERE cash_request_id = $1 AND status IN ('DISBURSED','PARTIALLY_DISBURSED')",
            [cr.cash_request_id],
          );
        }
      }
    }

    // ── 5. Stamp, history, events ─────────────────────────────────────────
    const settledByActor = await resolveActorId(client, actor.user_id || null);
    const out = await repo.setStatus(client, header.reconciliation_id, {
      sql: "status = 'SETTLED', settled_by = $2, settled_at = now(), returned_total = $3, ocr_amount = $4",
      params: [settledByActor, sheet.totals.returned, sheet.totals.actual_ttc],
    });
    await repo.insertSettlement(client, {
      reconciliation_id: header.reconciliation_id,
      revision: header.revision,
      budget_ttc: sheet.totals.budget_ttc,
      disbursed_ttc: sheet.totals.disbursed,
      actual_ttc: sheet.totals.actual_ttc,
      returned_ttc: sheet.totals.returned,
      settled_by: settledByActor,
    });
    await repo.stampDossier(client, {
      dossierId, reconciliationId: header.reconciliation_id,
      amount: out.ocr_amount, status: "SETTLED",
    });

    // Tell the MD (Q6, Q18). `reconciliation.settled` is FYI, not an approval:
    // recipients are MOD-76 permission-holders + anyone holding ROOT/CEO (who
    // sees everything). The onEvent fan-out in shared/notifications/notify-events.js
    // targets MOD-76 view holders; the MD, as the person to whom Finance
    // reports, is among them by virtue of their grant.
    await emitEvent(client, {
      eventTypeKey: events.SETTLED, moduleKey: MODULE,
      entityRef: ref(header.reconciliation_id), actorUserId: actor.user_id || null,
      payload: { amount_xaf: sheet.totals.actual_ttc, returned_ttc: sheet.totals.returned },
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.SETTLED, moduleKey: MODULE,
      entityRef: ref(header.reconciliation_id),
      before: { status: header.status },
      after: {
        status: out.status, revision: header.revision,
        actual_ttc: sheet.totals.actual_ttc, returned: sheet.totals.returned,
        outstanding: sheet.totals.outstanding,
        // Posted deltas are recorded above; the audit captures the outcome so
        // a reader can confirm the 581 = 0 invariant.
        delta_posted: true,
      }, ip,
    });
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); throw err; }

  return sheetFor(client, { dossierId });
}

/**
 * Re-open a settled sheet because the facts moved (Q6) — the costing was
 * amended, or more cash went out against it.
 *
 * The sheet itself needs no rebuilding: the grid is projected from
 * `costing_line`, so a new budget line is already there and every typed value
 * on the lines that did not change is untouched. All this does is bump the
 * revision and put the sheet back on Operations' desk.
 *
 * PR 2 wires the callers — `costing.setStatus` on APPROVE, and disbursement.
 * Exported now so the state machine is whole and testable rather than having a
 * one-way door in it.
 */
async function reopen(client, { dossierId, reason, actor = {} }) {
  const header = await repo.forDossier(client, dossierId);
  if (!header || header.status !== "SETTLED") return null;
  const out = await repo.setStatus(client, header.reconciliation_id, {
    sql: "status = 'OPEN', revision = revision + 1, reopened_reason = $2, submitted_by = NULL, submitted_at = NULL",
    params: [String(reason || "").slice(0, 500) || "The file's budget or its cash changed"],
  });
  await repo.stampDossier(client, {
    dossierId, reconciliationId: header.reconciliation_id,
    amount: header.ocr_amount, status: "OPEN",
  });
  await emitEvent(client, {
    eventTypeKey: events.REOPENED, moduleKey: MODULE,
    entityRef: ref(header.reconciliation_id), actorUserId: actor.user_id || null,
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.REOPENED, moduleKey: MODULE,
    entityRef: ref(header.reconciliation_id),
    before: { status: header.status, revision: header.revision },
    after: { status: out.status, revision: out.revision, reason: out.reopened_reason },
  });
  return out;
}

/* ══════════════════ What a person still owes (Q10) ═══════════════════════ */

/**
 * Receipts owed — "Cash to account for".
 *
 * Keyed on the person who physically took the tranche
 * (`cash_request_payment.received_by`, 12771 §3), not on the dossier, because
 * the obligation belongs to a person and follows them across every file they
 * have drawn cash on.
 */
async function receiptsOwed(client, { userId = null } = {}) {
  const rows = await repo.receiptsOwed(client, { userId });
  const total = rows.reduce((s, r) => s + (Number(r.claimed_ttc) || 0), 0);
  return { count: rows.length, total_ttc: rules.round2(total), items: rows };
}

module.exports = {
  sheetFor, get,
  patchLine, applyReason, attachDocument, detachDocument,
  submit, reject, settle, reopen,
  receiptsOwed,
};
