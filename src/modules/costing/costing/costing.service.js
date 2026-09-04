/**
 * Project costing (MOD-46, KB §6.7). A dossier BUDGET: what this file will cost
 * us, HT / VAT / TTC, with a draft → validate → approve lifecycle. No GL
 * (budget only) — actuals post via cost_tracking (MOD-47) and are reconciled
 * against this by dossier_reconciliation. SQL in the repo.
 *
 * WHAT A COSTING IS NOT (12766). It is not a price, and it does not open an
 * invoice. Costing is raised by an operations officer; the final invoice is
 * raised by a finance officer from the accepted quotation. A document that
 * silently creates another department's document is a control weakness rather
 * than a convenience, so the two paths that used to do it — a synchronous
 * `ensureDraftForCosting` here and an orchestration backstop on
 * `costing.approved` — are both gone.
 */
"use strict";
const repo = require("./costing.repo");
const events = require("./costing.events");
const {
  computeCosting, toXaf, snapshotLines, diffLines, planLineWrites, summariseBudget,
  statusWords, NUDGE_STAGE, NUDGE_DAILY_LIMIT,
} = require("./costing.rules");
const suggest = require("./costing.suggest");
const numbering = require("../../../services/documents/numbering.service");
const currency = require("../../master/currency/currency.service");
const executor = require("../../../services/workflow/executor");
const onApproved = require("../../../services/workflow/on-approved");
const { assertNoPendingChain } = require("../../../services/workflow/pending-guard");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");
const { AppError } = require("../../../utils/errors");
const shipmentDetails = require("../../operations/shipment_details/shipment_details.service");

const LOCKED = new Set(["APPROVED_LOCKED", "REJECTED"]);

/**
 * The unlock loop — the way out of APPROVED_LOCKED (10718).
 *
 * `setStatus` refuses ANY transition out of a locked status before it looks at
 * the target, which is correct for the ordinary flow and is exactly why an
 * approved costing could never be corrected. Rather than punch a hole in that
 * guard, unlock is its own small state machine handled ahead of it: request,
 * grant, deny. Legacy did the same (api/costing/transition.php:175-205) and
 * parked the request in its own status so "someone has asked" is visible.
 */
const UNLOCK_FLOW = {
  REQUEST_UNLOCK: { from: "APPROVED_LOCKED", to: "UNLOCK_REQUESTED" },
  // Legacy returns to DRAFT (transition.php:192), and DRAFT is the only status
  // updateDraft will edit — anywhere else would be unlocked in name and still
  // uneditable in fact.
  UNLOCK: { from: "UNLOCK_REQUESTED", to: "DRAFT" },
  DENY_UNLOCK: { from: "UNLOCK_REQUESTED", to: "APPROVED_LOCKED" },
};

/*
 * WHY THERE IS NO INVOICE GUARD HERE ANY MORE (12766, owner decision).
 *
 * `assertInvoiceNotPosted` used to refuse an unlock once the dossier's final
 * invoice had left DRAFT. Its premise was that approving a costing priced the
 * invoice, so reopening the costing underneath a posted receivable would let
 * the priced basis move while booked revenue stayed put.
 *
 * That premise no longer holds twice over. The invoice prices from the accepted
 * QUOTATION, never from the costing (`final_invoice.assertPricedSource`), and
 * as of this change a costing does not open an invoice at all. So a posted
 * invoice says nothing about whether this file's BUDGET is still correct.
 *
 * And the guard blocked a real case. A file is billed; a week later the carrier
 * sends a detention charge because the box sat past its free time. The only
 * correct response is to reopen the costing, add the line, raise the cash to
 * pay it, and amend the invoice. Refusing the unlock left that spend with
 * nowhere to be budgeted, which is how it ends up off the file's margin
 * entirely. Rare, and precisely the case a costing exists to capture.
 *
 * What still protects the ledger is unchanged and lives where it belongs: an
 * ISSUED or POSTED invoice cannot be silently edited (`updateDraft` refuses
 * anything but DRAFT — post a reversal instead), and every unlock needs a
 * written reason plus an APPROVER-capable grant.
 */

/**
 * REQUEST_UNLOCK / UNLOCK / DENY_UNLOCK.
 *
 * Permissions are NOT ported from the legacy role lists. Hardcoded role names
 * are strictly less expressive than this system's module grants plus the SoD
 * capability overlay, so the routes express the same intent as `edit` for the
 * request and `approve` + APPROVER for the decision — the split
 * costing.routes.js already documents for SUBMIT vs APPROVE.
 */
