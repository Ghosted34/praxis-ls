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
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { getSetting } = require("../../../shared/config/settings");
const { AppError } = require("../../../utils/errors");
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
 * Finance settles: records the cash handed back, stamps the file, and tells the
 * MD. No second approval — the MD is informed (owner decision Q6, Q18).
 *
 * ── WHAT THIS DOES NOT DO YET ───────────────────────────────────────────────
 *
 * PR 2 adds the accounting legs inside this same transaction: one `cost_entry`
 * per line for the DELTA between what the ledger already holds and the settled
 * actual, dated `spent_on` (never `now()` — the owner's question under Q3); the
 * régie `RECEIPT` retirement for what was spent and the `CASH_RETURN` for what
 * came back; and flipping the funding cash requests to JUSTIFIED.
 *
 * Until then this is the management record only, which is exactly what the
 * previous implementation's `validate` was — `dossier.ocr_amount` has always
 * been the agreed actual rather than a posting, so nothing regresses. The
 * boundary is here, in one function, so PR 2 is additive.
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

  await client.query("BEGIN");
  try {
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
    const out = await repo.setStatus(client, header.reconciliation_id, {
      sql: "status = 'SETTLED', settled_by = $2, settled_at = now(), returned_total = $3, ocr_amount = $4",
      params: [actor.user_id || null, sheet.totals.returned, sheet.totals.actual_ttc],
    });
    await repo.insertSettlement(client, {
      reconciliation_id: header.reconciliation_id,
      revision: header.revision,
      budget_ttc: sheet.totals.budget_ttc,
      disbursed_ttc: sheet.totals.disbursed,
      actual_ttc: sheet.totals.actual_ttc,
      returned_ttc: sheet.totals.returned,
      // settled_by REFERENCES app_user(user_id), and identity lives in the LIVE
      // schema. This row can land in SANDBOX, where that user does not exist —
      // Postgres raises 23503 and the whole settlement rolls back (DATA 2.4).
      settled_by: await resolveActorId(client, actor.user_id || null),
    });
    await repo.stampDossier(client, {
      dossierId, reconciliationId: header.reconciliation_id,
      amount: out.ocr_amount, status: "SETTLED",
    });
    await emitEvent(client, {
      eventTypeKey: events.SETTLED, moduleKey: MODULE,
      entityRef: ref(header.reconciliation_id), actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.SETTLED, moduleKey: MODULE,
      entityRef: ref(header.reconciliation_id),
      before: { status: header.status },
      after: {
        status: out.status, revision: header.revision,
        actual_ttc: sheet.totals.actual_ttc, returned: sheet.totals.returned,
        outstanding: sheet.totals.outstanding,
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