async function unlockTransition(client, { id, action, reason = null, actor = {} }) {
  const step = UNLOCK_FLOW[action];
  if (!step) throw new AppError("BAD_ACTION", "unknown unlock action", 422);

  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Costing not found", 404);
  if (before.status !== step.from) {
    throw new AppError(
      "BAD_STATE",
      `${action} needs a costing in ${step.from}; this one is ${before.status}`,
      422,
    );
  }
  if (action === "REQUEST_UNLOCK" && !String(reason || "").trim()) {
    // The audit answer to "why is this approved costing open again". Legacy
    // appended it to a free-text remarks blob; here it is a column.
    throw new AppError("REASON_REQUIRED", "Say why the costing needs reopening", 422);
  }

  const patch = { status: step.to };
  if (action === "REQUEST_UNLOCK") {
    // DATA 2.4: FK to app_user, which lives in LIVE while this row may land in
    // SANDBOX. check-actor-fk-guard.js cannot see this idiom (it matches
    // `x_by:` in an object literal, not `patch.x_by =`), so it is guarded by
    // hand for the same reason the guard exists.
    patch.unlock_requested_by = await resolveActorId(client, actor.user_id);
    patch.unlock_requested_at = new Date().toISOString();
    patch.unlock_reason = reason;
  }
  if (action === "UNLOCK") {
    // DATA 2.4 — as above.
    patch.unlocked_by = await resolveActorId(client, actor.user_id);
    patch.unlocked_at = new Date().toISOString();
    // The sheet is editable again, so it is no longer locked. Leaving the old
    // stamp would make the printed document claim a lock that is not in force.
    patch.locked_at = null;
  }
  // DENY_UNLOCK deliberately keeps unlock_reason and the request metadata: the
  // fact that a reopening was asked for and refused is the audit trail.

  const row = await repo.update(client, id, patch);
  await emitEvent(client, {
    eventTypeKey: events.unlockEvent(action),
    moduleKey: events.MODULE,
    entityRef: "costing:" + id,
    actorUserId: actor.user_id || null,
  });
  await audit(client, {
    actorUserId: actor.user_id || null,
    action: events.unlockEvent(action),
    moduleKey: events.MODULE,
    entityRef: "costing:" + id,
    before,
    after: row,
  });
  return row;
}

/**
 * A disbursement line's VAT columns, resolved server-side (12768).
 *
 * The rate is the source of truth when present: the amount is DERIVED from it
 * here (net × rate), never trusted from the client, so a payload cannot ship a
 * rate of 19.25% with an amount that says something else. A free-text amount
 * (no rate) is stored as given — the exception for a supplier bill whose VAT is
 * not a clean rate. Both are NULL on a service line, whose VAT lives in its tax
 * code, and on a débours the user set to "No VAT".
 */
function debours(l) {
  if (l.is_disbursement !== true) {
    return { upstream_vat_rate_percent: null, upstream_vat_amount: null };
  }
  const rate = l.upstream_vat_rate_percent;
  if (rate !== undefined && rate !== null && Number.isFinite(Number(rate))) {
    const net = (Number(l.qty) || 0) * (Number(l.unit_cost) || 0);
    return {
      upstream_vat_rate_percent: Number(rate),
      upstream_vat_amount: Math.round(net * (Number(rate) / 100) * 100) / 100,
    };
  }
  const amt = l.upstream_vat_amount;
  return {
    upstream_vat_rate_percent: null,
    upstream_vat_amount: amt !== undefined && amt !== null ? Number(amt) : null,
  };
}

/** The columns one payload line writes, whether it is new or being amended. */
function lineFields(l, lineNo) {
  return {
    dictionary_item_id: l.dictionary_item_id || null,
    label: l.label || "Line",
    // 12766: the sheet's order. Assigned from the payload's order, which is
    // the order the person arranged the lines in on screen.
    line_no: lineNo,
    qty: l.qty || 1,
    unit_cost: l.unit_cost || 0,
    is_disbursement: l.is_disbursement === true,
    // A disbursement carries its VAT as an amount (12766) and now a rate
    // (12768), never a tax code — a tax code on a débours would post output
    // tax we do not owe. A code arriving on one is dropped rather than stored.
    tax_code_id: l.is_disbursement === true ? null : (l.tax_code_id || null),
    // Which box this charge was priced for (0663). NULL for anything with no
    // equipment dimension, which is most of the catalogue.
    container_type_ref_id: l.container_type_ref_id || null,
    ...debours(l),
  };
}

/**
 * A budget line that cash has already been requested against cannot be removed
 * by an amendment (12771).
 *
 * `cash_request_line.costing_line_id` is RESTRICT, so the delete would fail
 * anyway — with a raw 23503 and a constraint name, from inside a transaction.
 * This is the same refusal said in a sentence, naming the requests, so the
 * author knows the answer is "reduce it to zero", not "try again".
 *
 * Reducing a line BELOW what is committed stays legal and is the whole point of
 * Q6: the ledger then shows the line over-consumed, and the balance is settled
 * in reconciliation. It is only the disappearance of the line that is refused,
 * because a claim pointing at nothing is a claim nobody can reconcile.
 */
async function assertNoClaims(client, dropping) {
  if (!dropping.length) return;
  const claimed = await repo.claimsOnLines(client, dropping.map((l) => l.costing_line_id));
  if (!claimed.length) return;
  const byId = new Map(dropping.map((l) => [l.costing_line_id, l]));
  const named = claimed.map((c) => {
    const line = byId.get(c.costing_line_id);
    return `${(line && line.label) || "line"} (${(c.doc_numbers || []).join(", ")})`;
  });
  throw new AppError(
    "LINE_HAS_CLAIMS",
    `Cash has already been requested against ${named.join("; ")}. Set the line to zero instead of removing it, so the claim keeps the budget line it was drawn against.`,
    409,
    { lines: claimed },
  );
}

/**
 * Write the payload's lines onto the sheet, KEEPING the id of every line that
 * survives (12771).
 *
 * ── WHY THIS IS NO LONGER A DELETE-AND-REINSERT ────────────────────────────
 *
 * It was, and every `costing_line_id` therefore changed on every DRAFT save. A
 * cash request claims a budget line BY ID, so that link would have broken at
 * exactly the moment it matters — the amendment, which is the case Q6 is
 * entirely about. Identity is matched on the logical key `diffLines` has always
 * used (dictionary item + container type, normalised label as the fallback),
 * so the amendment diff and the budget link agree on what "the same line" means.
 *
 * Two lines can legitimately share that key — the same charge priced for a 20'
 * and a 40' box is one item and two container types, but a hand-typed sheet can
 * repeat a label — so the pool is a QUEUE per key and matching pops in order.
 * A repeat therefore keeps its position rather than being matched arbitrarily.
 *
 * The claims guard runs BEFORE any write, so a refused amendment leaves the
 * sheet exactly as it was rather than half-applied and rolled back.
 */
async function replaceLines(client, costingId, lines) {
  const prior = await repo.lineIdentities(client, costingId);
  const { writes, keptIds, dropped } = planLineWrites(prior, lines);

  // Before ANY write, so a refused amendment leaves the sheet exactly as it
  // was rather than half-applied and rolled back.
  await assertNoClaims(client, dropped);

  await repo.deleteLinesExcept(client, costingId, keptIds);
  for (const w of writes) {
    const fields = lineFields(lines[w.index], w.index + 1);
     
    await (w.id
      ? repo.updateLine(client, w.id, fields)
      : repo.insertLine(client, { costing_id: costingId, ...fields }));
  }
}

/**
 * Recompute the stored totals from the lines as they now stand.
 *
 * Read back through `listLines` rather than trusting the payload: that join is
 * what supplies each line's own VAT rate from its tax code, and it is the same
 * read `get` uses — so the number stored on the row and the number the
 * worksheet footer shows cannot diverge.
 */
async function persistTotals(client, costingId, exchangeRateToXaf) {
  const lines = await repo.listLines(client, costingId);
  const totals = computeCosting(lines);
  await repo.update(client, costingId, {
    total_ht: totals.total_ht,
    total_vat: totals.vat_total,
    total_ttc: totals.total_ttc,
    total_ttc_xaf: toXaf(totals.total_ttc, exchangeRateToXaf),
  });
  return totals;
}

/**
 * The rate this sheet is priced at, defaulted from Currencies & FX.
 *
 * A rate typed from memory is a number nobody can check six months later.
 * `fx_rate_daily` is synced daily and manually overridable, so the default is a
 * real quote for the sheet's own date. An explicit rate in the payload always
 * wins — the operator may have contracted at a different one.
 *
 * Falls back to 1 rather than failing: a missing FX quote must not stop someone
 * costing a file, and the resulting sheet is still correct in its own currency.
 */
async function resolveRate(client, { currencyCode, explicit }) {
  const code = String(currencyCode || "XAF").toUpperCase();
  if (explicit !== undefined && explicit !== null && Number(explicit) > 0) return Number(explicit);
  if (code === "XAF") return 1;
  try {
    const hit = await currency.rateFor(client, {
      base: code, quote: "XAF", date: new Date().toISOString().slice(0, 10),
    });
    const rate = Number(hit && hit.rate);
    if (Number.isFinite(rate) && rate > 0) return rate;
  } catch (err) {
    // @silent:expected — no quote on file for this pair/date is ordinary (a
    // currency added this morning, a weekend with no sync). The sheet stays
    // valid in its own currency and the operator can type the rate.
    logger.info({ err: err && err.message, currency: code }, "no FX quote for costing; defaulting rate to 1");
  }
  return 1;
}

/**
 * Turn the one-live-costing-per-file unique index into a sentence.
 *
 * 12766 added `uq_costing_one_live_per_dossier`. Without this the caller gets a
 * raw 23505 with a constraint name in it; with it they are told which sheet
 * already exists so they can go and open it — which is the thing legacy's
 * duplicate check was reaching for and got wrong (it searched a period-filtered
 * endpoint, so a costing raised last month was invisible and you got a second).
 */
async function assertNoLiveCosting(client, dossierId) {
  const existing = await repo.liveForDossier(client, dossierId);
  if (existing) {
    throw new AppError(
      "COSTING_EXISTS",
      `This operations file already has a costing (${existing.doc_number || existing.costing_id.slice(0, 8)}, ${existing.status}). ` +
        "A file has one costing: open that one, and if it is approved request an unlock to amend it.",
      409,
      // `doc_number` rides the details so the client can render "CST-2026-0043"
      // in its "Open existing costing" affordance rather than an id slice — the
      // sentence in `message` is fine for a log, not for a button people press.
      {
        costing_id: existing.costing_id,
        status: existing.status,
        doc_number: existing.doc_number ?? null,
      },
    );
  }
}

async function createDraft(client, { data, actor = {} }) {
  await assertNoLiveCosting(client, data.dossier_id);
  const rate = await resolveRate(client, {
    currencyCode: data.currency, explicit: data.exchange_rate_to_xaf,
  });
  await client.query("BEGIN");
  try {
    const costing = await repo.insert(client, {
      dossier_id: data.dossier_id, currency: data.currency || "XAF",
      // §2.2: margin_percent is deprecated and never written — costing stops
      // at HT/VAT/TTC; margin belongs to margin_simulation + quotation.
      exchange_rate_to_xaf: rate, status: "DRAFT",
      // §3.3: remarks + the named validator (legacy save.php:29,:6,:33). The
      // assignment moment is recorded so a stalled validation is visible.
      remarks: data.remarks || null,
      validator_id: data.validator_id || null,
      validator_assigned_at: data.validator_id ? new Date() : null,
    });
    if (Array.isArray(data.lines) && data.lines.length) await replaceLines(client, costing.costing_id, data.lines);
    await persistTotals(client, costing.costing_id, rate);
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "costing:" + costing.costing_id, after: costing });
    await client.query("COMMIT");
    return get(client, costing.costing_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function updateDraft(client, { id, patch = {}, lines = null, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Costing not found", 404);
  if (before.status !== "DRAFT") throw new AppError("LOCKED", "Only a DRAFT costing can be edited", 422);
  await client.query("BEGIN");
  try {
    const fields = {};
    // §2.2: margin_percent removed from the patchable set — deprecated column.
    for (const k of ["currency", "remarks"]) if (patch[k] !== undefined) fields[k] = patch[k];
    if (patch.currency !== undefined || patch.exchange_rate_to_xaf !== undefined) {
      fields.exchange_rate_to_xaf = await resolveRate(client, {
        currencyCode: patch.currency !== undefined ? patch.currency : before.currency,
        explicit: patch.exchange_rate_to_xaf,
      });
    }
    // §3.3: naming (or changing) the validator stamps when it happened.
    if (patch.validator_id !== undefined) {
      fields.validator_id = patch.validator_id;
      fields.validator_assigned_at = patch.validator_id ? new Date() : null;
    }
    if (Object.keys(fields).length) await repo.update(client, id, fields);
    if (Array.isArray(lines)) await replaceLines(client, id, lines);
    await persistTotals(
      client, id,
      fields.exchange_rate_to_xaf !== undefined ? fields.exchange_rate_to_xaf : before.exchange_rate_to_xaf,
    );
    // Editing a costing was the one transition on this document that left no
    // trail: `actor` was accepted and dropped. On a sheet that can be unlocked
    // and re-approved, "who changed the figure between approvals" is precisely
    // the question the audit log exists to answer.
    const after = await repo.get(client, id);
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE,
      entityRef: "costing:" + id, before, after,
    });
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Mint the sheet's reference, once, when it first leaves the author's desk.
 *
 * At create would burn a sequence number on every abandoned draft; at approval
 * would be too late for the validator, who needs something to refer to. First
 * submit is the moment it becomes a document other people talk about.
 *
 * A file with no corporate entity cannot be numbered (`numbering.allocate`
 * requires one to scope the sequence). That is a data gap on the file, not a
 * reason to block a submission, so it is skipped and retried on the next
 * transition — the same call is guarded on `doc_number` being null.
 */
async function ensureDocNumber(client, costing) {
  if (costing.doc_number) return costing.doc_number;
  const { rows } = await client.query("SELECT entity_id FROM dossier_visible WHERE dossier_id = $1", [costing.dossier_id]);
  const entityId = rows[0] && rows[0].entity_id;
  if (!entityId) {
    logger.warn({ costing_id: costing.costing_id }, "costing submitted on a file with no corporate entity; reference not allocated");
    return null;
  }
  const allocated = await numbering.allocate(client, {
    moduleKey: events.MODULE, entityId, date: new Date().toISOString().slice(0, 10),
  });
  return allocated.number;
}

/**
 * The seal each transition applies (Q22, Q27).
 *
 * ── WHY THE TRANSITION SIGNS, AND NOT A PERSON ─────────────────────────────
 *
 * The legacy costing PDF carries three stamped boxes — raised, validated,
 * approved — and they are stamped because somebody walked the page round the
 * office. Ours has the signature engine, so the question was only whether to
 * ask the user for a second click after the one that already means "I approve
 * this".
 *
 * It does not. The button IS the decision: a validator who has just pressed
 * "Submit for approval" has validated, and asking them to then choose a
 * signature card is asking the same question twice — which is how a control
 * becomes a thing people click through. Sealing inside the transition also
 * makes the two impossible to separate: there is no path that records an
 * approval without a seal, and no seal that is not backed by a status change.
 *
 * SES, not AES (Q27). The evidence actually collected is an authenticated
 * session, and `assurance_level` records what was collected rather than what
 * was asked for (guide §1.3(b)). Step-up stays off for this doc type — the
 * tenant policy seeded by 12767 leaves `stepup_enabled` false — because a
 * costing is an internal budget and an emailed code per transition, three
 * times per file, is the control that gets switched off.
 *
 * ── AND WHY A FAILURE HERE DOES NOT UNDO THE APPROVAL ──────────────────────
 *
 * Best-effort, deliberately. The decision is the business fact; the seal is
 * its evidence. A tenant that has not seeded `signature_policy.COSTING`, or
 * that has emptied it, would otherwise find every costing transition failing
 * with EMPTY_SIGNATURE_MENU on a screen that says nothing about signatures —
 * an approval blocked by a settings row nobody knew existed. It is logged at
 * error level: an unsealed approval is a real gap in the evidence chain, just
 * not one worth refusing the approval over.
 */
const SEAL_REASON = {
  SUBMIT_VALIDATION: "ACKNOWLEDGED",
  SUBMIT_APPROVAL: "REVIEWED_ACCEPTED",
  APPROVE: "APPROVED_DISPATCH",
};

async function sealTransition(client, { id, to, doc, actor = {} }) {
  const signReason = SEAL_REASON[to];
  if (!signReason || !actor.user_id) return;
  try {
    // Required lazily: document_signature pulls the template service, which
    // requires this module back for the costing projection.
    const signatures = require("../../vault/document_signature/document_signature.service");
    const presets = require("../../../services/signatures/presets");
    const menu = await presets.resolveMenu(client, { docType: "COSTING" });
    await signatures.signInternal(client, {
      entityRef: "costing:" + id,
      docType: "COSTING",
      presetCode: menu.default,
      signReason,
      actor,
      // The document as it stands INSIDE this transaction, passed in rather
      // than left to `signInternal` to load: its own loader would run after
      // the caller has decided WHEN to build it, and the whole point is that
      // this payload is the post-transition sheet, not the pre-transition one.
      doc,
    });
  } catch (err) {
    logger.error(
      { err, costing_id: id, transition: to },
      "costing transition could not be sealed; the status change stands, the evidence does not",
    );
  }
}

async function setStatus(client, { id, to, actor = {}, viaChain = false }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Costing not found", 404);
  if (LOCKED.has(before.status)) throw new AppError("LOCKED", "Costing is " + before.status, 422);
  const flow = { SUBMIT_VALIDATION: "SUBMITTED_FOR_VALIDATION", SUBMIT_APPROVAL: "SUBMITTED_FOR_APPROVAL", APPROVE: "APPROVED_LOCKED", REJECT: "REJECTED" };
  const status = flow[to];
  if (!status) throw new AppError("BAD_ACTION", "unknown transition", 422);
  // §3.3: legacy save.php names validator_employee_id at submit time. Ours
  // silently allowed a costing to sit SUBMITTED_FOR_VALIDATION with nobody
  // named to validate it — a queue with no owner. Submitting for validation
  // now requires the validator to be picked first.
  if (to === "SUBMIT_VALIDATION" && !before.validator_id) {
    throw new AppError("NO_VALIDATOR", "Pick a validator before submitting for validation — a submission with nobody named goes to no one's queue", 422);
  }
  // Approving/rejecting directly while a chain is live would skip it (W4).
  if (to === "APPROVE" || to === "REJECT") {
    await assertNoPendingChain(client, "costing:" + id, { viaChain, what: "costing" });
  }

  const patch = { status };
  const now = new Date().toISOString();

  // The reference, minted once, on the way out of the author's hands.
  if (to === "SUBMIT_VALIDATION" || to === "SUBMIT_APPROVAL") {
    const number = await ensureDocNumber(client, before);
    if (number && !before.doc_number) patch.doc_number = number;
  }
  // Who actually validated, as distinct from who it was addressed to. DATA 2.4
  // — resolved against the schema being written to, same as the unlock loop.
  if (to === "SUBMIT_APPROVAL") {
    patch.validated_by = await resolveActorId(client, actor.user_id);
    patch.validated_at = now;
  }
  if (to === "APPROVE") {
    // DATA 2.4 — as above. `approver_id` has existed since 0320 and was never
    // written, which is why the file 360's People block showed a null approver
    // on every costing ever approved.
    patch.approver_id = await resolveActorId(client, actor.user_id);
    patch.approved_at = now;
    patch.locked_at = now;
  }

  const row = await repo.update(client, id, patch);
  // On submit-for-approval, open the tenant's configurable approval chain (if any
  // workflow is bound to costing.submitted).
  // No workflow bound → autoApproved and the manual APPROVE path stays available;
  // see the note on W8 in purchase_order.service.js for why nothing auto-advances.
  if (status === "SUBMITTED_FOR_APPROVAL") {
    // `total_ht` — the money the sheet commits us to. Read from the stored
    // column (12766) rather than recomputed: it is the figure the registry and
    // the KPI strip show, so the threshold and the screen agree.
    await executor.start(client, { eventTypeKey: "costing.submitted", entityRef: "costing:" + id, amountXaf: Number(row.total_ttc_xaf) || null });
  }
  if (status === "APPROVED_LOCKED") {
    await emitEvent(client, { eventTypeKey: events.APPROVED, moduleKey: events.MODULE, entityRef: "costing:" + id, actorUserId: actor.user_id || null });
    // Freeze the file's shipment details onto the costing (0661). An approved
    // costing must keep citing the vessel and route it was approved with, even
    // after the carrier rolls the booking and ops updates the file. Never
    // throws — see shipment_details.snapshotOnto.
    await shipmentDetails.snapshotOnto(client, { table: "costing", id, dossierId: before.dossier_id });
    // Freeze the LINES too (12766), so the next amendment after an unlock can
    // show the approver what moved instead of fourteen unchanged rows.
    await snapshotApproval(client, { costing: row, actor });
  }
  /*
   * The seal, LAST — after the row is updated and after the approval snapshot
   * is frozen, so the payload it hashes is the sheet as the decision left it.
   *
   * Sealing before the update would attest to the status the sheet was moving
   * OUT of: an approver's seal would read `SUBMITTED_FOR_APPROVAL`, and the
   * verification portal would show a document whose own seal disagrees with
   * it. `templateSvc.loadRecord` is not used to build that payload — inside
   * this transaction it would read uncommitted rows — so the projection is
   * built here from the row we just wrote.
   */
  await sealTransition(client, { id, to, doc: await sealDoc(client, row), actor });
  await audit(client, { actorUserId: actor.user_id || null, action: events.statusChange(status), moduleKey: events.MODULE, entityRef: "costing:" + id, before, after: row });
  return row;
}

/**
 * The costing as the canonical payload wants it, built inside the transaction.
 *
 * It is the SAME projection the document renders from — `loadRecord` — because
 * canonical.js hashes the shape the registry produces, and hashing a second,
 * hand-rolled shape would mean the seal attests to something the page does not
 * show. The call is safe here for the one reason the comment at the call site
 * gives: it reads the rows this transaction has already written, on this
 * client, so it sees the post-transition state.
 */
async function sealDoc(client, row) {
  const templateSvc = require("../../documents/template/template.service");
  const rec = await templateSvc.loadRecord(client, "COSTING", row.costing_id);
  return rec ? rec.data : null;
}

/** The frozen line set for one approval. Best-effort: the approval itself has
 *  already landed, and losing a diff must not undo it. */
async function snapshotApproval(client, { costing, actor = {} }) {
  try {
    const lines = await repo.listLines(client, costing.costing_id);
    const revision = (await repo.snapshotCount(client, costing.costing_id)) + 1;
    await repo.insertSnapshot(client, {
      costing_id: costing.costing_id,
      revision,
      lines: JSON.stringify(snapshotLines(lines)),
      total_ht: costing.total_ht,
      total_vat: costing.total_vat,
      total_ttc: costing.total_ttc,
      currency: costing.currency,
      // DATA 2.4 — FK to app_user, resolved against the schema being written to.
      approved_by: await resolveActorId(client, actor.user_id),
    });
  } catch (err) {
    logger.error({ err, costing_id: costing.costing_id }, "costing approval snapshot failed; the amendment diff will be unavailable for this revision");
  }
}

/**
 * The worksheet, with everything it needs to render itself.
 *
 * `amendment` is present only on a sheet that has been approved before and has
 * since moved — which is exactly when somebody is about to be asked to approve
 * it a second time and needs to know what changed.
 */
async function get(client, id, { lang = "en" } = {}) {
  const costing = await repo.get(client, id);
  if (!costing) return null;
  const lines = await repo.listLines(client, id);
  costing.lines = lines;
  costing.totals = computeCosting(lines);
  costing.totals.total_ttc_xaf = toXaf(costing.totals.total_ttc, costing.exchange_rate_to_xaf);

  // The file this sheet is costing — its reference, its client, its service and
  // its carrier. The worksheet needs all four to name what it is looking at,
  // and a sheet opened from a pasted link has a uuid and nothing else
  // (FRONTEND_GUIDE §3.11 rule 2: the body renders from the RESPONSE).
  costing.file = costing.dossier_id
    ? await repo.dossierForCosting(client, costing.dossier_id)
    : null;
  costing.containers = costing.dossier_id
    ? await repo.containerTypesOnFile(client, costing.dossier_id)
    : [];

  /*
   * The shipment facts — frozen if the sheet was approved, live if it is still
   * being worked on. Same rule, and the same fallback direction, as the transit
   * order (transit_order.service.js:142): a draft should reflect whatever ops
   * last learned about the file, while an approved sheet must keep citing the
   * vessel and route it was approved WITH, because the carrier will roll the
   * booking and ops will update the file.
   *
   * `shipment_details_source` reports which was used rather than leaving the
   * reader to infer it. 0661 has been writing that snapshot onto costings since
   * it landed, and until now nothing read it back.
   */
  let details = costing.shipment_details_snapshot || null;
  let source = details ? "SNAPSHOT" : null;
  if (!details && costing.dossier_id) {
    try {
      details = await shipmentDetails.forDossier(client, costing.dossier_id, { lang });
      source = "LIVE";
    } catch (err) {
      // A file whose service type lost its field set must not make the costing
      // unreadable — the same forgiving-read rule shipment_details follows.
      logger.warn({ err, costing_id: id }, "[costing] shipment details unavailable");
      details = null;
    }
  }
  costing.shipment_details = details;
  costing.shipment_details_source = source;

  const snapshot = await repo.latestSnapshot(client, id);
  if (snapshot) {
    const diff = diffLines(snapshot.lines || [], lines);
    costing.amendment = diff.has_changes
      ? { ...diff, since_revision: snapshot.revision, approved_at: snapshot.approved_at }
      : null;
  } else {
    costing.amendment = null;
  }
  return costing;
}

/**
 * THE BUDGET — what this sheet has authorised, and what is left of it (12771).
 *
 * A costing is the operations file's fulfilment budget, and this is the read
 * that makes that true rather than merely said: per line, what was approved,
 * what cash requests have committed against it, what has actually been paid,
 * and what a new request may still claim.
 *
 * Read from the LIVE costing line, never from an approval snapshot. Amending
 * the budget is precisely how the remaining balance is meant to move — raise
 * Port Charges from 150 000 to 200 000 and the next request can claim 50 000
 * more, the same evening. `cash_request.costing_revision` records which
 * revision each request was raised against for the audit trail; it is not an
 * input to this arithmetic.
 *
 * Callable on ANY status, deliberately. The gate that says a cash request needs
 * an APPROVED_LOCKED costing lives on the request's submission, where it can
 * name the costing and offer a way forward. Refusing the read as well would
 * mean an operations officer could not see the budget they are waiting on.
 *
 * `excludeCashRequestId` answers the question a WORKSHEET asks — "how much of
 * this budget was available to me" — rather than the registry's "how much is
 * left now". They differ by exactly this request's own claim, which is why a
 * request must never be measured against a balance it is itself inside.
 */
async function budget(client, costingId, { excludeCashRequestId = null } = {}) {
  const costing = await repo.get(client, costingId);
  if (!costing) throw new AppError("NOT_FOUND", "Costing not found", 404);
  const [rows, revision] = await Promise.all([
    // Asked on behalf of a request, the ledger leaves that request out — see
    // `budgetForCosting`. Otherwise an approved request reads as a breach of
    // the budget it was approved against.
    repo.budgetForCosting(client, costingId, { excludeCashRequestId }),
    // How many times this sheet has been approved. A cash request stamps it so
    // an auditor can ask "against which version of the budget?" — the ledger
    // itself never reads it.
    repo.snapshotCount(client, costingId),
  ]);
  const { lines, totals } = summariseBudget(rows);
  return {
    costing_id: costing.costing_id,
    doc_number: costing.doc_number || null,
    dossier_id: costing.dossier_id,
    status: costing.status,
    revision,
    currency: costing.currency,
    exchange_rate_to_xaf: Number(costing.exchange_rate_to_xaf),
    // The gate the cash request applies, answered here so a screen can explain
    // itself before the user gets a 403 from somewhere else.
    can_fund: costing.status === "APPROVED_LOCKED",
    lines,
    totals,
  };
}

/** The registry page: rows plus the true match count (X-Total-Count). */
const listPaged = (client, q) => repo.list(client, q);

/**
 * Bare array. Kept alongside `listPaged` for the AI tool registry, which
 * describes `list` as returning a list and would otherwise be handed a
 * `{rows, total}` envelope it has no schema for — the same split
 * final_invoice.service.js makes, for the same reason.
 */
const list = async (client, q) => (await repo.list(client, q)).rows;

/**
 * The KPI strip, aggregated over the SAME filter the page used.
 *
 * Its own endpoint rather than a `meta` block, matching cost_tracking: the
 * registry re-pages far more often than the totals change, and a client that
 * wants one should not have to pay for the other.
 */
const kpis = (client, q) => repo.kpis(client, q);

/** The standard charge set for a file, priced. Read-only — see costing.suggest. */
const suggestLines = (client, q = {}) =>
  suggest.build(client, { dossierId: q.dossier_id, tier: q.tier, onDate: q.on_date });

// A cleared approval chain approves+locks the costing (BUILD_CONVENTIONS §2/§5).
onApproved.register("costing", (client, { id, actor }) => setStatus(client, { id, to: "APPROVE", actor: actor || {}, viaChain: true }));


/* ═══════════════════ THE COSTING GATE (12774) ═════════════════════════════
 *
 * A cash request cannot be funded until its file's costing is APPROVED_LOCKED
 * (12771, owner decision Q4: no money leaves without a costing). So a requester
 * whose sheet is sitting in somebody's queue is blocked by a PERSON, and until
 * now the software told them nothing about who, offered them nothing to do
 * about it, and made them leave the screen to find out.
 *
 * These two functions are the whole of that: `gate` says where the file's
 * budget has got to and who is holding it, and `nudge` chases them — three
 * times a day and no more.
 */

/**
 * The costing gate for one operations file.
 *
 * Returns `null` when the file has no costing at all, which is a real answer
 * and not an error: it is the state the screen offers "create one" for.
 */
async function gate(client, { dossierId }) {
  if (!dossierId) throw new AppError("NO_DOSSIER", "dossier_id is required", 422);
  const row = await repo.gateForDossier(client, dossierId);
  if (!row) return { dossier_id: dossierId, costing: null };

  const stage = NUDGE_STAGE[row.status] || null;
  const used = Number(row.nudges_today) || 0;
  return {
    dossier_id: dossierId,
    costing: {
      costing_id: row.costing_id,
      doc_number: row.doc_number,
      status: row.status,
      // A PAIR, never a joined string — the rule every projection here follows.
      status_words: statusWords(row.status),
      total_ttc: row.total_ttc === null || row.total_ttc === undefined ? null : Number(row.total_ttc),
      currency: row.currency,
    },
    // The gate the cash request applies, answered here so the screen can
    // explain itself before the user meets a 403 somewhere else.
    can_fund: row.status === "APPROVED_LOCKED",
    // Whether the sheet needs a validator named before it can be submitted —
    // `setStatus` refuses SUBMIT_VALIDATION without one (NO_VALIDATOR), and a
    // button that fails for a reason the screen could have shown is a bad button.
    needs_validator: row.status === "DRAFT" && !row.validator_id,
    stage,
    awaiting: stage
      ? {
        // A step assigned to a ROLE names everyone holding it; one assigned to
        // a person names them. Either way the screen can say who.
        user_id: row.awaiting_user_id || (stage === "VALIDATION" ? row.validator_id : null) || null,
        name: row.awaiting_user_name || (stage === "VALIDATION" ? row.validator_name : null) || null,
        role_id: row.awaiting_role_id || null,
        role_name: row.awaiting_role_name || null,
      }
      : null,
    // The owner's ceiling, and what is left of it today (12774).
    nudges_used: used,
    nudges_remaining: Math.max(0, NUDGE_DAILY_LIMIT - used),
    nudge_limit: NUDGE_DAILY_LIMIT,
  };
}

/**
 * Chase whoever is holding this costing — three times a day, no more.
 *
 * WHO IS CHASED, and why it is not simply "the approver". At validation the
 * person is the one NAMED on the sheet (`validator_id`, mandatory since 12766).
 * At approval it is whoever holds the oldest PENDING approval task, which may
 * be a person or a role; a role names everyone holding it, because a step
 * nobody in particular owns is still somebody's job.
 *
 * WHY IT REFUSES RATHER THAN SILENTLY DOING NOTHING. A quota that swallows the
 * fourth press looks identical to a broken button. It answers 429 with the
 * count and the reset, so the screen can say "no reminders left today" before
 * the press and explain it after.
 */
async function nudge(client, { id, actor = {} }) {
  const costing = await repo.get(client, id);
  if (!costing) throw new AppError("NOT_FOUND", "Costing not found", 404);

  const stage = NUDGE_STAGE[costing.status];
  if (!stage) {
    throw new AppError(
      "NOT_PENDING",
      `Costing ${costing.doc_number || ""} is ${costing.status} — there is nobody waiting to act on it.`.trim(),
      422,
      { status: costing.status },
    );
  }

  // Before BEGIN: a refusal must not open and roll back a transaction.
  const used = await repo.nudgesToday(client, id);
  if (used >= NUDGE_DAILY_LIMIT) {
    throw new AppError(
      "NUDGE_QUOTA_EXHAUSTED",
      `This costing has already been chased ${used} times today. The limit is ${NUDGE_DAILY_LIMIT} a day — it resets tomorrow.`,
      429,
      { nudges_used: used, nudges_remaining: 0, nudge_limit: NUDGE_DAILY_LIMIT },
    );
  }

  const row = await repo.gateForDossier(client, costing.dossier_id);
  const recipients = stage === "VALIDATION"
    ? [costing.validator_id].filter(Boolean)
    : (row && row.awaiting_user_id
      ? [row.awaiting_user_id]
      : await repo.usersInRole(client, row && row.awaiting_role_id));

  if (!recipients.length) {
    throw new AppError(
      "NO_RECIPIENT",
      "Nobody is named to act on this costing yet, so there is no one to remind.",
      422,
      { status: costing.status },
    );
  }

  const ref = "costing:" + id;
  const label = costing.doc_number || String(id).slice(0, 8);
  await client.query("BEGIN");
  try {
    const notifications = require("../../notification/notification.service");
    await notifications.notifyMany(client, recipients, {
      eventTypeKey: events.NUDGED,
      title: stage === "VALIDATION"
        ? `Costing ${label} is waiting for your validation`
        : `Costing ${label} is waiting for your approval`,
      // The AMOUNT is in the body deliberately: a recipient triaging a queue
      // decides what to open by what it costs, and a reminder that makes them
      // open the sheet to find out has spent its one chance at their attention.
      body: costing.total_ttc
        ? `${Number(costing.total_ttc).toLocaleString("fr-FR")} ${costing.currency || "XAF"} — a cash request for this file cannot be funded until it is approved.`
        : "A cash request for this file cannot be funded until it is approved.",
      entityRef: ref,
      priority: "HIGH",
      url: "/costing/costings/" + id,
      // One tag per sheet and per stage, so a second reminder REPLACES the
      // first on the recipient's lock screen instead of stacking three
      // identical banners — which is the pressure the quota exists to avoid.
      pushTag: `costing-nudge:${id}:${stage}`,
      renotify: true,
      emailFallback: true,
    });

    for (const userId of recipients) {
       
      await repo.insertNudge(client, {
        costing_id: id,
        // DATA 2.4 — identity lives in LIVE while this row may land in SANDBOX;
        // resolveActorId answers null rather than raising 23503.
        recipient_user_id: await resolveActorId(client, userId),
        stage,
        sent_by: await resolveActorId(client, actor.user_id),
      });
    }
    await audit(client, { actorUserId: actor.user_id || null, action: events.NUDGED, moduleKey: events.MODULE, entityRef: ref, after: { stage, recipients: recipients.length } });
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); throw err; }

  // Counted AFTER the commit, so what the screen shows is what the table holds.
  const nowUsed = await repo.nudgesToday(client, id);
  return {
    sent: recipients.length,
    stage,
    nudges_used: nowUsed,
    nudges_remaining: Math.max(0, NUDGE_DAILY_LIMIT - nowUsed),
    nudge_limit: NUDGE_DAILY_LIMIT,
  };
}

module.exports = {
  createDraft, updateDraft, setStatus, unlockTransition, get, budget,
  list, listPaged, kpis, suggestLines, gate, nudge,
};
